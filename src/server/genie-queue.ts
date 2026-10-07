import { appendFileSync, existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { emitGlobalEvent } from "./jobs.js";
import { addTodo, setTodoState, getTodoById } from "./todos.js";

const QUEUE_FILE = join(HISTORY_DIR, "genie", "genie-queue.jsonl");
const SAFETY_CAP = 1000;          // 폭주 절대 가드 (정상 흐름엔 도달 X)
const MAX_QUEUE_SIZE = 200;       // 하드 캡 (전체)
const MAX_PER_SOURCE = 50;        // 소프트 캡 (source별)
const DEDUP_WINDOW_MS = 60_000;   // 60초 dedup 윈도우
const DROP_TOAST_WINDOW_MS = 300_000; // 5분 toast 윈도우

export interface QueueItem {
  id: string;
  kind: "internal" | "user";
  message: string;
  attachments?: string[];
  browserId?: string;
  source: string;
  hash: string;
  enqueuedAt: string;
  pendingId?: string; // user kind일 때 chatHistory의 사전 등록 메시지 매핑 키
  mergedIds?: string[]; // 병합된 이전 메시지들의 timestamp
  todoId?: string; // user kind일 때 연결된 TODO 항목 ID
}

export interface EnqueueResult {
  queued: boolean;
  id?: string;
  dropped?: "capacity" | "per-source" | "dedup";
}

const queue: QueueItem[] = [];
let draining = false;
let totalEnqueued = 0;
let totalDone = 0;
let totalDropped = 0;
let toastedRestoredUsers = 0;

const droppedByReason: Record<"capacity" | "per-source" | "dedup", number> = {
  capacity: 0,
  "per-source": 0,
  dedup: 0,
};
const seenHashesRecent = new Map<string, number>(); // hash → enqueueAt timestamp
let lastDropToastAt: number | null = null;
const recentDropSources = new Set<string>();

function ensureDir(): void {
  const dir = dirname(QUEUE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function hashOf(source: string, message: string): string {
  return createHash("sha1").update(`${source}::${message}`).digest("hex").slice(0, 16);
}

function appendEvent(
  op: "enqueue" | "dequeue" | "done" | "fail",
  payload: QueueItem | { id: string },
  extra?: Record<string, unknown>,
): void {
  ensureDir();
  const at = new Date().toISOString();
  let entry: Record<string, unknown>;
  if (op === "enqueue") {
    const i = payload as QueueItem;
    entry = {
      op,
      id: i.id,
      kind: i.kind,
      message: i.message,
      source: i.source,
      hash: i.hash,
      attachments: i.attachments,
      browserId: i.browserId,
      pendingId: i.pendingId,
      at,
    };
  } else {
    entry = { op, id: payload.id, at, ...extra };
  }
  try {
    appendFileSync(QUEUE_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[GenieQueue] append 실패:", err);
  }
}

function tryDrainSoon(): void {
  if (draining) return;
  setImmediate(() => {
    drainQueue().catch((err) => console.error("[GenieQueue] drain 실패:", err));
  });
}

function pruneDedupCache(now: number): void {
  for (const [hash, ts] of seenHashesRecent) {
    if (now - ts > DEDUP_WINDOW_MS) {
      seenHashesRecent.delete(hash);
    }
  }
}

function notifyDrop(source: string): void {
  recentDropSources.add(source);
  const now = Date.now();
  if (lastDropToastAt !== null && now - lastDropToastAt < DROP_TOAST_WINDOW_MS) return;
  lastDropToastAt = now;
  const sources = Array.from(recentDropSources).join(", ");
  recentDropSources.clear();
  import("./chat.js")
    .then((m) => {
      m.addGenieMessage(
        `⚠️ 큐 처리량 초과로 일부 알림이 드랍됐어요 (sourcetypes: ${sources}). 모니터링 패널을 확인해주세요.`,
      );
    })
    .catch((err) => console.error("[GenieQueue] drop toast 실패:", err));
}

function checkGuards(item: QueueItem): EnqueueResult | null {
  const now = Date.now();
  pruneDedupCache(now);

  // 1. dedup 윈도우 (같은 hash 60초 내) — 사용자 메시지는 enqueueUser에서 병합 관리하므로 스킵
  if (item.kind !== "user") {
    const seenAt = seenHashesRecent.get(item.hash);
    if (seenAt !== undefined && now - seenAt <= DEDUP_WINDOW_MS) {
      droppedByReason.dedup++;
      totalDropped++;
      notifyDrop(item.source);
      console.log(`[GenieQueue] dedup drop: ${item.source} hash=${item.hash}`);
      return { queued: false, dropped: "dedup" };
    }
  }

  // 2. per-source 소프트 캡 — 사용자 메시지는 병합으로 항상 1건이므로 스킵
  if (item.kind !== "user") {
    let perSource = 0;
    for (const q of queue) {
      if (q.source === item.source) perSource++;
    }
    if (perSource >= MAX_PER_SOURCE) {
      droppedByReason["per-source"]++;
      totalDropped++;
      notifyDrop(item.source);
      console.warn(`[GenieQueue] per-source drop: ${item.source} (${perSource})`);
      return { queued: false, dropped: "per-source" };
    }
  }

  // 3. 전체 hard cap
  if (queue.length >= MAX_QUEUE_SIZE) {
    droppedByReason.capacity++;
    totalDropped++;
    notifyDrop(item.source);
    console.warn(`[GenieQueue] capacity drop: ${item.source} (queue=${queue.length})`);
    return { queued: false, dropped: "capacity" };
  }

  // 4. SAFETY_CAP — 정상 흐름엔 도달 X (3에서 막힘), 메모리 폭주 절대 가드
  if (queue.length >= SAFETY_CAP) {
    droppedByReason.capacity++;
    totalDropped++;
    console.warn(`[GenieQueue] SAFETY_CAP 초과 (${queue.length}) — drop: ${item.source}`);
    return { queued: false, dropped: "capacity" };
  }

  // 통과: dedup 윈도우에 hash 등록
  seenHashesRecent.set(item.hash, now);
  return null;
}

function pushQueued(item: QueueItem): EnqueueResult {
  const guard = checkGuards(item);
  if (guard) return guard;
  queue.push(item);
  totalEnqueued++;
  appendEvent("enqueue", item);
  emitQueueUpdate();
  tryDrainSoon();
  return { queued: true, id: item.id };
}

export function enqueueInternal(
  message: string,
  source: string,
  opts?: { attachments?: string[]; browserId?: string },
): EnqueueResult {
  const item: QueueItem = {
    id: randomUUID().slice(0, 8),
    kind: "internal",
    message,
    attachments: opts?.attachments,
    browserId: opts?.browserId,
    source,
    hash: hashOf(source, message),
    enqueuedAt: new Date().toISOString(),
  };
  return pushQueued(item);
}

function emitQueueUpdate(): void {
  const items = getQueueItems();
  console.log(`[QueueSSE] emit genie-queue: ${items.length}건`);
  emitGlobalEvent("genie-queue", items);
}

export function enqueueUser(
  message: string,
  attachments?: string[],
  browserId?: string,
  pendingId?: string,
): EnqueueResult {
  // 기존 사용자 메시지가 큐에 있으면 병합 (메시지 합침, 첨부파일 합침)
  const existing = queue.find(q => q.kind === "user");
  if (existing) {
    existing.message += "\n---\n" + message;
    if (attachments?.length) {
      existing.attachments = [...(existing.attachments ?? []), ...attachments];
    }
    existing.hash = hashOf("user", existing.message);
    // 이전 pendingId 보관 (pending 해제용)
    if (existing.pendingId) {
      if (!existing.mergedIds) existing.mergedIds = [];
      existing.mergedIds.push(existing.pendingId);
    }
    if (pendingId) existing.pendingId = pendingId;
    // TODO 업데이트: 병합된 메시지로 instruction 갱신
    if (existing.todoId) {
      const todo = getTodoById(existing.todoId);
      if (todo) {
        todo.instruction = existing.message;
      }
    }
    console.log(`[GenieQueue] 사용자 메시지 병합: ${existing.id} (${existing.message.split("\n").length}줄)`);
    appendEvent("enqueue", existing, { merged: true });
    emitQueueUpdate();
    return { queued: true, id: existing.id };
  }
  const item: QueueItem = {
    id: randomUUID().slice(0, 8),
    kind: "user",
    message,
    attachments,
    browserId,
    source: "user",
    hash: hashOf("user", message),
    enqueuedAt: new Date().toISOString(),
    pendingId,
  };
  // TODO 생성: 사용자 지시를 받았으므로 state="received"로 시작
  const todo = addTodo("user-queue", message.slice(0, 200));
  item.todoId = todo.id;
  return pushQueued(item);
}

export function restoreQueueFromDisk(): void {
  if (!existsSync(QUEUE_FILE)) return;
  let content: string;
  try {
    content = readFileSync(QUEUE_FILE, "utf-8");
  } catch (err) {
    console.error("[GenieQueue] 복원 읽기 실패:", err);
    return;
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const items = new Map<string, QueueItem>();
  const settled = new Set<string>();

  for (const line of lines) {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    const id = typeof evt.id === "string" ? evt.id : undefined;
    const op = typeof evt.op === "string" ? evt.op : undefined;
    if (!id || !op) continue;

    if (op === "enqueue") {
      items.set(id, {
        id,
        kind: evt.kind === "user" ? "user" : "internal",
        message: typeof evt.message === "string" ? evt.message : "",
        attachments: Array.isArray(evt.attachments) ? (evt.attachments as string[]) : undefined,
        browserId: typeof evt.browserId === "string" ? evt.browserId : undefined,
        source: typeof evt.source === "string" ? evt.source : "unknown",
        hash: typeof evt.hash === "string" ? evt.hash : "",
        enqueuedAt: typeof evt.at === "string" ? evt.at : new Date().toISOString(),
        pendingId: typeof evt.pendingId === "string" ? evt.pendingId : undefined,
      });
    } else if (op === "done" || op === "fail") {
      settled.add(id);
    }
  }

  let restored = 0;
  let userRestored = 0;
  const restoredAt = Date.now();
  for (const [id, item] of items) {
    if (settled.has(id)) continue;
    queue.push(item);
    // 복원 항목 hash를 dedup 캐시에 등록 — 부팅 직후 외부 재시도(todo-monitor 등)가
    // 같은 메시지를 다시 enqueue 시도하면 dedup으로 차단 (이중 복원 방지)
    seenHashesRecent.set(item.hash, restoredAt);
    restored++;
    if (item.kind === "user") userRestored++;
  }

  // [데이터 감사 P1-7] 부팅 컴팩션 — 이벤트 로그는 append-only라 무한 증식하고
  // 복원이 전체 리플레이(O(n))라 파일이 클수록 부팅이 느려진다. 복원 직후
  // 미종결 항목만 남긴 스냅샷으로 파일을 재작성해 증식을 끊는다(tmp→rename 원자적).
  try {
    const lines = [...items.values()]
      .filter((it) => !settled.has(it.id))
      .map((it) => JSON.stringify({
        op: "enqueue",
        id: it.id,
        kind: it.kind,
        message: it.message,
        attachments: it.attachments,
        browserId: it.browserId,
        source: it.source,
        hash: it.hash,
        at: it.enqueuedAt,
        pendingId: it.pendingId,
      }));
    const tmp = QUEUE_FILE + ".tmp";
    writeFileSync(tmp, lines.length ? lines.join("\n") + "\n" : "");
    renameSync(tmp, QUEUE_FILE);
    console.log(`[GenieQueue] 컴팩션: 이벤트 로그 → 미종결 ${lines.length}건 스냅샷`);
  } catch (e) {
    console.error("[GenieQueue] 컴팩션 실패(무해 — 다음 부팅에 재시도):", e instanceof Error ? e.message : e);
  }

  if (restored > 0) {
    console.log(`[GenieQueue] 부팅 복원: ${restored}건 (user ${userRestored}건)`);
    if (userRestored > 0 && toastedRestoredUsers === 0) {
      toastedRestoredUsers = userRestored;
      import("./chat.js")
        .then((m) => {
          m.addGenieMessage(`⚠️ 이전 미완 메시지 ${userRestored}건을 다시 처리합니다.`);
        })
        .catch((err) => console.error("[GenieQueue] toast 실패:", err));
    }
    tryDrainSoon();
  }
}

export function getQueueItems(): Array<{ id: string; kind: string; source: string; message: string; enqueuedAt: string }> {
  return queue.map(q => ({
    id: q.id,
    kind: q.kind,
    source: q.source,
    message: q.message.slice(0, 200),
    enqueuedAt: q.enqueuedAt,
  }));
}

export function getQueueStats(): {
  size: number;
  bySource: Record<string, number>;
  totalEnqueued: number;
  totalDone: number;
  totalDropped: number;
  droppedByReason: { capacity: number; "per-source": number; dedup: number };
} {
  const bySource: Record<string, number> = {};
  for (const item of queue) {
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
  }
  return {
    size: queue.length,
    bySource,
    totalEnqueued,
    totalDone,
    totalDropped,
    droppedByReason: { ...droppedByReason },
  };
}

export function notifyIdle(): void {
  tryDrainSoon();
}

// A3: 사용자 메시지 우선 처리 — 내부 알림이 락을 오래 점유해 답변이 밀리는 문제 완화.
// 단 5분 이상 대기한 내부 항목은 1건 끼워넣기 (기아 방지, 큐 하드캡 도달 예방).
const INTERNAL_MAX_WAIT_MS = 5 * 60_000;
function pickNextIndex(): number {
  const now = Date.now();
  const agedIdx = queue.findIndex(
    (it) => it.kind === "internal" && now - Date.parse(it.enqueuedAt) > INTERNAL_MAX_WAIT_MS,
  );
  if (agedIdx !== -1) return agedIdx;
  const userIdx = queue.findIndex((it) => it.kind === "user");
  return userIdx !== -1 ? userIdx : 0;
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const chat = await import("./chat.js");
      if (chat.isGenieBusy()) {
        console.log(`[GenieQueue] busy 재진입 — drain 중단 (queue: ${queue.length})`);
        break;
      }
      const item = queue.splice(pickNextIndex(), 1)[0];
      emitQueueUpdate();
      appendEvent("dequeue", { id: item.id });
      // TODO 상태 전이: received → working (처리 시작)
      if (item.kind === "user" && item.todoId) {
        setTodoState(item.todoId, "working", "큐에서 꺼내 처리 시작");
      }
      try {
        // 병합된 이전 메시지들의 pending 먼저 해제
        if (item.mergedIds?.length) {
          for (const id of item.mergedIds) {
            emitGlobalEvent("chat-update", { id, pending: false });
          }
          const hist = chat.getChatHistory();
          for (const id of item.mergedIds) {
            const msg = hist.find((m: any) => m.id === id);
            if (msg) msg.pending = false;
          }
        }
        await chat.sendMessage(item.message, item.attachments, item.browserId, {
          internal: item.kind === "internal",
          source: item.source,
          pendingId: item.pendingId,
        });
        appendEvent("done", { id: item.id });
        totalDone++;
        // TODO 상태 전이: working → done (처리 완료)
        if (item.kind === "user" && item.todoId) {
          setTodoState(item.todoId, "done", "큐 처리 완료");
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        appendEvent("fail", { id: item.id }, { reason });
        if (reason === "genie_busy" || reason === "genie_queued") {
          console.warn(`[GenieQueue] drain 중 ${reason} 재발생: ${item.source} — drop`);
        } else {
          console.error(`[GenieQueue] sendMessage 실패: ${item.source}`, err);
        }
      }
    }
    // 큐 완전 비었으면 idle 알림 (setGenieBusy가 큐 때문에 busy 유지했으므로)
    if (queue.length === 0) {
      emitGlobalEvent("genie-status", { busy: false });
    }
  } finally {
    draining = false;
  }
}

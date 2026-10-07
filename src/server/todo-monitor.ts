import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GenieTodoState } from "../types.js";
import { getTodos, setTodoState, markStuckNotified, cancelTodo } from "./todos.js";
import { sendMessage } from "./chat.js";
import { getMyProfile } from "./partners.js";
import { HISTORY_DIR } from "../config.js";

// stuck 판정 임계 (ms). 해당 state에 들어간 이후 경과시간이 이 값을 넘으면 stuck.
// 원칙: 사장님/마이크루가 직접 판단해야 하는 상태(received/plan_review/reporting)만 감시.
// delegated/working은 다른 인프라가 진실 소스 (2026-05-04 노이즈 차단):
//   - working: lease 인프라(jobs.ts checkExpiredLeases)가 만료 시 자동 failed + processCallback 발화
//   - delegated: routes.ts handleDelegate 흐름의 race로 false stuck이 흔함
//     (createJob → processJob 즉시 픽업 시 transitionTodosForJob("working")이 todo.relatedJobIds 비어있는
//      시점에 no-op → routes.ts setTodoState("delegated")가 마지막에 적용되어 state=delegated 잔류).
//     진짜 큐 정체는 lease cascade가 결국 정리. 별도 source fix 위임 예정 (race 해결되면 재추가 검토).
const STUCK_RULES: Partial<Record<GenieTodoState, number>> = {
  received: 3 * 60 * 1000,
  plan_review: 3 * 60 * 1000,
  reporting: 3 * 60 * 1000,
};

// 재알림 백오프: 기본 3분에서 횟수에 따라 지수 증가(3→6→12→24분, 최대 30분 캡).
// 무한 3분 폭주(genie 반복 호출 → 크레딧 소진/정지)를 차단. (2026-06-19 max_turns 루프 수정)
const RENOTIFY_BASE_INTERVAL = 3 * 60 * 1000;
const RENOTIFY_MAX_INTERVAL = 30 * 60 * 1000;
// 재알림 상한: 이 횟수를 넘기면 자동 종결(cancelled) 처리하고 사장님께 1회 보고.
// 영원히 해결 안 되는 stuck/failed todo가 무한 재위임되는 것을 끊음.
const RENOTIFY_MAX_COUNT = 5;

function renotifyIntervalFor(count: number): number {
  const interval = RENOTIFY_BASE_INTERVAL * Math.pow(2, Math.max(0, count));
  return Math.min(interval, RENOTIFY_MAX_INTERVAL);
}

function lastStateEnteredAt(
  history: Array<{ state: GenieTodoState; at: string }>,
  state: GenieTodoState,
): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].state === state) return history[i].at;
  }
  return undefined;
}

// ============================================================
// 백로그 다이제스트 — 감시 사각지대 봉쇄 (2026-07-12)
//
// 배경: runStuckCheck의 line "received + relatedJobIds 비어있음 → stuck 판정 제외"는
// 대시보드 대기 항목의 3분 잔소리를 막는 의도된 예외지만, 지니가 "나중에 위임하자"고
// 만든 셀프 메모도 정확히 같은 형태라 영구 사각지대가 됐다. 실제로 2026-07-05~07-11
// 아난다라 등 백로그 10건이 이 형태로 며칠씩 방치됨 (도구 파손으로 위임이 막힌 기간 포함).
//
// 설계: 3분 잔소리 금지는 유지하되, 24시간 이상 방치된 received+잡없음 투두는
// **하루 1회 다이제스트**로 (a) 지니에게 처분 지시 + (b) 사장님 채널(텔레그램/디스코드)에
// 직접 알림. (b)가 핵심 — 지니의 도구가 고장 난 상황(이번 사태의 1차 원인)에서도
// 사람에게는 반드시 신호가 간다.
// ============================================================

const BACKLOG_AGE_MS = 24 * 60 * 60 * 1000;        // 이 나이를 넘긴 백로그만 다이제스트 대상
const BACKLOG_DIGEST_INTERVAL_MS = 22 * 60 * 60 * 1000; // 하루 1회 (재시작 시각 드리프트 여유 2h)
const BACKLOG_DIGEST_STATE_FILE = join(HISTORY_DIR, "genie", ".backlog-digest-at");
const BACKLOG_LIST_MAX = 8;                        // 다이제스트에 나열할 최대 건수

/** 다이제스트 대상 선별 (순수 함수 — 테스트 가능). received(또는 state 없음) + 연결 잡 없음 + 24h+ 방치. */
export function selectBacklogTodos(
  todos: Array<{ id: string; instruction: string; status: string; state?: GenieTodoState; createdAt: string; relatedJobIds?: string[] }>,
  now: number = Date.now(),
): Array<{ id: string; instruction: string; ageDays: number }> {
  return todos
    .filter((t) =>
      t.status === "pending"
      && (t.state === "received" || t.state === undefined)
      && (t.relatedJobIds?.length ?? 0) === 0
      && now - new Date(t.createdAt).getTime() >= BACKLOG_AGE_MS)
    .map((t) => ({
      id: t.id,
      instruction: t.instruction,
      ageDays: Math.floor((now - new Date(t.createdAt).getTime()) / 86400000),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

function lastDigestAt(): number {
  try {
    if (existsSync(BACKLOG_DIGEST_STATE_FILE)) {
      const v = Number(readFileSync(BACKLOG_DIGEST_STATE_FILE, "utf-8").trim());
      if (Number.isFinite(v)) return v;
    }
  } catch { /* 손상 시 0 취급 — 다이제스트가 한 번 더 나가는 쪽이 안전 */ }
  return 0;
}

/** 매분 watchdog에서 호출 — 내부 게이트로 하루 1회만 실제 발화. 예외는 절대 전파하지 않는다. */
export async function runBacklogDigest(now: number = Date.now()): Promise<void> {
  try {
    if (now - lastDigestAt() < BACKLOG_DIGEST_INTERVAL_MS) return;
    const backlog = selectBacklogTodos(getTodos({ status: "pending" }), now);
    if (backlog.length === 0) return;

    // 발화 시각 먼저 기록 — 아래 알림 중 하나가 실패해도 매분 재발화 폭주를 막는다.
    try { writeFileSync(BACKLOG_DIGEST_STATE_FILE, String(now)); } catch { /* */ }

    const shown = backlog.slice(0, BACKLOG_LIST_MAX);
    const lines = shown.map((b) => `- [D+${b.ageDays}] "${b.instruction.replace(/\n/g, " ").slice(0, 70)}"`).join("\n");
    const more = backlog.length > shown.length ? `\n…외 ${backlog.length - shown.length}건` : "";

    // (a) 지니에게 처분 지시 (internal)
    try {
      await sendMessage(
        `[백로그 일일점검] 24시간 이상 위임되지 않은 대기 업무 ${backlog.length}건:\n${lines}${more}\n\n`
        + `각 항목에 대해 반드시 하나를 선택하세요: (1) 지금 위임 (2) cancel (3) 사장님 결정 필요 항목이면 질문 정리해 보고 (4) 의도적 보류면 사유를 투두에 기록. `
        + `"나중에"는 선택지가 아닙니다 — 이 목록은 내일 또 옵니다.`,
        undefined, undefined, { internal: true, source: "todo-monitor:backlog" },
      );
    } catch (err) {
      if (!(err instanceof Error && (err.message === "genie_queued" || err.message === "genie_busy"))) {
        console.error("[BacklogDigest] 지니 알림 실패:", err instanceof Error ? err.message : err);
      }
    }

    // (b) 사장님 채널 직접 알림 — 지니/도구가 고장 나도 사람에게는 신호가 간다 (fire-and-forget)
    const ownerText = `📋 백로그 일일점검: 24시간+ 방치된 대기 업무 ${backlog.length}건\n${lines}${more}\n(지니에게 처분을 지시했습니다. 지니가 응답하지 않으면 시스템 점검이 필요한 신호입니다.)`;
    import("./telegram.js").then((m) => m.sendTelegramNoticeThrottled("backlog-digest", ownerText)).catch(() => {});
    import("./discord.js").then((m) => m.sendDiscordNoticeThrottled("backlog-digest", ownerText)).catch(() => {});
    console.log(`[BacklogDigest] ${backlog.length}건 다이제스트 발화`);
  } catch (err) {
    console.error("[BacklogDigest] 실행 실패 (다음 주기 재시도):", err instanceof Error ? err.message : err);
  }
}

export async function runStuckCheck(): Promise<void> {
  const pending = getTodos({ status: "pending" });
  const now = Date.now();
  const newlyStuck: Array<{ id: string; instruction: string; state: GenieTodoState; minutes: number }> = [];
  const renotify: Array<{ id: string; instruction: string; minutes: number }> = [];
  const newlyFailed: Array<{ id: string; instruction: string; minutes: number }> = [];
  const autoClosed: Array<{ id: string; instruction: string; minutes: number; count: number }> = [];

  for (const todo of pending) {
    const state = todo.state ?? "received";

    // 안전망: 종결 상태(done/cancelled)는 어떤 경우에도 알람 대상 아님.
    // getTodos({status:"pending"}) 필터가 1차로 거르지만, status='pending' + state='done' drift
    // (구버전 데이터/수동 JSON 조작/race)에서 false alarm 재발 차단 — 75f2e494 사례(2026-06-10).
    if (todo.status === "done" || state === "done" || state === "cancelled") continue;

    // 이미 stuck/failed인 것 — RENOTIFY_INTERVAL 주기로 재알림
    if (state === "stuck" || state === "failed") {
      const stuckAt = todo.stuckNotifiedAt;
      if (!stuckAt) {
        // 최초 전이 알림 공백 수정 (2026-04-24)
        // stuck 최초는 자동 감지 경로(아래 for 루프)에서 markStuckNotified와 함께 처리되나,
        // failed는 외부 경로(수동/에이전트 실패)에서 유입 — 여기서 첫 알림 큐잉
        if (state === "failed") {
          const history = todo.stateHistory ?? [];
          const enteredAtStr = history.length > 0 ? history[history.length - 1].at : todo.createdAt;
          const minutes = Math.round((now - new Date(enteredAtStr).getTime()) / 60000);
          newlyFailed.push({ id: todo.id, instruction: todo.instruction, minutes });
          markStuckNotified(todo.id);
        }
        continue;
      }
      const sinceNotify = now - new Date(stuckAt).getTime();
      const count = todo.renotifyCount ?? 0;
      // 상한 초과 → 무한 재위임 차단. 자동 종결(cancelled) + 사장님 1회 보고.
      if (count >= RENOTIFY_MAX_COUNT) {
        const history = todo.stateHistory ?? [];
        const enteredAt = history.length > 0 ? history[history.length - 1].at : stuckAt;
        const totalMinutes = Math.round((now - new Date(enteredAt).getTime()) / 60000);
        cancelTodo(todo.id);
        autoClosed.push({ id: todo.id, instruction: todo.instruction, minutes: totalMinutes, count });
        continue;
      }
      // 백오프된 간격이 지나야 재알림 (3→6→12→24→30분 캡)
      if (sinceNotify >= renotifyIntervalFor(count)) {
        const history = todo.stateHistory ?? [];
        const enteredAt = history.length > 0 ? history[history.length - 1].at : stuckAt;
        const totalMinutes = Math.round((now - new Date(enteredAt).getTime()) / 60000);
        renotify.push({ id: todo.id, instruction: todo.instruction, minutes: totalMinutes });
        markStuckNotified(todo.id, true);
      }
      continue;
    }

    if (todo.stuckNotifiedAt) continue;

    const threshold = STUCK_RULES[state];
    if (!threshold) continue;

    // TODO 시스템 항목 (방치 의도): received 이면서 Job 큐 위임이 안 된 (relatedJobIds 비어 있음) 항목은
    // 사장님이 [시작] 누를 때까지 무한 대기가 정상. stuck 판정 제외.
    // Job 큐 위임된 received (=상위 라우트 race로 잠시 received로 남음)만 종전대로 3분 후 stuck.
    if (state === "received" && (todo.relatedJobIds?.length ?? 0) === 0) continue;

    const history = todo.stateHistory ?? [];
    const enteredAtStr = lastStateEnteredAt(history, state);
    if (!enteredAtStr) continue;
    const elapsed = now - new Date(enteredAtStr).getTime();
    if (elapsed < threshold) continue;

    const minutes = Math.round(elapsed / 60000);
    setTodoState(todo.id, "stuck", `자동 감지: ${state} 상태 ${minutes}분 경과`);
    markStuckNotified(todo.id);
    newlyStuck.push({ id: todo.id, instruction: todo.instruction, state, minutes });
  }

  // 새로 stuck된 항목 알림
  if (newlyStuck.length > 0) {
    const lines = newlyStuck
      .map((s) => `- "${s.instruction.slice(0, 60)}" (${s.state} 상태 ${s.minutes}분 경과)`)
      .join("\n");
    try {
      await sendMessage(
        `[시스템 경고] 3분 이상 정체된 업무가 감지됐습니다. **즉시 판단·조치 필수**:\n${lines}\n\n가능한 행동: (1) 재위임 (2) 상태 확인 (3) done 마킹 (4) cancel (5) 실패 재시도 (6) ${getMyProfile()?.contactName ?? '담당자'} 질의 (7) 방치 의도 판단 시 무시. 한 가지를 반드시 선택하세요.`,
        undefined, undefined, { internal: true, source: "todo-monitor:stuck" },
      );
    } catch (err) {
      if (!(err instanceof Error && err.message === "genie_queued")) {
        console.error("[StuckCheck] sendMessage 실패:", err);
      }
    }
  }

  // 3분 이상 방치된 stuck/failed 재알림 (3분마다 반복)
  if (renotify.length > 0) {
    const lines = renotify
      .map((r) => `- "${r.instruction.slice(0, 60)}" (${r.minutes}분째 미해결)`)
      .join("\n");
    try {
      await sendMessage(
        `[시스템 재경고] 다음 업무가 방치됐습니다 (재알림 간격은 반복마다 늘어납니다). **즉시 행동 필수**:\n${lines}\n\n재위임/상태확인/done/cancel/삭제 중 하나를 선택하거나 ${getMyProfile()?.contactName ?? '담당자'}에게 솔직히 보고하세요. ${RENOTIFY_MAX_COUNT}회까지 미해결 시 자동 종결됩니다.`,
        undefined, undefined, { internal: true, source: "todo-monitor:renotify" },
      );
    } catch (err) {
      if (!(err instanceof Error && err.message === "genie_queued")) {
        console.error("[StuckCheck] 재알림 실패:", err);
      }
    }
  }

  // 새로 failed로 종결된 항목 최초 알림 (stuckNotifiedAt 없던 공백 수정)
  if (newlyFailed.length > 0) {
    const lines = newlyFailed
      .map((f) => `- "${f.instruction.slice(0, 60)}" (${f.minutes}분 경과)`)
      .join("\n");
    try {
      await sendMessage(
        `[시스템 경고] 실패로 종결된 업무가 있습니다. **즉시 조치 필수**:\n${lines}\n\n가능한 행동: (1) 재위임 (조건 바꿔 재시도) (2) 다른 에이전트 위임 (3) done 마킹 (이미 해결됐다면) (4) cancel (포기). 방치 금지 — 마이크루 능동 판단.`,
        undefined, undefined, { internal: true, source: "todo-monitor:failed" },
      );
    } catch (err) {
      if (!(err instanceof Error && err.message === "genie_queued")) {
        console.error("[StuckCheck] newlyFailed 알림 실패:", err);
      }
    }
  }

  // 재알림 상한 초과로 자동 종결(cancelled)된 항목 — 사장님께 1회만 보고 (무한 재위임 차단)
  if (autoClosed.length > 0) {
    const lines = autoClosed
      .map((c) => `- "${c.instruction.slice(0, 60)}" (${c.count}회 재알림에도 미해결, ${c.minutes}분 경과 → 자동 종결)`)
      .join("\n");
    try {
      await sendMessage(
        `[시스템 알림] 다음 업무가 ${RENOTIFY_MAX_COUNT}회 재알림에도 해결되지 않아 자동 종결(cancelled) 처리했습니다:\n${lines}\n\n무한 재시도로 인한 비용 폭주를 막기 위한 조치입니다. 여전히 필요한 업무면 ${getMyProfile()?.contactName ?? '담당자'}이 직접 재지시해 주세요.`,
        undefined, undefined, { internal: true, source: "todo-monitor:auto-closed" },
      );
    } catch (err) {
      if (!(err instanceof Error && err.message === "genie_queued")) {
        console.error("[StuckCheck] auto-closed 알림 실패:", err);
      }
    }
  }
}

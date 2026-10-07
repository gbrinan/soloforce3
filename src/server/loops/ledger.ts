// 루프 실행 이력(ledger) 저장소: <HISTORY_DIR>/loops/<loopId>/runs.jsonl + state.json.
// runs.jsonl은 append-only. 시작 시 {runId, startedAt, status:"running"} 마커 라인을 남기고,
// 종료 시 최종 레코드 라인을 추가로 append — reader는 runId 기준 "마지막" 라인만 채택한다.
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../../config.js";
import type { LoopDefinition, LoopRunRecord, LoopState } from "./types.js";

function loopDataDir(loopId: string): string {
  return join(HISTORY_DIR, "loops", loopId);
}

function ensureLoopDataDir(loopId: string): string {
  const dir = loopDataDir(loopId);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`[LoopEngine] loop 데이터 디렉터리 생성 실패(${loopId}):`, err);
  }
  return dir;
}

function runsFile(loopId: string): string {
  return join(loopDataDir(loopId), "runs.jsonl");
}

function stateFile(loopId: string): string {
  return join(loopDataDir(loopId), "state.json");
}

/** 실행 시작 마커 라인 append. */
export function appendRunStart(loopId: string, runId: string, trigger: "cron" | "manual"): void {
  ensureLoopDataDir(loopId);
  const marker: Partial<LoopRunRecord> = {
    runId,
    loopId,
    startedAt: new Date().toISOString(),
    trigger,
    status: "running",
  };
  try {
    appendFileSync(runsFile(loopId), JSON.stringify(marker) + "\n");
  } catch (err) {
    console.error(`[LoopEngine] runs.jsonl 시작 마커 기록 실패(${loopId}):`, err);
  }
}

/** 실행 종료 시 최종 레코드 append (동일 runId로 두 번째 라인 — reader가 마지막 라인 채택). */
export function appendRun(record: LoopRunRecord): void {
  ensureLoopDataDir(record.loopId);
  const final: LoopRunRecord = { ...record, status: "done" };
  try {
    appendFileSync(runsFile(record.loopId), JSON.stringify(final) + "\n");
  } catch (err) {
    console.error(`[LoopEngine] runs.jsonl 최종 기록 실패(${record.loopId}):`, err);
  }
}

export function loadState(loopId: string): LoopState {
  const file = stateFile(loopId);
  if (!existsSync(file)) return { consecutiveFailures: 0 };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as LoopState;
    if (typeof parsed.consecutiveFailures !== "number") parsed.consecutiveFailures = 0;
    return parsed;
  } catch (err) {
    console.error(`[LoopEngine] state.json 파싱 실패(${loopId}):`, err);
    return { consecutiveFailures: 0 };
  }
}

export function saveState(loopId: string, state: LoopState): void {
  ensureLoopDataDir(loopId);
  try {
    writeFileSync(stateFile(loopId), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`[LoopEngine] state.json 저장 실패(${loopId}):`, err);
  }
}

/** 최근 N건의 실행 레코드 조회. runId별로 마지막 라인만 채택(진행중 마커는 status:"running"으로 남을 수 있음). */
export function listRuns(loopId: string, limit = 20): LoopRunRecord[] {
  const file = runsFile(loopId);
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
    const byRunId = new Map<string, LoopRunRecord>();
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as LoopRunRecord;
        if (!rec.runId) continue;
        byRunId.set(rec.runId, rec); // 나중 라인이 이전 라인을 덮어씀 → 항상 마지막 상태 유지
      } catch {
        // 손상된 라인은 무시 — 파일 전체를 죽이지 않음
      }
    }
    const all = Array.from(byRunId.values()).sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
    return all.slice(0, limit);
  } catch (err) {
    console.error(`[LoopEngine] runs.jsonl 읽기 실패(${loopId}):`, err);
    return [];
  }
}

/**
 * 부팅 시 orphan(고아) 실행 복구용 — runId별 마지막 라인이 status:"running"인 채로 남아있으면
 * (서버가 실행 도중 재시작/크래시되어 종료 마커를 append하지 못한 경우) "interrupted" 최종 라인을 추가한다.
 * listRuns()와 동일한 "runId별 마지막 라인 채택" 원칙을 따르되, 정상 종료(status:"done" 또는
 * status 필드 없음 — 구버전 레코드 호환)된 실행은 절대 건드리지 않는다(false positive 방지).
 */
export function reconcileOrphanRuns(loopId: string): LoopRunRecord[] {
  const file = runsFile(loopId);
  if (!existsSync(file)) return [];

  const lines = (() => {
    try {
      return readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
    } catch (err) {
      console.error(`[LoopEngine] runs.jsonl 읽기 실패(orphan 복구, ${loopId}):`, err);
      return [];
    }
  })();
  if (lines.length === 0) return [];

  const byRunId = new Map<string, LoopRunRecord>();
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as LoopRunRecord;
      if (!rec.runId) continue;
      byRunId.set(rec.runId, rec); // 마지막 라인이 그 runId의 "현재 상태"
    } catch {
      // 손상된 라인 무시
    }
  }

  const orphans: LoopRunRecord[] = [];
  for (const rec of byRunId.values()) {
    if (rec.status === "running") orphans.push(rec);
  }
  if (orphans.length === 0) return [];

  for (const orphan of orphans) {
    const finalRecord: LoopRunRecord = {
      ...orphan,
      endedAt: new Date().toISOString(), // 복구 시점(now) — 실제 중단 시각은 알 수 없으므로 허위 시각을 만들지 않는다
      exitReason: "interrupted",
      error: orphan.error ?? "서버 재시작/크래시로 실행이 중단됨 (부팅 시 자동 복구)",
      status: "done",
    };
    try {
      appendFileSync(runsFile(loopId), JSON.stringify(finalRecord) + "\n");
    } catch (err) {
      console.error(`[LoopEngine] orphan run 복구 기록 실패(${loopId}, runId=${orphan.runId}):`, err);
    }
  }

  return orphans;
}

/** 등록된 모든 루프 정의를 대상으로 orphan 실행을 복구. 서버 부팅 시 1회만 호출된다(v1 범위 — 재시작 없는 크래시는 다음 부팅까지 미검출). */
export function reconcileAllOrphanRuns(defs: LoopDefinition[]): Array<{ loopId: string; loopLabel: string; runs: LoopRunRecord[] }> {
  const results: Array<{ loopId: string; loopLabel: string; runs: LoopRunRecord[] }> = [];
  for (const def of defs) {
    try {
      const orphans = reconcileOrphanRuns(def.id);
      if (orphans.length > 0) {
        results.push({ loopId: def.id, loopLabel: def.description || def.id, runs: orphans });
      }
    } catch (err) {
      console.error(`[LoopEngine] orphan 복구 중 오류(${def.id}):`, err);
    }
  }
  return results;
}

/**
 * QA 잡이 "실행 자체"에 실패했을 때(판정 전 종료) 원인을 사람 말로 분류하고, 연속 실패를 알린다.
 *
 * 배경(2026-09-27): 2026-09-19~26 QA 잡 23건이 codex 어댑터 인증 실패(refresh token 재사용 401 →
 * 이후 "codex exited 1: (no stderr)")로 전부 실패했지만, handleQaJobComplete가 failed QA를 무시해
 * 8일간 아무 알림 없이 원작업들이 검증 없이 끝났다. 이 모듈은 그 공백을 막는다.
 */

export type QaRunFailureCause = "auth" | "silent-exit" | "timeout" | "rate-limit" | "report-format" | "unknown";

export interface QaRunFailureInfo {
  cause: QaRunFailureCause;
  adapter: string;          // codex / claude-code 등, 로그에서 못 찾으면 ""
  where: string;            // 문제 위치 (사람용)
  todo: string;             // 아난이 할 일 (사람용)
  countsTowardStreak: boolean; // 실행 불가 연속 집계에 포함할지(보고 형식 누락은 제외)
  evidence: string;         // 판단 근거가 된 로그 한 줄(200자)
}

const LINE_RE = /(작업 실패|ERROR|outputs_missing|timed? ?out|타임아웃)/i;

/** 실패한 QA 잡 로그에서 원인을 분류한다. 순수 함수. */
export function classifyQaRunFailure(logs: string[]): QaRunFailureInfo {
  const tail = logs.slice(-60);
  const text = tail.join("\n");
  const adapter = (text.match(/\((codex|claude-code|claude|gemini|opencode)\)\s*작업 (실패|시작|완료)/) || [])[1] || "";
  const evidence = ([...tail].reverse().find((l) => LINE_RE.test(l)) || tail[tail.length - 1] || "").replace(/\s+/g, " ").slice(0, 200);
  const who = adapter ? `QA 담당 실행기(${adapter})` : "QA 담당 실행기";

  if (/refresh token|401\s*Unauthorized|Please try signing in|login.{0,20}(expired|required)|인증 만료/i.test(text)) {
    return {
      cause: "auth", adapter, evidence, countsTowardStreak: true,
      where: `환경 — ${who}의 로그인(인증)이 만료됐습니다`,
      todo: `조치 — WSL 터미널에서 ${adapter || "해당 CLI"} 재로그인 후 서비스 재시작 (또는 QA 담당을 다른 실행기로 전환)`,
    };
  }
  if (/rate.?limit|429|quota|usage limit/i.test(text)) {
    return {
      cause: "rate-limit", adapter, evidence, countsTowardStreak: true,
      where: `환경 — ${who}의 사용 한도에 걸렸습니다`,
      todo: "확인 — 한도 초기화 시각까지 기다리거나 QA 담당 모델을 바꿀지 결정",
    };
  }
  if (/timed? ?out|타임아웃|SIGTERM|maxTurns/i.test(text)) {
    return {
      cause: "timeout", adapter, evidence, countsTowardStreak: true,
      where: `QA 자신 — ${who}가 제한 시간 안에 끝내지 못했습니다`,
      todo: "없음 — 반복되면 확인(검증 깊이 조정 필요)",
    };
  }
  if (/보고 형식 누락|outputs_missing/i.test(text)) {
    return {
      cause: "report-format", adapter, evidence, countsTowardStreak: false,
      where: "QA 자신 — 검증은 끝났지만 정해진 보고 형식을 지키지 않았습니다",
      todo: "없음",
    };
  }
  if (/exited \d+:?\s*\(no stderr\)|exited with code \d+/i.test(text)) {
    return {
      cause: "silent-exit", adapter, evidence, countsTowardStreak: true,
      where: `환경 — ${who}가 오류 메시지 없이 바로 종료됐습니다(대개 인증·설정 문제)`,
      todo: `확인 — WSL에서 ${adapter || "해당 CLI"}를 직접 한 번 실행해 로그인 상태 확인, 안 되면 QA 담당 실행기 전환`,
    };
  }
  return {
    cause: "unknown", adapter, evidence, countsTowardStreak: true,
    where: `환경 — ${who}가 원인 불명으로 실패했습니다`,
    todo: "확인 — 해당 QA 잡 로그 확인",
  };
}

/** 연속 N번째 실행 실패에서 사람에게 알릴지. 2회째 첫 알림, 이후 5회마다 재알림(스팸 방지). */
export function shouldAlertQaRunFailure(consecutive: number): boolean {
  return consecutive === 2 || (consecutive > 2 && (consecutive - 2) % 5 === 0);
}

/** 사람용 알림 문구. unverified: 검증 없이 끝난 원작업 제목들(최근순). */
export function formatQaRunFailureAlert(consecutive: number, info: QaRunFailureInfo, unverified: string[]): string {
  const list = unverified.slice(0, 5).map((t) => `  - ${t}`).join("\n");
  return (
    `🚨 QA 담당이 연속 ${consecutive}회 실행되지 못했습니다 — 그동안 아래 작업은 검증 없이 끝났습니다.\n` +
    `아난이 할 일: ${info.todo}\n` +
    `문제 위치: ${info.where}\n` +
    (list ? `검증 못 한 작업:\n${list}${unverified.length > 5 ? `\n  - 외 ${unverified.length - 5}건` : ""}\n` : "") +
    `근거: ${info.evidence}`
  );
}

// ── 연속 실패 상태 (메모리; 재시작 시 초기화 — 재시작 후 첫 실패부터 다시 셈) ──
let consecutive = 0;
let unverifiedTitles: string[] = [];

/** QA 잡 종료마다 호출. completed면 연속 기록 초기화, 아니면 집계 후 알릴 문구를 돌려준다(없으면 null). */
export function recordQaRunOutcome(
  status: string | undefined,
  logs: string[],
  originalTitle: string,
): { info: QaRunFailureInfo; alert: string | null } | null {
  if (status === "completed") {
    consecutive = 0;
    unverifiedTitles = [];
    return null;
  }
  const info = classifyQaRunFailure(logs);
  if (!info.countsTowardStreak) return { info, alert: null };
  consecutive += 1;
  unverifiedTitles.unshift(originalTitle);
  unverifiedTitles = unverifiedTitles.slice(0, 50);
  return { info, alert: shouldAlertQaRunFailure(consecutive) ? formatQaRunFailureAlert(consecutive, info, unverifiedTitles) : null };
}

/** 테스트 전용 초기화 */
export function __resetQaRunFailureState(): void {
  consecutive = 0;
  unverifiedTitles = [];
}

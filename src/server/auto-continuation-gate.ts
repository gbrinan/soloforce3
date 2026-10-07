// chat:auto-continuation 진척 게이트·루프 감지 — 순수 판정 모듈.
//
// "AI first, AI last": 자동 진행은 그대로 AI 가 몬다(사람 게이트 없음). 다만
//  - 직전 자동 진행 턴이 «관측 가능한 진척»(새 잡 위임 / TODO 변화 / 실질적으로 다른 출력)을
//    남기지 못한 게 연속 N회(기본 3)면 더 resume 하지 않고 멈춘다.
//  - 직전과 거의 같은 출력이 두 번 연속이면 진척 없음으로 본다(루프 감지).
// 멈출 때는 저가 단발 호출로 «무엇이 막혔는지 / 다음에 필요한 것»을 채팅에 남긴다(AI-last).

export const DEFAULT_STALL_LIMIT = 3;
export const NEAR_IDENTICAL_THRESHOLD = 0.9;

export function stallLimitFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SOLOFORCE_AUTO_CONT_STALL_LIMIT);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_STALL_LIMIT;
}

/** 비교용 정규화: 주석 태그·숫자·공백·구두점 제거, 소문자. (카운터 "3/20" 같은 차이를 무시) */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[0-9]+/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}

/** 문자 bigram Dice 유사도(0~1). 정규화 후 같으면 1. */
export function similarity(a: string, b: string): number {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const c = grams.get(g) ?? 0;
    if (c > 0) { inter++; grams.set(g, c - 1); }
  }
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

export function isNearIdentical(a: string, b: string, threshold = NEAR_IDENTICAL_THRESHOLD): boolean {
  return similarity(a, b) >= threshold;
}

/** 자동 진행 1턴의 관측치. */
export interface TurnObservation {
  output: string;
  /** 이 턴에서 새로 위임된 잡 수. */
  jobsCreated: number;
  /** 턴 전후 TODO 상태 서명(같으면 변화 없음). */
  todoSigBefore: string;
  todoSigAfter: string;
}

/** 출력이 의미 있다고 볼 최소 길이(정규화 후). "확인했습니다" 류 한 줄은 진척이 아니다. */
const MIN_SUBSTANTIVE_CHARS = 20;

export function observeProgress(prevOutput: string | undefined, cur: TurnObservation): { progress: boolean; loop: boolean; why: string } {
  const loop = prevOutput !== undefined && cur.output.trim() !== "" && isNearIdentical(prevOutput, cur.output);
  if (loop) return { progress: false, loop: true, why: "near-identical-output" };
  if (cur.jobsCreated > 0) return { progress: true, loop: false, why: "job-created" };
  if (cur.todoSigBefore !== cur.todoSigAfter) return { progress: true, loop: false, why: "todo-changed" };
  if (normalizeForCompare(cur.output).length >= MIN_SUBSTANTIVE_CHARS) return { progress: true, loop: false, why: "output-changed" };
  return { progress: false, loop: false, why: "no-observable-change" };
}

/** 연속 무진척 카운터. 사용자 메시지·모드 토글 시 reset(). */
export class ProgressGate {
  consecutiveNoProgress = 0;
  lastOutput: string | undefined;
  constructor(readonly limit: number = DEFAULT_STALL_LIMIT) {}

  record(cur: TurnObservation): { progress: boolean; loop: boolean; why: string; stalled: boolean } {
    const r = observeProgress(this.lastOutput, cur);
    this.consecutiveNoProgress = r.progress ? 0 : this.consecutiveNoProgress + 1;
    if (cur.output.trim()) this.lastOutput = cur.output;
    return { ...r, stalled: this.consecutiveNoProgress >= this.limit };
  }

  reset(): void {
    this.consecutiveNoProgress = 0;
    this.lastOutput = undefined;
  }
}

/** 정체 시 저가 단발 호출에 줄 프롬프트(맥락 최소). */
export function buildStallPrompt(recentRequests: string[], lastOutputs: string[], why: string, userTitle: string): string {
  const reqs = recentRequests.slice(-5).map((r) => `- ${r.slice(0, 100)}`).join("\n") || "- (없음)";
  const outs = lastOutputs.slice(-3).map((o, i) => `(${i + 1}) ${o.replace(/\s+/g, " ").slice(0, 300)}`).join("\n") || "(출력 없음)";
  return `[자동 진행 정체 보고 요청]
자동 진행이 연속으로 관측 가능한 진척 없이 반복되어 시스템이 멈췄습니다(사유: ${why}).
최근 끝난 작업:
${reqs}
최근 자동 진행 응답:
${outs}

${userTitle}에게 보낼 짧은 상황 보고를 작성하세요. 첫 줄은 [NOTIFY] 로 시작하고, 아래 두 항목만 각 1~2줄로:
무엇이 막혔는지:
다음에 필요한 것:
새 작업 위임·TODO 태그·RESTART 는 하지 마세요.`;
}

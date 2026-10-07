/**
 * 트래젝터리(궤적) LLM 판정
 * - regex verdict(detectQaVerdict)가 unknown일 때 도구 호출 시퀀스 + 결과를 LLM으로 판정
 * - 근거: output-only 평가는 step-level(trajectory) 평가 대비 실패 케이스 20~40% 누락
 * - LLM 러너는 의존성 주입 (테스트 시 fake runner 사용 가능)
 */

import type { Job } from "../types.js";

export interface TrajectoryVerdict {
  verdict: "pass" | "fail" | "unclear";
  score: number; // 0-100
  reasons: string[];
}

type TrajectoryJob = Pick<Job, "request" | "logs" | "fullResult" | "agent">;

const MAX_LOG_LINES = 60;
const MAX_LOG_CHARS = 6000;
const MAX_RESULT_CHARS = 4000;

/** 판정 프롬프트 생성 — 로그는 마지막 60줄/6000자, fullResult는 4000자 cap */
export function buildTrajectoryPrompt(job: TrajectoryJob): string {
  const logsCapped = job.logs
    .slice(-MAX_LOG_LINES)
    .join("\n")
    .slice(-MAX_LOG_CHARS);
  const resultCapped = (job.fullResult ?? "").slice(0, MAX_RESULT_CHARS);

  return (
    `당신은 에이전트 작업 궤적(trajectory) 판정관입니다. ` +
    `아래 완료된 작업의 요청·실행 로그(도구 호출 시퀀스)·최종 결과를 보고 판정하세요.\n\n` +
    `## 판정 기준\n` +
    `1. 도구 호출 시퀀스(로그)가 요청을 실제로 달성했다고 볼 수 있는가?\n` +
    `2. 다음 징후가 있는가? — 검증 단계 생략, 실행 증거 없는 완료 주장(거짓 보고), ` +
    `출력 잘림(truncated), 요청과 무관한 방향으로의 이탈(goal drift)\n` +
    `3. 아래 STRICT JSON 형식으로만 답하세요. JSON 외 다른 텍스트 절대 금지.\n\n` +
    `{"verdict":"pass|fail|unclear","score":0-100,"reasons":["..."]}\n\n` +
    `## 담당 에이전트\n${job.agent ?? "(미지정)"}\n\n` +
    `## 원본 요청\n${job.request}\n\n` +
    `## 실행 로그 (마지막 ${MAX_LOG_LINES}줄, ${MAX_LOG_CHARS}자 cap)\n${logsCapped}\n\n` +
    `## 최종 결과 (${MAX_RESULT_CHARS}자 cap)\n${resultCapped}`
  );
}

/** 첫 번째 균형 잡힌 {...} 블록 추출 (문자열 내 중괄호·이스케이프 인식) */
function extractFirstJsonBlock(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** LLM 원문 응답 → TrajectoryVerdict 파싱 (펜싱 허용, 필드 검증, score 클램프). 실패 시 null */
export function parseTrajectoryVerdict(raw: string): TrajectoryVerdict | null {
  const block = extractFirstJsonBlock(raw);
  if (!block) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const verdict = obj.verdict;
  if (verdict !== "pass" && verdict !== "fail" && verdict !== "unclear") return null;

  const scoreNum = Number(obj.score);
  if (!Number.isFinite(scoreNum)) return null;
  const score = Math.max(0, Math.min(100, Math.round(scoreNum)));

  const reasons = Array.isArray(obj.reasons)
    ? obj.reasons.filter((r): r is string => typeof r === "string")
    : [];

  return { verdict, score, reasons };
}

/**
 * 궤적 판정 실행 — runLlm 의존성 주입 (테스트는 fake runner 사용).
 * 절대 throw하지 않음 (실패 시 console.warn + null).
 */
export async function judgeTrajectory(
  job: TrajectoryJob,
  runLlm: (prompt: string) => Promise<string>,
): Promise<TrajectoryVerdict | null> {
  try {
    const raw = await runLlm(buildTrajectoryPrompt(job));
    return parseTrajectoryVerdict(raw);
  } catch (err) {
    console.warn("[TrajectoryJudge] LLM 판정 실패:", err);
    return null;
  }
}

/**
 * 프로덕션 LLM 러너 — qa 에이전트 설정 + 경량 모델로 fresh 콜(세션 없음).
 * qa 설정 부재 시 throw (judgeTrajectory에서 catch → null 처리됨).
 */
export function makeDefaultLlmRunner(): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    // dynamic import — agent.js/config.js 로딩 비용을 실제 호출 시점으로 지연
    const { runAgent } = await import("../agent.js");
    const { getWorkerAgent, toAgentConfig } = await import("../agent-registry.js");
    const qaDef = getWorkerAgent("qa");
    if (!qaDef) throw new Error("qa 에이전트 설정 없음 — trajectory judge 실행 불가");
    const result = await runAgent(toAgentConfig(qaDef), "trajectory-judge", prompt, {
      model: process.env.TRAJECTORY_JUDGE_MODEL || "claude-haiku-4-5-20251001",
    });
    const { logCost } = await import("./jobs.js");
    if (result.cost) logCost("qa", undefined, result.cost, "qa:trajectory-judge");
    return result.output;
  };
}

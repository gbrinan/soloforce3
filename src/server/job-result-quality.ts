export type WorkerResultQuality = "ok" | "empty" | "delegation_only";

const DELEGATION_PATTERNS = [
  /DelegateTask/i,
  /(?:알바|하위\s*작업|서브\s*에이전트|subagent|worker agent|직원).{0,30}(?:맡겼|위임|배정|요청|시켰|할당)/i,
  /(?:맡겼|위임|배정|요청|할당).{0,30}(?:알바|하위\s*작업|서브\s*에이전트|subagent|worker agent|직원)/i,
  /(?:\d+\s*명|세\s*명|3\s*명).{0,30}(?:맡겼|위임|배정|요청|할당)/i,
];

const PENDING_PATTERNS = [
  /(?:진행\s*중|대기|기다|도착하면|완료되면|받으면|취합\s*예정|종합\s*예정|보고\s*예정)/i,
  /(?:결과|응답|보고).{0,20}(?:기다|대기|도착|오면|받으면)/i,
  /(?:맡겼|위임|배정|요청|할당)(?:했습니다|했어요|해두었습니다|해뒀습니다|해두었어요)[.!。]?$/i,
];

const FINAL_RESULT_PATTERNS = [
  /(?:최종|결론|검증\s*결과|분석\s*결과|리뷰\s*결과|구현\s*완료|수정\s*완료|작성\s*완료|테스트\s*통과|저장(?:했습니다|했어요)?|산출물|보고서|파일\s*경로|history\/outputs|outputs\/)/i,
  /(?:다음과\s*같이|아래와\s*같이).{0,30}(?:정리|완료|수정|작성|검토)/i,
];

export function classifyWorkerResultQuality(content: string): WorkerResultQuality {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "empty";

  const delegated = DELEGATION_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!delegated) return "ok";

  const hasFinalResult = FINAL_RESULT_PATTERNS.some((pattern) => pattern.test(normalized));
  if (hasFinalResult) return "ok";

  const looksPending = PENDING_PATTERNS.some((pattern) => pattern.test(normalized));
  if (looksPending) return "delegation_only";

  const shortAck = normalized.length <= 240 && /(?:맡겼|위임|배정|요청|할당)/i.test(normalized);
  return shortAck ? "delegation_only" : "ok";
}

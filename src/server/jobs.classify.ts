/**
 * 워커 종료 상태 분류 결정 트리 (QA 보고서 구조개선 ①)
 * 2026-06-11: exit code + stderr 키워드 + stdout 보고 형식 종합 판정
 */

export interface ClassifyResult {
  status: "completed" | "failed" | "outputs_missing";
  reason?: string;
}

/**
 * 잡 종료 결과를 exit code + stderr + stdout 종합 분석하여 최종 상태 결정
 * 
 * 결정 트리:
 * 1. exit code (agentSuccess 기준) 우선
 * 2. stderr 키워드 검사 (FATAL/uncaughtException/EPIPE)
 * 3. stdout 보고 형식 검사 (5단/처리불가)
 * 4. 최종 분류
 * 
 * @param result 작업 결과 텍스트 (fullResult)
 * @param logs 전체 로그 (job.logs)
 * @param agentSuccess runWorkerAgent의 success (exit 0 추론)
 * @param agentError runWorkerAgent의 error
 * @returns 최종 상태 + 사유
 */
export function classifyExit(
  result: string,
  logs: string[],
  agentSuccess: boolean,
  agentError?: string,
  textOnly = false,
): ClassifyResult {
  // 1. stderr 추출 (로그에서 [ERROR] 라인)
  const stderr = logs
    .filter((line) => line.includes("[ERROR]"))
    .join("\n")
    .slice(-2000); // 마지막 2000자

  // 2. stderr 키워드 검사 (FATAL/uncaughtException/EPIPE)
  const hasFatalError =
    /FATAL|uncaughtException|EPIPE/i.test(stderr) ||
    /error TS\d+|ERR!|FAILED/i.test(stderr);

  if (hasFatalError) {
    const signalMatch = stderr.match(/EPIPE|SIGKILL|SIGTERM|uncaughtException/i);
    const signal = signalMatch ? signalMatch[0] : "FATAL";
    return {
      status: "failed",
      reason: `stderr 치명 에러: ${signal}`,
    };
  }

  // 3. exit code 우선 (agentSuccess 기반)
  if (!agentSuccess) {
    // exit non-zero → failed 1차 후보
    // 하지만 stdout 보고가 있으면 completed 가능
    const hasReport =
      /원인|수정|재발\s*방지|검증|리스크/i.test(result) ||
      /처리\s*불가\s*\(.*\)/i.test(result);

    if (hasReport) {
      // 보고는 있지만 exit non-zero → outputs_missing
      return {
        status: "outputs_missing",
        reason: "작업 보고 있음 but exit non-zero",
      };
    } else {
      // 보고도 없고 exit non-zero → failed
      return {
        status: "failed",
        reason: agentError || "exit non-zero + 보고 누락",
      };
    }
  }

  if (textOnly) return { status: "completed" };

  // 4. exit 0 + 보고 형식 검사
  const has5StageReport =
    /원인|수정|재발\s*방지|검증|리스크/i.test(result) ||
    /1\.\s*원인.*2\.\s*수정.*3\.\s*재발/i.test(result);

  const hasProcessUnableReport = /처리\s*불가\s*\(.*\)/i.test(result);

  if (has5StageReport || hasProcessUnableReport) {
    // 정상 보고 → completed
    return { status: "completed" };
  }

  // 5. exit 0이지만 보고 누락 → outputs_missing
  const hasResultMarker = /\[결과\]|완료|종료/i.test(result);
  if (!hasResultMarker) {
    return {
      status: "outputs_missing",
      reason: "exit 0 but 보고 형식 누락",
    };
  }

  // 6. 기본: exit 0 + 결과 마커 있음 → completed
  return { status: "completed" };
}

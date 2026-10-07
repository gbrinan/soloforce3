/**
 * claude-error-retry.ts — Claude API 529/429 일시 오류 자동 재시도 헬퍼.
 *
 * 직원 작업 중 Claude CLI가 API 529(Overloaded) 또는 429(Rate Limit) 응답을 받으면
 * 출력(JSON result 또는 PTY 버퍼)에 패턴이 노출된다. 이를 감지해 지수 백오프로 재시도.
 *
 * 사용처:
 * - src/agent.ts runAgent (비인터랙티브 -p 워커 + 지니)
 * - src/server/worker-pty.ts runInteractiveWorker (인터랙티브 워커 PTY)
 */

/** 지수 백오프 간격 (재시도 N번째 = backoff[N-1]ms). 길이 = 최대 재시도 횟수. */
export const OVERLOAD_BACKOFFS_MS: readonly number[] = [3000, 8000, 20000, 40000];

/**
 * 백오프에 ±20% 지터 적용 — 워커 3 + 지니가 동시에 529를 맞으면 고정 간격으로는
 * 정확히 같은 시각에 재충돌해 과부하를 증폭한다. 호출부는 sleep(withJitter(base)) 사용.
 */
export function withJitter(baseMs: number): number {
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

/**
 * Claude API 일시 오류(529 Overloaded / 429 Rate Limit) 패턴 감지.
 */
export function isApiOverloadError(text: string): boolean {
  if (!text) return false;
  return /overloaded_error|rate_limit_error|\bOverloaded\b|HTTP\s+(?:529|429)\b|"status"\s*:\s*(?:529|429)\b|status\s+code\s+(?:529|429)\b/i.test(text);
}

export function isOAuthExpiredError(text: string): boolean {
  if (!text) return false;
  const plain = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  return /(?:failed to authenticate[\s\S]*?)?(?:API Error:\s*)?401[\s\S]*OAuth access token has expired/i.test(plain);
}

export async function retryOnceOnOAuthExpiration<T>(
  run: () => Promise<T>,
  reset: () => void | Promise<void>,
  textOf: (value: T) => string = (value) => String(value),
): Promise<T> {
  try {
    const value = await run();
    if (!isOAuthExpiredError(textOf(value))) return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isOAuthExpiredError(message)) throw error;
  }
  await reset();
  const retried = await run();
  if (isOAuthExpiredError(textOf(retried))) {
    throw new Error("Claude OAuth authentication still expired after session reset");
  }
  return retried;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

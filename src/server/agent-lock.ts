// Per-agent 직렬화 헬퍼.
// 한 에이전트당 단일 Promise 체인을 유지해 동시 호출을 순차화한다.
// 목적: claude --resume이 같은 세션을 동시에 재개해 대화가 분기되는 사고 방지.

const locks = new Map<string, Promise<unknown>>();

export async function withAgentLock<T>(
  agentId: string,
  task: () => Promise<T>,
): Promise<T> {
  const prev = (locks.get(agentId) ?? Promise.resolve()) as Promise<unknown>;
  // resolve/reject 모두 다음 task로 진행 (체인 끊김 방지)
  const next = prev.then(task, task);
  // 체인 자체는 rejection을 삼켜서 이후 호출이 계속 실행되게 유지.
  // 개별 호출자에겐 원본 next를 반환해 에러는 전파.
  locks.set(agentId, next.catch(() => undefined));
  return next as Promise<T>;
}

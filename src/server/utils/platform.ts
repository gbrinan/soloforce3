export const IS_WIN = process.platform === "win32";

// SIGHUP: PTY 소프트 종료 신호 — Windows에 없음.
// SIGKILL: 강제 종료 — Windows에서 named signal로 인식 안 됨.
const WIN_UNSUPPORTED = new Set<string>(["SIGHUP", "SIGKILL"]);

// ChildProcess.kill(signal?: number | Signals) 와 IPty.kill(signal?: string) 를 모두 수용.
// Killable.kill 파라미터를 Signals로 좁히면:
//   - ChildProcess.kill (number | Signals 수용) → Signals ⊆ number|Signals ✓
//   - IPty.kill (string 수용) → Signals ⊆ string ✓  (반변성 통과)
type Killable = { kill: (signal?: NodeJS.Signals) => unknown };

/**
 * Cross-platform kill helper.
 * Windows에서 SIGHUP/SIGKILL은 유효하지 않아 signal 없이 호출(TerminateProcess 폴백).
 * try/catch 포함 — 이미 종료된 프로세스 에러 무시.
 */
export function safeKill(target: Killable | number, signal?: NodeJS.Signals): void {
  const sig: NodeJS.Signals | undefined =
    IS_WIN && signal && WIN_UNSUPPORTED.has(signal) ? undefined : signal;
  try {
    if (typeof target === "number") {
      sig !== undefined ? process.kill(target, sig) : process.kill(target);
    } else {
      sig !== undefined ? target.kill(sig) : target.kill();
    }
  } catch { /* 이미 종료된 프로세스 무시 */ }
}

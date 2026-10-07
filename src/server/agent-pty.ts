/**
 * AgentPty — 에이전트 1개의 Claude CLI 인터랙티브 PTY 세션 래퍼.
 *
 * 워커 인터랙티브 전환의 기반 모듈. 마이크루(terminal-ws.ts)·워커가 공유 예정.
 * - 지연 spawn (ensureReady) + 동시 spawn 방지
 * - submitPrompt → bracketed-paste 주입 → submit_response 대기 (awaiter)
 * - idle 타임아웃 종료 (워커: 메모리 회수 / 마이크루: 0이면 무기한 유지)
 * - onData 콜백으로 출력 미러링 (WS 브로드캐스트 등)
 *
 * 캡슐화하지 않는 것 (caller 책임): WebSocket 미러·사용자 입력 추적·대화 저장·
 * MCP config 파일 생성(buildSpawn에서). AgentPty는 순수 PTY 수명 관리만.
 */
import * as pty from "node-pty";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isOAuthExpiredError } from "../claude-error-retry.js";
import { IS_WIN, safeKill } from "./utils/platform.js";

/**
 * PTY 에이전트(마이크루·워커)의 --append-system-prompt에 붙는 공용 지시문.
 * submit_response 호출 = '턴 종료' 신호. 호출하지 않으면 awaiter가 안 풀려
 * 에이전트가 busy 상태에 갇히므로, 응답할 내용이 없어도 반드시 호출하게 한다.
 */
export const SUBMIT_RESPONSE_DIRECTIVE =
  "[필수] 매 턴을 끝낼 때 예외 없이 submit_response MCP 툴을 호출하세요. " +
  "이 호출이 곧 '턴 종료' 신호입니다 — 호출하지 않으면 시스템이 응답을 기다리며 멈춥니다(busy 갇힘). " +
  "답할 내용이 있으면 그 전체를 content에 넣으세요. " +
  "별다른 답이 필요 없다고 판단한 경우(예: 단순 시스템 알림 확인, 추가 행동 불필요)에는 " +
  "content를 빈 문자열로 두고 submit_response를 호출하세요 — 빈 content는 턴만 끝내고 채팅에 표시되지 않습니다. " +
  "'확인 완료' 같은 불필요한 응답을 넣지 마세요.";

/**
 * claude --resume 대상 세션의 대화 파일(jsonl)이 실제 존재하는지 검사.
 * 없는 세션을 --resume하면 claude가 "No conversation found"로 즉시 종료 →
 * PTY 재spawn 루프에 빠지므로, resume 전 반드시 확인할 것.
 */
export function claudeSessionExists(sessionId: string, cwd: string): boolean {
  // Windows 경로의 콜론·백슬래시도 변환해야 실제 ~/.claude/projects 폴더명과 일치 (기존: 항상 불일치 → resume 전멸)
  const projDir = cwd.replace(/[\\/:.]/g, "-");
  return existsSync(join(homedir(), ".claude", "projects", projDir, `${sessionId}.jsonl`));
}

const REPLAY_BUFFER_MAX = 50 * 1024;                  // 50 KB
const DEFAULT_RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;   // 30분 — 툴 사용 긴 응답 대비
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const SUBMIT_ENTER_DELAY_MS = 80;                     // bracketed-paste 후 Enter 지연
const READY_MIN_MS = 2500;                            // spawn 후 TUI 입력창 초기화 최소 대기
const READY_QUIET_MS = 700;                           // 출력이 이만큼 조용 = 렌더 안정 = 입력 준비
const READY_MAX_MS = 12000;                           // 준비 감지 안전 상한
// claude TUI 입력창이 렌더되면 raw 출력에 입력 프롬프트 문자(❯)가 등장 — 이게 곧 입력 준비 신호.
// 타이밍 휴리스틱(floor/quiet/hardCap)보다 정확. 미검출 시 기존 타이머로 폴백.
const READY_PATTERN = /❯/;

// submit_response 누락 안전망 — awaiter SET 후 절대 시간 N분 경과하면 자동 해소.
// 기존 "입력 프롬프트 + 8초 안정" 모델은 TUI redraw(spinner·cursor blink 등)로 인해
// 새 출력이 끊임없이 흘러 타이머가 매번 리셋 → 실제로 발화 안 되는 한계가 있었음.
// → TUI 출력 신호 완전 무관, awaiter 펜딩 자체가 신호. 갇힘 = N분 후 강제 해소.
// [타임아웃 감사 C] 리스(32분)·응답한도(30분)와 순서 고정: 응답한도 30 < 여기 31 < 리스 32.
// 기존 15분은 리스와 동시발화해 같은 행이 "빈 출력 완료" 또는 "실패"로 비결정적이었다.
const STUCK_AWAITER_MS = 31 * 60 * 1000;
function nowHHMMSS(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

/** (재)spawn 시점에 caller가 제공하는 spawn 파라미터 */
export interface SpawnSpec {
  cliArgs: string[];
  cwd: string;
  env: Record<string, string>;
  /** 종료 시 호출 — 예: 임시 MCP config 파일 unlink */
  cleanup?: () => void;
}

export interface AgentPtyOptions {
  /** 로그·식별용 ("genie", "dev-pm" 등) */
  agentId: string;
  /** claude 실행 파일 경로 */
  claudePath: string;
  /** (재)spawn마다 호출 — 최신 cliArgs/env 생성. --resume 세션ID 등은 caller가 결정 */
  buildSpawn: () => Promise<SpawnSpec>;
  cols?: number;
  rows?: number;
  /** 0/미지정: idle-kill 안 함 (마이크루). >0: 마지막 활동 후 ms 경과 시 종료 (워커) */
  idleTimeoutMs?: number;
  /** submitPrompt가 submit_response를 기다리는 기본 최대 시간 */
  responseTimeoutMs?: number;
  /** PTY 출력 콜백 — 미러링용 */
  onData?: (data: string) => void;
  /** PTY 종료 콜백 (정상/비정상 모두) */
  onExit?: (exitCode: number) => void;
}

interface Awaiter {
  resolve: (s: string) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentPty {
  private proc: pty.IPty | null = null;
  private spawnInFlight: Promise<void> | null = null;
  private awaiter: Awaiter | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activeCleanup: (() => void) | null = null;
  private buf = "";
  private idleKillAt = 0;   // idle-kill 예정 시각(epoch ms) — 미무장 시 0
  // submit_response 누락 안전망 — awaiter SET 후 절대 시간 타이머
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  // waitForReady가 입력 프롬프트(❯)를 감지하면 true. proc 존재 ≠ CLI 입력 준비를 구분.
  private promptSeen = false;
  // 좀비 감지·강제 종료용 — proc이 null이 돼도 escalation timer가 SIGKILL까지 추적할 수 있게 보관.
  // spawn에서 기록, 정상 onExit에서 비움. cleanupState는 보존.
  private lastPid: number | undefined;
  // isHealthy() false-positive 방지용 — spawn 직후 OS 등록 지연 사이엔 healthy로 간주.
  private spawnedAt = 0;

  constructor(private readonly opts: AgentPtyOptions) {}

  get ready(): boolean { return this.proc !== null; }
  get pid(): number | undefined { return this.proc?.pid; }
  /** 재연결 시 replay할 최근 PTY 출력 */
  get replayBuffer(): string { return this.buf; }
  /** submitPrompt 응답 대기 중인지 */
  get busy(): boolean { return this.awaiter !== null; }
  /** idle-kill 예정 시각(epoch ms). 0이면 미무장(busy·미spawn·idleTimeout 0) */
  get idleDeadline(): number { return this.proc ? this.idleKillAt : 0; }

  /**
   * OS 레벨 PTY 프로세스 생존 검사.
   * spawn 직후 5초는 OS 등록 지연·핸들 노출 타이밍을 고려해 무조건 true (false-positive 방지).
   * 그 이후는 `process.kill(pid, 0)` (signal 0 = 존재 확인만, 실제 신호 미발송)으로 검증.
   */
  isHealthy(): boolean {
    if (!this.proc || !this.lastPid) return false;
    if (Date.now() - this.spawnedAt < 5000) return true;
    try { process.kill(this.lastPid, 0); return true; } catch { return false; }
  }

  /** PTY가 살아있도록 보장 — 없으면 spawn (동시 호출 안전) */
  async ensureReady(): Promise<void> {
    if (this.proc) return;
    if (!this.spawnInFlight) {
      this.spawnInFlight = this.spawn().finally(() => { this.spawnInFlight = null; });
    }
    await this.spawnInFlight;
  }

  private async spawn(): Promise<void> {
    this.buf = "";
    this.promptSeen = false;
    const spec = await this.opts.buildSpawn();
    const proc = pty.spawn(this.opts.claudePath, spec.cliArgs, {
      cwd: spec.cwd,
      env: spec.env,
      name: "xterm-256color",
      cols: this.opts.cols ?? DEFAULT_COLS,
      rows: this.opts.rows ?? DEFAULT_ROWS,
    });
    this.proc = proc;
    this.lastPid = proc.pid;
    this.spawnedAt = Date.now();
    this.activeCleanup = spec.cleanup ?? null;
    console.log(`[AgentPty:${this.opts.agentId}] spawn (pid=${proc.pid})`);

    proc.onData((data: string) => {
      this.buf += data;
      if (this.buf.length > REPLAY_BUFFER_MAX) {
        this.buf = this.buf.slice(-REPLAY_BUFFER_MAX);
      }
      this.opts.onData?.(data);
      if (this.awaiter && isOAuthExpiredError(this.buf)) {
        const a = this.awaiter;
        this.awaiter = null;
        clearTimeout(a.timer);
        this.clearStuckTimer();
        this.resetIdleTimer();
        a.reject(new Error("Failed to authenticate. API Error: 401 OAuth access token has expired."));
      }
    });

    proc.onExit(({ exitCode }) => {
      if (proc !== this.proc) return;  // 이미 교체된 PTY의 늦은 exit 무시
      console.log(`[AgentPty:${this.opts.agentId}] PTY 종료 (code=${exitCode})`);
      if (exitCode !== 0) {
        const tail = this.buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trim().slice(-1500);
        console.error(`[AgentPty:${this.opts.agentId}] 비정상 종료 출력 tail(${tail.length}):\n${tail || "(빈 버퍼)"}`);
      }
      this.cleanupState();
      this.lastPid = undefined;  // 정상 종료 — escalation 불필요
      this.opts.onExit?.(exitCode);
    });

    this.resetIdleTimer();
    await this.waitForReady(proc);
  }

  /**
   * claude TUI가 입력을 받을 준비가 될 때까지 대기.
   * spawn 직후 prompt를 주입하면 부팅 중 키입력(특히 Enter)이 유실됨 —
   * 최소 대기 후 출력이 READY_QUIET_MS 동안 조용해지면 준비 완료로 본다.
   */
  private waitForReady(proc: pty.IPty): Promise<void> {
    return new Promise<void>((resolve) => {
      // 이미 버퍼에 입력 프롬프트가 있으면(잔여 출력·주입 직전 재점검) 즉시 준비.
      if (this.promptSeen || READY_PATTERN.test(this.buf)) {
        this.promptSeen = true;
        resolve();
        return;
      }
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      let floorDone = false;
      let acc = "";
      const done = (): void => {
        clearTimeout(hardCap);
        clearTimeout(floorTimer);
        if (quietTimer) clearTimeout(quietTimer);
        dis.dispose();
        resolve();
      };
      const armQuiet = (): void => {
        floorDone = true;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(done, READY_QUIET_MS);
      };
      const hardCap = setTimeout(done, READY_MAX_MS);
      const floorTimer = setTimeout(armQuiet, READY_MIN_MS);
      const dis = proc.onData((data: string) => {
        // 입력 프롬프트(❯) 감지 = 입력창 렌더 완료 → 즉시 준비 (타이밍 폴백보다 정확).
        if (!this.promptSeen) {
          acc += data;
          if (acc.length > 4096) acc = acc.slice(-4096);
          if (READY_PATTERN.test(acc)) {
            this.promptSeen = true;
            done();
            return;
          }
        }
        if (quietTimer) { clearTimeout(quietTimer); quietTimer = null; }
        if (floorDone) armQuiet();
      });
    });
  }

  /**
   * prompt 주입 → submit_response 대기. 한 번에 하나만 (대기 중이면 throw).
   * @param timeoutMs 이 호출에 한정한 응답 타임아웃 (미지정 시 기본값)
   */
  async submitPrompt(text: string, timeoutMs?: number): Promise<string> {
    if (this.awaiter) throw new Error("agent_pty_busy");
    await this.ensureReady();
    const proc = this.proc;
    if (!proc) throw new Error("agent_pty_spawn_failed");
    // proc은 있으나 입력창 미준비(early-resolve·hardCap 폴백)면 주입 직전 한 번 더 대기.
    // ❯ 미검출이면 waitForReady가 quiet/hardCap로 bound — 키입력 유실(재시작 후 미정상화) 방지.
    if (!this.promptSeen) await this.waitForReady(proc);
    this.noteActivity();
    const ms = timeoutMs ?? this.opts.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.awaiter) {
          this.awaiter = null;
          this.resetIdleTimer();  // 작업 종료 — idle-kill 재무장
          reject(new Error("agent_pty_response_timeout"));
        }
      }, ms);
      this.awaiter = { resolve, reject, timer };
      console.log(`[AgentPty:${this.opts.agentId}] awaiter SET at ${nowHHMMSS()} (prompt: "${text.slice(0, 40).replace(/\n/g, " ")}…")`);
      this.resetIdleTimer();  // busy 진입 — idle-kill 정지
      // 안전망 무장 — STUCK_AWAITER_MS 후 awaiter 강제 해소 (submit_response 누락 보호)
      this.stuckTimer = setTimeout(() => {
        if (!this.awaiter) return;
        console.warn(`[AgentPty:${this.opts.agentId}] STUCK-AWAITER at ${nowHHMMSS()} — awaiter ${Math.round(STUCK_AWAITER_MS / 1000)}초 펜딩 → 자동 빈 응답`);
        const a = this.awaiter;
        this.awaiter = null;
        clearTimeout(a.timer);
        this.stuckTimer = null;
        this.resetIdleTimer();
        a.resolve("");
      }, STUCK_AWAITER_MS);
      // bracketed paste로 묶어 한 번에 넣고 Enter 제출 (claude TUI가 안정적으로 처리)
      try { proc.write(`\x1b[200~${text}\x1b[201~`); }
      catch (e) { this.handleSocketError(e); return; }
      setTimeout(() => {
        try { proc.write("\r"); }
        catch (e) { this.handleSocketError(e); }
      }, SUBMIT_ENTER_DELAY_MS);
    });
  }

  /**
   * submit_response 수신 처리. 대기 중 awaiter가 있으면 resolve하고 true 반환.
   * awaiter가 없거나 무의미한 응답이면 false (caller가 별도 처리 — 예: 저장).
   */
  receiveResponse(content: string): boolean {
    const trimmed = content.trim();
    this.noteActivity();
    // 괄호 상태 메시지("(대기 중)" 등) 무시
    if (/^\([^)]+\)$/.test(trimmed)) return false;
    if (this.awaiter) {
      const a = this.awaiter;
      this.awaiter = null;
      clearTimeout(a.timer);
      this.clearStuckTimer();
      this.resetIdleTimer();  // 작업 완료 — idle-kill 재무장
      console.log(`[AgentPty:${this.opts.agentId}] awaiter RESOLVED at ${nowHHMMSS()} (content ${trimmed.length}b)`);
      a.resolve(trimmed);
      return true;
    }
    return false;
  }

  /**
   * write 도중 PTY 소켓이 끊긴 경우 — proc 핸들은 살아있어 보여도 OS pipe가 죽어
   * onExit이 안 오는 케이스. awaiter reject + proc 해제로 다음 ensureReady가 재spawn.
   * lastPid는 보존(좀비 escalation/외부 정리 추적 가능). cleanupState와 달리 onExit·콜백 미트리거.
   */
  private handleSocketError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AgentPty:${this.opts.agentId}] PTY 소켓 에러 — ${msg}. proc 해제 후 다음 호출에서 재spawn`);
    const proc = this.proc;
    this.proc = null;
    this.buf = "";
    this.promptSeen = false;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.clearStuckTimer();
    if (this.activeCleanup) {
      try { this.activeCleanup(); } catch { /* */ }
      this.activeCleanup = null;
    }
    if (this.awaiter) {
      const a = this.awaiter;
      this.awaiter = null;
      clearTimeout(a.timer);
      a.reject(new Error(`agent_pty_socket_error: ${msg}`));
    }
    // proc.kill은 best-effort — 이미 죽었을 가능성 큼
    if (proc) { try { proc.kill(); } catch { /* */ } }
  }

  /** 진행 중단 (claude TUI: ESC). 대기 중 awaiter는 reject. */
  abort(): { ok: boolean; reason?: string } {
    if (!this.proc) return { ok: false, reason: "no_pty" };
    try {
      this.proc.write("\x1b");
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    if (this.awaiter) {
      const a = this.awaiter;
      this.awaiter = null;
      clearTimeout(a.timer);
      this.clearStuckTimer();
      this.resetIdleTimer();  // 작업 중단 — idle-kill 재무장
      a.reject(new Error("aborted"));
    }
    return { ok: true };
  }

  /** raw 입력 전달 (WebSocket 입력 패스스루용) */
  write(data: string): void {
    if (!this.proc) return;
    try {
      this.proc.write(data);
      this.noteActivity();
    } catch (e) {
      this.handleSocketError(e);
    }
  }

  resize(cols: number, rows: number): void {
    try { this.proc?.resize(cols, rows); } catch { /* */ }
  }

  /**
   * PTY 종료 — 다음 ensureReady/submitPrompt가 재spawn.
   *
   * force=false (기본): SIGHUP만 발송 (기존 동작 유지) — 정상 종료 경로.
   * force=true: SIGHUP → 1s 후 살아있으면 SIGTERM → +2s 후 살아있으면 SIGKILL.
   *   좀비/응답없음 PTY를 OS 레벨까지 확실히 정리. escalation은 비동기지만 시그니처는 동기 유지.
   *
   * cleanupState는 즉시 호출(awaiter reject·activeCleanup·proc=null) — escalation timer는
   * lastPid를 별도로 참조해 진행. 호출자는 await 없이 바로 다음 작업으로 진행 가능.
   */
  terminate(opts?: { force?: boolean }): void {
    const proc = this.proc;
    const pid = this.lastPid;
    const force = opts?.force === true;
    this.cleanupState();
    if (!proc) return;
    try { IS_WIN ? proc.kill() : proc.kill("SIGHUP"); } catch { /* */ }
    if (!force || !pid) return;
    // escalation: SIGHUP 1초 후 살아있으면 SIGTERM, +2초 후 살아있으면 SIGKILL.
    setTimeout(() => {
      try {
        process.kill(pid, 0);
        console.warn(`[AgentPty:${this.opts.agentId}] escalate → SIGTERM (pid=${pid})`);
        safeKill(pid, "SIGTERM");
        setTimeout(() => {
          try {
            process.kill(pid, 0);
            console.warn(`[AgentPty:${this.opts.agentId}] escalate → SIGKILL (pid=${pid})`);
            safeKill(pid, "SIGKILL");
          } catch { /* 이미 죽음 — 정상 */ }
        }, 2000);
      } catch { /* SIGHUP으로 정상 종료 — 추가 escalation 불필요 */ }
    }, 1000);
  }

  /** 활동 발생 표시 — idle 타이머 리셋 */
  noteActivity(): void { this.resetIdleTimer(); }

  private clearStuckTimer(): void {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
  }

  private cleanupState(): void {
    this.proc = null;
    this.buf = "";
    this.promptSeen = false;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.clearStuckTimer();
    if (this.activeCleanup) {
      try { this.activeCleanup(); } catch { /* */ }
      this.activeCleanup = null;
    }
    if (this.awaiter) {
      const a = this.awaiter;
      this.awaiter = null;
      clearTimeout(a.timer);
      a.reject(new Error("agent_pty_terminated"));
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.idleKillAt = 0;
    const ms = this.opts.idleTimeoutMs ?? 0;
    // busy(awaiter 대기 = 작업 처리 중)면 idle-kill 무장 안 함 — 작업 끝나 awaiter
    // 해제 시 무장. (출력만 흐르는 긴 작업이 idle로 오인돼 죽던 버그 방지)
    if (ms > 0 && this.proc && !this.awaiter) {
      this.idleKillAt = Date.now() + ms;
      this.idleTimer = setTimeout(() => {
        console.log(`[AgentPty:${this.opts.agentId}] idle ${Math.round(ms / 1000)}초 초과 — PTY 종료`);
        this.terminate();
      }, ms);
    }
  }
}

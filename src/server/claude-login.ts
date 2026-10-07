// 클로드코드 로그인 반자동화 (1-2 잔여) — 온보딩 게이트의 [로그인 시작] 버튼용.
// 서버가 `claude`를 PTY로 띄워 인터랙티브 로그인 흐름을 진행하고, 출력에서 OAuth URL을
// 추출해 게이트 화면에 바로 표시한다. 사용자는 브라우저에서 로그인만 하면 되고,
// 인증 코드 붙여넣기가 필요한 경우 게이트의 입력창이 PTY stdin으로 중계한다.
//
// 보안 노트: 이 모듈의 API는 SSO 이전 게이트에서 호출된다(claude/install과 동일 신뢰 수준).
// 서버는 127.0.0.1 바인딩이며, PTY 입력은 claude 로그인 프로세스에만 전달된다.
import * as pty from "node-pty";
import { homedir } from "node:os";
import { safeChildEnv } from "./utils/safeChildEnv.js";
import { claudeAuthed } from "./claude-cli.js";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";

// ANSI 이스케이프 제거 — URL 파싱·화면 tail 표시용
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g;
// claude 로그인 OAuth URL — 실측(2026-07) claude.com/cai/oauth/authorize. 구/신 도메인 모두 수용.
const OAUTH_URL_RE = /https:\/\/(?:claude\.(?:ai|com)|(?:console|platform)\.(?:anthropic|claude)\.com)\/[^\s"'\])>]*oauth[^\s"'\])>]*/i;
const SUCCESS_RE = /login successful|logged in|successfully logged/i;
// 기본값 선택으로 넘어가도 되는 프롬프트(테마 선택, 로그인 방식 기본=구독 계정)
const PROMPT_RE = /Enter to confirm|to select|text style|❯/i;

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
// URL 발견 타임아웃 — claude CLI 버전업으로 온보딩 프롬프트 구조가 바뀌어 auto-Enter가
// 안 먹으면 URL이 영영 안 나온다. 10분 세션 타임아웃까지 사용자를 방치하지 않도록
// 90초 안에 URL이 안 보이면 조기 실패시켜 게이트가 수동 폴백을 즉시 펼치게 한다.
const URL_DISCOVERY_TIMEOUT_MS = 90 * 1000;
const MAX_AUTO_ENTER = 6;
const TAIL_LIMIT = 4000;

export interface ClaudeLoginStatus {
  running: boolean;
  url: string | null;
  done: boolean;
  authenticated: boolean;
  tail: string;
  error?: string;
}

interface LoginSession {
  proc: pty.IPty | null;
  output: string;
  url: string | null;
  done: boolean;
  authenticated: boolean;
  error?: string;
  autoEnters: number;
  autoEnterTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  urlTimer: NodeJS.Timeout | null;
}

let session: LoginSession | null = null;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function finish(s: LoginSession, authenticated: boolean, error?: string): void {
  if (s.done) return;
  s.done = true;
  s.authenticated = authenticated;
  if (error) s.error = error;
  if (s.autoEnterTimer) { clearTimeout(s.autoEnterTimer); s.autoEnterTimer = null; }
  if (s.killTimer) { clearTimeout(s.killTimer); s.killTimer = null; }
  if (s.urlTimer) { clearTimeout(s.urlTimer); s.urlTimer = null; }
  // 로그인 성공 후 claude는 REPL로 남으므로 잠시 뒤 정리한다.
  const proc = s.proc;
  if (proc) {
    setTimeout(() => { try { proc.kill(); } catch { /* already dead */ } }, 1500);
    s.proc = null;
  }
}

// 게이트 [로그인 시작] — 이미 진행 중이면 그 세션 상태를 그대로 반환(idempotent).
export function startClaudeLogin(): ClaudeLoginStatus {
  if (claudeAuthed()) return { running: false, url: null, done: true, authenticated: true, tail: "" };
  if (session && !session.done) return getClaudeLoginStatus();

  const s: LoginSession = {
    proc: null,
    output: "",
    url: null,
    done: false,
    authenticated: false,
    autoEnters: 0,
    autoEnterTimer: null,
    killTimer: null,
    urlTimer: null,
  };
  session = s;

  try {
    // cols=1000: OAuth URL(400자 이상)이 PTY 하드랩으로 줄바꿈되면 URL 파싱이 조각나므로
    // 충분히 넓게 잡아 한 줄에 출력되게 한다 (실측: 100컬럼에서 URL 4줄 분절 → 추출 실패).
    s.proc = pty.spawn(CLAUDE_PATH, [], {
      name: "xterm-256color",
      cols: 1000,
      rows: 30,
      cwd: homedir(),
      env: safeChildEnv() as Record<string, string>,
    });
  } catch (e) {
    finish(s, false, e instanceof Error ? e.message : String(e));
    return getClaudeLoginStatus();
  }

  s.killTimer = setTimeout(() => {
    finish(s, false, "로그인 대기 타임아웃 (10분)");
  }, SESSION_TIMEOUT_MS);
  // URL 발견 실패 조기 감지 — CLI 프롬프트 구조 변화 등으로 진행이 막히면 90초 후
  // 실패 처리해 게이트가 수동 폴백을 바로 안내한다 (10분 방치 방지).
  s.urlTimer = setTimeout(() => {
    if (!s.url && !s.done) finish(s, false, "로그인 링크를 얻지 못했습니다 (90초)");
  }, URL_DISCOVERY_TIMEOUT_MS);

  s.proc.onData((chunk) => {
    s.output = (s.output + chunk).slice(-64_000);
    const plain = stripAnsi(s.output);

    if (!s.url) {
      const m = OAUTH_URL_RE.exec(plain);
      if (m) {
        s.url = m[0];
        if (s.urlTimer) { clearTimeout(s.urlTimer); s.urlTimer = null; }
      }
    }
    if (SUCCESS_RE.test(plain)) {
      finish(s, true);
      return;
    }
    // URL이 나오기 전 선택 프롬프트(테마·로그인 방식)는 기본값 Enter로 자동 진행.
    // 1.2초 디바운스 — 렌더링 중간 조각에 반응하지 않도록.
    if (!s.url && !s.done && s.autoEnters < MAX_AUTO_ENTER && PROMPT_RE.test(stripAnsi(chunk))) {
      if (s.autoEnterTimer) clearTimeout(s.autoEnterTimer);
      s.autoEnterTimer = setTimeout(() => {
        if (s.done || s.url || !s.proc) return;
        s.autoEnters += 1;
        try { s.proc.write("\r"); } catch { /* proc gone */ }
      }, 1200);
    }
  });

  s.proc.onExit(({ exitCode }) => {
    // 종료 시점에 자격 파일이 생겼다면 성공으로 판정 (성공 문구를 놓친 경우 대비)
    if (!s.done) {
      const authed = claudeAuthed();
      finish(s, authed, authed || exitCode === 0 ? undefined : `claude 종료코드 ${exitCode}`);
    }
  });

  return getClaudeLoginStatus();
}

export function getClaudeLoginStatus(): ClaudeLoginStatus {
  if (!session) return { running: false, url: null, done: false, authenticated: false, tail: "" };
  const s = session;
  return {
    running: !s.done && s.proc !== null,
    url: s.url,
    done: s.done,
    authenticated: s.authenticated,
    tail: stripAnsi(s.output).slice(-TAIL_LIMIT),
    error: s.error,
  };
}

// 게이트 입력창 → PTY stdin 중계 (인증 코드 붙여넣기 등). 빈 문자열은 Enter만 전송.
export function sendClaudeLoginInput(text: string): { ok: boolean; error?: string } {
  if (!session || session.done || !session.proc) return { ok: false, error: "로그인 세션이 없습니다" };
  try {
    session.proc.write(text ? `${text}\r` : "\r");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function cancelClaudeLogin(): { ok: boolean } {
  if (session && !session.done) finish(session, false, "사용자 취소");
  session = null;
  return { ok: true };
}

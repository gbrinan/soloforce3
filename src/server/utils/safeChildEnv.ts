/**
 * AI 자식 프로세스에 전달할 최소 환경변수 화이트리스트.
 * process.env 전체 상속을 차단해 서버 시크릿(API 키·토큰·비밀번호)이
 * Claude/Codex 등 AI 자식 프로세스로 누출되지 않도록 한다.
 */

/**
 * 절대 자식 프로세스로 전달 금지 — 클로드 구독 인증 강제.
 * ANTHROPIC_API_KEY/AUTH_TOKEN이 자식 env에 있으면 claude CLI가 유료 PAYG API로
 * 인증해 크레딧을 소모한다(잔액 소진 시 워커 전체 실패). 화이트리스트·extra·
 * allowedEnvKeys 어떤 경로로 들어오든 최종 단계에서 무조건 제거해 워커가
 * 항상 ~/.claude 구독 OAuth 토큰으로만 인증하도록 강제한다.
 */
const BLOCKED_KEYS: ReadonlyArray<string> = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
];

const SAFE_KEYS: ReadonlyArray<string> = [
  "PATH",
  "HOME",
  "TMPDIR", "TEMP", "TMP",
  "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES",
  "TERM",
  "USER", "USERNAME", "LOGNAME",
  "NODE_ENV",
  "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR",
  "SHELL",
  "DISPLAY",       // Linux GUI 지원용
  "COLORTERM", "FORCE_COLOR",  // 터미널 색상
  "CODEX_PATH", "CODEX_HOME", "CODEX_CA_CERTIFICATE",  // codex 어댑터 자체 인증·바이너리 경로
  // Windows 필수 시스템 변수 — 누락 시 claude.cmd→cmd.exe→node 초기화가
  // 0xC0000142(STATUS_DLL_INIT_FAILED)/0xC0000409로 실패한다(시크릿 아님).
  "SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "APPDATA", "LOCALAPPDATA", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
];

/**
 * 화이트리스트 키만 포함한 환경변수 객체를 반환.
 * extra로 추가 키를 주입할 수 있다 (MYCREW_*, MCP_* 등 동적 값).
 */
export function safeChildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) env[k] = v;
    }
  }
  // 클로드 구독 인증 강제: 어떤 경로로든 유입된 앤트로픽 유료 API 키를 최종 제거.
  for (const blocked of BLOCKED_KEYS) delete env[blocked];
  return env;
}

/**
 * 전체 환경 상속이 필요한 spawn(앱·bash·자기 재기동)용: 그대로 복사하되 앤트로픽 유료 API 키만 제거.
 * (2026-10-02) jobs 사후검증 bash·SafeBash·앱 spawn·드라이런이 process.env를 통째로 넘겨
 * 키가 유입되면 그 안에서 실행된 claude가 PAYG 크레딧을 쓸 수 있었다.
 */
export function withoutAnthropicKeys(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  for (const blocked of BLOCKED_KEYS) delete out[blocked];
  return out;
}

/** claude -p (비대화형 워커) 실행에 추가로 필요한 키 — Google OAuth·PORT·NGROK 제외 */
const CLI_AUTH_KEYS: ReadonlyArray<string> = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_PATH",
  "CLAUDE_HOME",
  "NODE_OPTIONS",
  "NODE_PATH",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
  "TZ",
  "WORKSPACE_ROOT", "PROJECTS_FOLDER",
];

/**
 * claude -p 워커용: SAFE_KEYS + CLI_AUTH_KEYS 화이트리스트.
 * Google OAuth (CLIENT_ID/SECRET/REFRESH_TOKEN)·PORT·NGROK_URL·TUNNEL_URL은
 * 워커에 전달하지 않는다.
 */
export function safeChildEnvForCli(extra?: Record<string, string>): Record<string, string> {
  const cliExtra: Record<string, string> = {};
  for (const k of CLI_AUTH_KEYS) {
    const v = process.env[k];
    if (v !== undefined) cliExtra[k] = v;
  }
  return safeChildEnv({ ...cliExtra, ...extra });
}

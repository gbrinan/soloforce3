// app-registry: discovers optional apps installed at ~/<app-id>/ via manifest.json.
// PoC scope: single hard-coded app id "photos" at ~/mycrew-photos/manifest.json.
// Future: scan ~/mycrew-apps/*/manifest.json or a configured search path.
import { closeSync, existsSync, openSync, readFileSync, statSync, readdirSync, watch } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest, Agent as HttpAgent } from "node:http";
import { getGatewayToken } from "./ai-gateway.js";

import { withoutAnthropicKeys } from "./utils/safeChildEnv.js";
// 스토어 설치 온보딩 — 앱별 인프라 세팅 안내. 매니페스트 선택 필드로, 없으면 온보딩 UI 미표시.
// 소비처: (1) 스토어 설치 완료 다이얼로그(scripts/gen-store-aifeatures.mjs가 스토어에 bake),
//        (2) 마이크루 최초 실행 온보딩 모달(/api/apps/manifest 경유, src/client/components/AppSetupGuideModal.tsx).
export interface AppSetupGuideStep {
  title: string;
  detail?: string;
}
export interface AppSetupGuideEnvVar {
  name: string;       // envName (예: RESEND_API_KEY)
  label?: string;     // 사람용 라벨
  required?: boolean; // 기본 false(선택)
}
export interface AppSetupGuideService {
  name: string;
  url: string;
  desc?: string;
}
export interface AppSetupGuide {
  intro?: string;                    // 한 줄 요약 (키 없을 때 동작 등)
  steps: AppSetupGuideStep[];        // 단계 목록
  envVars?: AppSetupGuideEnvVar[];   // 필요 환경변수
  services?: AppSetupGuideService[]; // 외부 서비스 안내
  docsUrl?: string;                  // 문서 링크
}

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  icon?: string;
  category: "core" | "optional";
  entry: { kind: "iframe" | "window"; url: string; bypassProxy?: boolean };
  ports?: { http?: number };
  ws?: string;
  capabilities?: string[];
  removeScript?: string;
  healthPath?: string;
  autostart?: boolean;
  description?: string;
  setupGuide?: AppSetupGuide;
  // 프록시 경로 처리: "strip"(기본) = `/api/apps/:id/proxy/` 프리픽스 제거 후 전달(상대경로 SPA용),
  // "passthrough" = 프리픽스 유지 후 전달(Next.js basePath 앱용).
  proxyMode?: "strip" | "passthrough";
}

// Each app id has an ordered list of manifest candidate paths. First existing wins.
// Program-relative paths (optional-apps/, apps/) cover distributed ZIP layout.
// Home-absolute fallback (~/mycrew-photos) covers the dev/source checkout.
const KNOWN_APPS: { id: string; manifestPaths: string[] }[] = [
  {
    id: "photos",
    manifestPaths: [
      resolve(process.cwd(), "apps/photos/manifest.json"),
      resolve(process.cwd(), "optional-apps/photos/manifest.json"),
      join(homedir(), "mycrew-photos/manifest.json"),
    ],
  },
  {
    id: "sign",
    manifestPaths: [
      resolve(process.cwd(), "apps/isenssign/manifest.json"),
    ],
  },
  {
    id: "movie",
    manifestPaths: [
      resolve(process.cwd(), "apps/mymovie/manifest.json"),
    ],
  },
  {
    id: "design",
    manifestPaths: [
      resolve(process.cwd(), "apps/design/manifest.json"),
    ],
  },
  {
    id: "pdf",
    manifestPaths: [
      resolve(process.cwd(), "apps/pdf/manifest.json"),
    ],
  },
  {
    id: "booking",
    manifestPaths: [
      resolve(process.cwd(), "apps/booking/manifest.json"),
    ],
  },
  {
    id: "mail",
    manifestPaths: [
      resolve(process.cwd(), "apps/mail/manifest.json"),
    ],
  },
  // payment(구독 관리)는 로컬 앱에서 제거 — 스토어(store.dooitspace.com/subscriptions)로 이전.
  // 데이터 백엔드(/api/payment/*)는 이 서버에 유지된다.
  {
    id: "approval",
    manifestPaths: [
      resolve(process.cwd(), "apps/approval/manifest.json"),
    ],
  },
  {
    id: "mymaps",
    manifestPaths: [
      resolve(process.cwd(), "apps/mymaps/manifest.json"),
    ],
  },
  {
    id: "notes",
    manifestPaths: [
      resolve(process.cwd(), "apps/notes/manifest.json"),
    ],
  },
  {
    id: "calc",
    manifestPaths: [
      resolve(process.cwd(), "apps/calc/manifest.json"),
    ],
  },
  {
    id: "hd-cleaner",
    manifestPaths: [
      resolve(process.cwd(), "apps/hd-cleaner/manifest.json"),
    ],
  },
  {
    id: "bookshelf",
    manifestPaths: [
      resolve(process.cwd(), "apps/bookshelf/manifest.json"),
    ],
  },
  {
    id: "ledger",
    manifestPaths: [
      resolve(process.cwd(), "apps/ledger/manifest.json"),
    ],
  },
  {
    id: "diary",
    manifestPaths: [
      resolve(process.cwd(), "apps/diary/manifest.json"),
    ],
  },
  {
    id: "learn",
    manifestPaths: [
      resolve(process.cwd(), "apps/learn/manifest.json"),
    ],
  },
  {
    id: "finance",
    manifestPaths: [
      resolve(process.cwd(), "apps/finance/manifest.json"),
    ],
  },
  {
    id: "leads",
    manifestPaths: [
      resolve(process.cwd(), "apps/leads/manifest.json"),
    ],
  },
  {
    id: "spf",
    manifestPaths: [
      resolve(process.cwd(), "apps/spf/manifest.json"),
    ],
  },
  {
    id: "projects",
    manifestPaths: [
      resolve(process.cwd(), "apps/projects/manifest.json"),
    ],
  },
  {
    id: "anandara",
    manifestPaths: [
      resolve(process.cwd(), "../mycrew-works/anandara/manifest.json"),
    ],
  },
];

// MyCrew Store v1.1 — 동적 앱 스캔: ~/mycrew-apps/<id>/manifest.json 형태로 설치된 앱을 자동 인식.
// KNOWN_APPS 하드코딩은 유지(기존 앱 하위호환), 동적 스캔은 id 미충돌 시에만 추가된다.
function discoverDynamicApps(): { id: string; manifestPaths: string[] }[] {
  const baseDir = join(homedir(), "mycrew-apps");
  if (!existsSync(baseDir)) return [];
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: entry.name,
        manifestPaths: [join(baseDir, entry.name, "manifest.json")],
      }));
  } catch (err) {
    console.warn("[app-registry] dynamic scan failed:", err);
    return [];
  }
}

function getAllAppSources(): { id: string; manifestPaths: string[] }[] {
  // 겹치는 앱(기본 apps/<id> vs 스토어 ~/mycrew-apps/<id>)은 드롭하지 않고 후보 경로를 합친다.
  // loadOne이 후보들 중 최신 버전을 선택하므로, 스토어에 더 최신 버전이 설치되면 기본 앱이
  // 자동으로 그 버전으로 갱신된다.
  const byId = new Map<string, { id: string; manifestPaths: string[] }>();
  for (const a of KNOWN_APPS) byId.set(a.id, { id: a.id, manifestPaths: [...a.manifestPaths] });
  for (const d of discoverDynamicApps()) {
    const existing = byId.get(d.id);
    if (existing) {
      for (const mp of d.manifestPaths) if (!existing.manifestPaths.includes(mp)) existing.manifestPaths.push(mp);
    } else {
      byId.set(d.id, { id: d.id, manifestPaths: [...d.manifestPaths] });
    }
  }
  return Array.from(byId.values());
}

const cache = new Map<string, AppManifest>();
const manifestFilePaths = new Map<string, string>(); // appId → absolute manifest file path
let initialScanComplete = false;
let pollTimer: NodeJS.Timeout | null = null;
const watchers: (() => void)[] = [];

// Stale-chunk supervisor state
const childPidMap = new Map<string, number>(); // appId → last spawned child PID (best-effort)
// 사용자가 최소 1회 활성화(정상 응답/기동)한 앱 집합. autostart=false여도 이 목록의 앱이
// 죽으면 stale-supervisor가 자동 복구한다(부팅 시 콜드스타트는 하지 않아 autostart 의미 보존).
const activatedApps = new Set<string>();
const warmDebounce = new Map<string, number>(); // appId → 마지막 ensureAppWarm 시각(ms), 중복 spawn 방지
const restartCooldown = new Map<string, number>(); // appId → last restart timestamp (ms)
const restartFailCount = new Map<string, number>(); // appId → consecutive stale-restart failures
const restartFailAt = new Map<string, number>(); // appId → last failure timestamp (ms)
const RESTART_COOLDOWN_MS = 60_000;
const RESTART_MAX_FAILURES = 3;
// 3회 실패 후에도 일정 시간이 지나면 재시도 허용 — 일시적 원인(빌드 중, 포트 점유)이
// 해소된 뒤 영구 포기 상태로 남아 앱 진입 불가가 지속되던 문제 방지.
const RESTART_FAILURE_RESET_MS = 30 * 60 * 1000;
let staleTimer: NodeJS.Timeout | null = null;

// 매니페스트 version 문자열 비교(간이 semver). a>b면 1, a<b면 -1, 동률 0.
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => String(v ?? "0").split(/[.+-]/).map((x) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : 0; });
  const pa = parse(a), pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function loadOne(id: string, paths: string[]): { manifest: AppManifest; filePath: string } | null {
  // 후보 경로 중 존재하는 매니페스트를 모두 파싱해 최신 version을 선택한다.
  // 동률이면 먼저 나온 경로(= 기본 경로 우선)를 유지한다.
  let best: { manifest: AppManifest; filePath: string } | null = null;
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const m = JSON.parse(raw) as AppManifest;
      if (m.id !== id) {
        console.warn(`[app-registry] manifest id mismatch at ${filePath}: expected ${id}, got ${m.id}`);
        continue;
      }
      if (!best || compareVersions(m.version, best.manifest.version) > 0) {
        if (best) console.log(`[app-registry] ${id}: 최신 버전 우선 ${best.manifest.version} → ${m.version} (${filePath})`);
        best = { manifest: m, filePath };
      }
    } catch (err) {
      console.warn(`[app-registry] manifest parse failed for ${id} at ${filePath}:`, err);
    }
  }
  return best;
}

// For passthrough apps, Next.js routes live under basePath (/api/apps/{id}/proxy).
// Direct server-side pings must include the basePath; the client adds it separately.
// keep-alive를 쓰지 않는 전용 http agent. undici(fetch)의 전역 keep-alive 소켓 풀이
// 헬스체크/스테일 프로브 반복 호출마다 소켓을 재사용 풀에 방치해 fd가 누수(장시간
// 가동 후 spawn EBADF)되던 문제를 근본 차단한다. 응답 소비 후 소켓이 즉시 닫힌다.
const probeAgent = new HttpAgent({ keepAlive: false, maxSockets: 8 });

// http.request 기반 프로브. { status } 반환. 본문은 needBody일 때만 수집(스테일 HTML 파싱용).
function httpProbe(
  url: string,
  opts: { method?: string; timeoutMs?: number; needBody?: boolean } = {},
): Promise<{ status: number; body: string }> {
  const { method = "GET", timeoutMs = 3000, needBody = false } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const done = (status: number, body: string) => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    try {
      const req = httpRequest(url, { method, agent: probeAgent, timeout: timeoutMs }, (res) => {
        const status = res.statusCode ?? 0;
        if (!needBody) {
          res.resume(); // 본문 drain → 소켓 해제
          res.on("end", () => done(status, ""));
          res.on("error", () => done(status, ""));
          return;
        }
        let data = "";
        res.setEncoding("utf-8");
        res.on("data", (c) => { if (data.length < 200_000) data += c; });
        res.on("end", () => done(status, data));
        res.on("error", () => done(status, data));
      });
      req.on("timeout", () => { req.destroy(); done(0, ""); });
      req.on("error", () => done(0, ""));
      req.end();
    } catch {
      done(0, "");
    }
  });
}

function resolveHealthUrl(manifest: AppManifest): string | null {
  const port = manifest.ports?.http;
  if (!port) return null;
  const rawPath = manifest.healthPath ?? "/api/health";
  const path = manifest.proxyMode === "passthrough"
    ? `/api/apps/${manifest.id}/proxy${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`
    : rawPath;
  return `http://127.0.0.1:${port}${path}`;
}

async function pingHealth(manifest: AppManifest): Promise<boolean> {
  const url = resolveHealthUrl(manifest);
  if (!url) return false;
  try {
    const { status } = await httpProbe(url, { timeoutMs: 3000 });
    return status >= 200 && status < 400;
  } catch {
    return false;
  }
}

// PATH used when spawning app processes (mirrors LaunchAgent EnvironmentVariables)
// [로컬 패치] Mac 전용 하드코딩이 Windows PATH(;) 첫 항목을 오염시키던 것 분기 처리.
const SPAWN_PATH = process.platform === "win32"
  ? (process.env.PATH ?? "")
  : `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`;

// Read KEY=VALUE lines from .env then .env.local (.env.local overrides), injected into
// spawned app processes so secrets are available even if the app's own loader hasn't run yet.
// (구 start-*.sh 래퍼가 `source .env` 하던 것을 대체 — 앱을 app-registry 단일 관리로 통합.)
function readDotEnvLocal(dir: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of [".env", ".env.local"]) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    try {
      for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq < 1) continue;
        const key = t.slice(0, eq).trim();
        vars[key] = t.slice(eq + 1).replace(/^(["'])([\s\S]*)\1$/, "$2");
      }
    } catch { /* 파일 하나 실패는 무시 */ }
  }
  return vars;
}

// 앱 프로세스 스폰 공용 환경변수 — 3개 스폰 지점(pre-warm·재빌드후·재기동)이 공유해
// 구성 드리프트를 막는다. 구 start-*.sh 래퍼(NODE_ENV·basePath·ipv4first)와 동등.
// [리소스 감사 #1] npm start 래퍼(~45MB×앱 수)가 실제 서버 프로세스를 베이비시팅만 하던 것 제거 —
// package.json scripts.start 명령을 shell로 직접 실행한다(.bin은 appSpawnEnv가 PATH에 주입).
// start 스크립트가 없으면 기존 npm start로 폴백.
function resolveStartSpawn(appDir: string): { cmd: string; args: string[] } {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf-8")) as { scripts?: { start?: string } };
    const start = pkg.scripts?.start?.trim();
    if (start) return { cmd: start, args: [] };
  } catch { /* 폴백 */ }
  return { cmd: "npm", args: ["start"] };
}

function appSpawnEnv(id: string, appDir: string, port: number): NodeJS.ProcessEnv {
  const apiUrl = process.env.MYCREW_API_URL || `http://127.0.0.1:${process.env.PORT || "3457"}`;
  return {
    ...process.env,
    ...readDotEnvLocal(appDir),
    PATH: `${join(appDir, "node_modules", ".bin")}${process.platform === "win32" ? ";" : ":"}${SPAWN_PATH}`,
    PORT: String(port),
    NODE_ENV: "production",
    NODE_OPTIONS: "--dns-result-order=ipv4first",
    // Next 앱 프록시 basePath (빌드타임 baked 값과 일치 — 런타임 config 참조 대비 belt-and-suspenders).
    NEXT_PUBLIC_BASE_PATH: `/api/apps/${id}/proxy`,
    // 앱 AI 호출 비용 귀속(@mycrew/ai-client) + 게이트웨이 위임(인증·레이트리밋·비용 일원화).
    MYCREW_APP_ID: id,
    MYCREW_API_URL: apiUrl,
    MYCREW_AI_GATEWAY_URL: `${apiUrl}/api/ai/generate`,
    MYCREW_AI_GATEWAY_TOKEN: getGatewayToken(),
  };
}

async function listPortPids(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    const lsof = spawn("lsof", ["-ti", `:${port}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    lsof.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    lsof.on("close", () => {
      try { lsof.stdout?.destroy(); } catch { /* ignore */ }
      resolve(out.trim().split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)));
    });
    lsof.on("error", () => resolve([])); // lsof unavailable → skip
  });
}

function readPidCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    const lsof = spawn("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    lsof.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    lsof.on("close", () => {
      try { lsof.stdout?.destroy(); } catch { /* ignore */ }
      const line = out.split(/\r?\n/).find((s) => s.startsWith("n"));
      resolve(line ? line.slice(1) : null);
    });
    lsof.on("error", () => resolve(null));
  });
}

function isInsideDir(path: string, dir: string): boolean {
  const child = resolve(path);
  const parent = resolve(dir);
  return child === parent || child.startsWith(`${parent}/`);
}

// Kill only app-owned processes listening on the given port. Unknown owners are left alone.
async function killPortProcesses(port: number, appId: string, appDir: string): Promise<boolean> {
  const pids = await listPortPids(port);
  if (pids.length === 0) return true;

  let killed = 0;
  const expectedPid = childPidMap.get(appId);
  for (const pid of pids) {
    let owned = expectedPid === pid;
    if (!owned) {
      const cwd = await readPidCwd(pid);
      owned = !!cwd && isInsideDir(cwd, appDir);
    }
    if (!owned) {
      console.warn(`[app-registry] refusing to kill PID ${pid} on :${port}; it is not owned by ${appId}`);
      continue;
    }
    try {
      process.kill(pid, "SIGTERM");
      killed++;
    } catch {
      // already dead
    }
  }
  return killed > 0;
}

// Probe Next.js assets to detect stale build manifests in a running process.
// Returns true = healthy (or inconclusive), false = stale chunks detected (500/404).
async function probeChunk(manifest: AppManifest): Promise<boolean> {
  const port = manifest.ports?.http;
  if (!port) return true;
  const basePath = manifest.proxyMode === "passthrough"
    ? `/api/apps/${manifest.id}/proxy`
    : "";
  try {
    const main = await httpProbe(`http://127.0.0.1:${port}${basePath}/`, { timeoutMs: 5000, needBody: true });
    if (!(main.status >= 200 && main.status < 400)) return true; // page error is not our stale-detection domain
    const html = main.body;
    // Match full asset paths (includes any basePath prefix for passthrough apps).
    // CSS can be stale even when the first JS chunk still exists, so probe both.
    const refs = [...html.matchAll(/["']((?:\/[^\s"'<>]*)?_next\/static\/(?:chunks|css)\/[^\s"'<>]+\.(?:js|css))["']/g)]
      .map((match) => match[1])
      .filter((ref, index, all) => all.indexOf(ref) === index)
      .slice(0, 12);
    if (!refs.length) return true; // not a Next.js page or no assets found → assume OK
    for (const ref of refs) {
      const assetUrl = `http://127.0.0.1:${port}${ref}`;
      const asset = await httpProbe(assetUrl, { method: "HEAD", timeoutMs: 3000 });
      if (asset.status === 500 || asset.status === 404) return false;
    }
    return true;
  } catch {
    return true; // network/timeout error → don't spuriously restart
  }
}

// Check one app for stale chunks and restart if stale (with cooldown + failure cap).
async function checkAndRestartStale(manifest: AppManifest): Promise<void> {
  const { id } = manifest;
  const port = manifest.ports?.http;
  if (!port) return;

  let failCount = restartFailCount.get(id) ?? 0;
  if (failCount >= RESTART_MAX_FAILURES) {
    // 3회 연속 실패 시 일단 포기하되, 30분 경과 후 1회 사이클 재허용 (영구 포기 방지)
    if (Date.now() - (restartFailAt.get(id) ?? 0) < RESTART_FAILURE_RESET_MS) return;
    console.warn(`[app-registry] stale restart ${id}: 실패 ${failCount}회 후 ${RESTART_FAILURE_RESET_MS / 60000}분 경과 — 재시도 재개`);
    failCount = 0;
    restartFailCount.set(id, 0);
  }
  if (Date.now() - (restartCooldown.get(id) ?? 0) < RESTART_COOLDOWN_MS) return;

  const healthy = await probeChunk(manifest);
  if (healthy) {
    if (failCount > 0) restartFailCount.set(id, 0); // reset on clean probe
    return;
  }

  console.warn(`[app-registry] stale chunks on ${id}:${port} — restarting (attempt ${failCount + 1}/${RESTART_MAX_FAILURES})`);
  restartCooldown.set(id, Date.now());

  const filePath = manifestFilePaths.get(id);
  if (!filePath) {
    console.error(`[app-registry] stale restart ${id}: manifest path lost, aborting`);
    restartFailCount.set(id, failCount + 1);
    restartFailAt.set(id, Date.now());
    return;
  }
  const appDir = dirname(filePath);
  const killed = await killPortProcesses(port, id, appDir);
  if (!killed) {
    console.error(`[app-registry] stale restart ${id}: port ${port} is held by an unknown process, aborting auto-restart`);
    restartFailCount.set(id, failCount + 1);
    restartFailAt.set(id, Date.now());
    return;
  }
  await new Promise<void>((r) => setTimeout(r, 1500)); // let OS release port

  let logFd = -1;
  try { logFd = openSync(join(appDir, ".app.log"), "a"); } catch { /* noop */ }
  const st = resolveStartSpawn(appDir);
  const child = spawn(st.cmd, st.args, {
    cwd: appDir,
    // 명령 문자열 실행이므로 전 플랫폼 shell (npm 폴백 시 Windows npm.cmd ENOENT도 함께 해결)
    shell: true,
    // [로컬 패치] Windows: shell+detached 스폰은 windowsHide 없으면 매번 콘솔 창이 뜬다.
    // 재기동 루프와 겹치면 창 폭풍이 되므로 반드시 유지할 것.
    windowsHide: true,
    detached: true,
    stdio: logFd >= 0 ? ["ignore", logFd, logFd] : "ignore",
    env: appSpawnEnv(id, appDir, port),
  });
  child.on("error", (err) => {
    console.error(`[app-registry] stale restart spawn error (${id}):`, err.message);
    restartFailCount.set(id, (restartFailCount.get(id) ?? 0) + 1);
    restartFailAt.set(id, Date.now());
  });
  if (child.pid) {
    childPidMap.set(id, child.pid);
    console.log(`[app-registry] stale restart ${id}: spawned PID ${child.pid}`);
  }
  child.unref();
  if (logFd >= 0) try { closeSync(logFd); } catch { /* noop */ }
}

async function runStaleSupervisor(): Promise<void> {
  for (const manifest of listManifests()) {
    if (!manifest.ports?.http) continue;
    // 죽은 앱 자동 복구: health 실패 시 warmOneApp으로 재기동(내부 재빌드 가드 포함).
    // "앱이 죽으면 자동 재기동 트리거 부재 → 진입 불가"가 방치되던 문제를 해소한다.
    if (manifest.autostart || activatedApps.has(manifest.id)) {
      const alive = await pingHealth(manifest);
      if (!alive) {
        // [로컬 패치] 이 분기가 checkAndRestartStale의 실패 카운터를 우회해 무한 재spawn(창 폭풍)을 일으켰다.
        // 포트가 Windows 예약 대역에 갇히는 등 구조적으로 못 뜨는 앱은 영원히 실패하므로 동일 정책으로 가드한다.
        const failCount = restartFailCount.get(manifest.id) ?? 0;
        if (failCount >= RESTART_MAX_FAILURES) {
          if (Date.now() - (restartFailAt.get(manifest.id) ?? 0) < RESTART_FAILURE_RESET_MS) continue;
          console.warn(`[app-registry] stale-supervisor: ${manifest.id} 실패 ${failCount}회 후 ${RESTART_FAILURE_RESET_MS / 60000}분 경과 — 재시도 재개`);
          restartFailCount.set(manifest.id, 0);
        }
        console.log(`[app-registry] stale-supervisor: ${manifest.id} 응답 없음 → 재기동 (${(restartFailCount.get(manifest.id) ?? 0) + 1}/${RESTART_MAX_FAILURES})`);
        await warmOneApp(manifest.id, manifest, { force: true });
        if (!(await pingHealth(manifest))) {
          restartFailCount.set(manifest.id, (restartFailCount.get(manifest.id) ?? 0) + 1);
          restartFailAt.set(manifest.id, Date.now());
        } else {
          restartFailCount.set(manifest.id, 0);
        }
        continue;
      }
      restartFailCount.set(manifest.id, 0); // 정상 응답 → 카운터 리셋
      // 살아있어도 빌드가 프로세스보다 최신이면(가동 중 릴리스로 재빌드됨) 재기동해 새 buildId 로드.
      const fp = manifestFilePaths.get(manifest.id);
      const appDir = fp ? dirname(fp) : null;
      if (appDir
          && !hasLaunchAgent(manifest.id)
          && await isProcessOlderThanBuild(appDir, manifest.ports.http)) {
        console.log(`[app-registry] stale-supervisor: ${manifest.id} 빌드가 프로세스보다 최신 → 재기동`);
        await restartAppProcess(manifest.id, appDir, manifest.ports.http);
        continue;
      }
    }
    await checkAndRestartStale(manifest);
  }
}

// 앱 소스가 빌드 산출물(.next/BUILD_ID 또는 dist)보다 최신이면 true.
// 에이전트가 소스만 고치고 재빌드를 누락하면 stale 빌드가 서빙되어 (1) 소스 변경 미반영,
// (2) 재빌드 트리거 순간 청크 해시 불일치로 404 → 앱 진입 에러가 "돌아가며" 발생한다.
function isBuildStale(appDir: string): boolean {
  let markerMtime = 0;
  const nextId = join(appDir, ".next", "BUILD_ID");
  const dist = join(appDir, "dist");
  if (existsSync(nextId)) markerMtime = statSync(nextId).mtimeMs;
  else if (existsSync(dist)) markerMtime = statSync(dist).mtimeMs;
  else return false; // 빌드 마커 없음 → 판단 불가, 강제 재빌드 안 함
  const srcDir = join(appDir, "src");
  if (!existsSync(srcDir)) return false;
  try {
    for (const ent of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const fp = join(ent.parentPath ?? (ent as unknown as { path: string }).path, ent.name);
      if (statSync(fp).mtimeMs > markerMtime) return true;
    }
  } catch { /* 스캔 실패 시 재빌드 강제 안 함 */ }
  return false;
}

// 빌드 마커(.next/BUILD_ID 또는 dist)의 mtime(ms). 없으면 0.
function buildMarkerMtime(appDir: string): number {
  const nextId = join(appDir, ".next", "BUILD_ID");
  const dist = join(appDir, "dist");
  try {
    if (existsSync(nextId)) return statSync(nextId).mtimeMs;
    if (existsSync(dist)) return statSync(dist).mtimeMs;
  } catch { /* noop */ }
  return 0;
}

// PID의 프로세스 시작 시각(epoch ms). 조회 불가 시 0.
function pidStartMs(pid: number): Promise<number> {
  return new Promise((resolve) => {
    const ps = spawn("ps", ["-p", String(pid), "-o", "lstart="], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    ps.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    ps.on("close", () => {
      const t = Date.parse(out.trim());
      resolve(Number.isFinite(t) ? t : 0);
    });
    ps.on("error", () => resolve(0));
  });
}

// 실행 중 프로세스가 "재빌드된 산출물"보다 오래됐는지 — 즉 빌드 후 재기동 누락 상태.
// 이 경우 프로세스는 기동 시점 buildId를 메모리에 물고 서빙하지만 디스크 static은 새 buildId로
// 교체돼 클라이언트 네비게이션 시 청크 404 → 앱 미동작("빌드할 때마다 재발")의 근본 원인.
async function isProcessOlderThanBuild(appDir: string, port: number): Promise<boolean> {
  const marker = buildMarkerMtime(appDir);
  if (marker === 0) return false; // 빌드 마커 없음(정적 서빙) → 대상 아님
  const pids = await listPortPids(port);
  if (pids.length === 0) return false;
  const start = await pidStartMs(pids[0]);
  if (start === 0) return false;
  // 빌드가 프로세스 기동보다 5초 이상 최신이면 stale (파일시스템 시차 여유분).
  return marker > start + 5_000;
}

// package.json에 build 스크립트가 있으면 반환.
function hasBuildScript(appDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf-8"));
    return typeof pkg?.scripts?.build === "string" && pkg.scripts.build.length > 0;
  } catch { return false; }
}

// 전용 LaunchAgent(launchd)로 관리되는 앱인지 판별.
// 이런 앱(sign·mail·pdf·design·booking·mymaps 등)은 launchd가 프로세스를 소유하므로
// mycrew가 재기동하면 충돌하고, 일부(sign)는 특수 빌드(standalone 정적 자산 복사)가 필요하다.
// → 아래 stale 자동 재빌드/재기동 대상에서 제외하고 각자의 배포 스크립트에 맡긴다.
function hasLaunchAgent(id: string): boolean {
  const dir = join(homedir(), "Library", "LaunchAgents");
  return existsSync(join(dir, `com.dooitspace.${id}.plist`))
      || existsSync(join(dir, `com.dooitspace.mycrew-${id}.plist`));
}

// 실행 중이지만 소스가 빌드보다 최신인 app-registry 관리 앱을 재빌드 후 재기동한다.
// 가용성 우선: 빌드 성공 시에만 기존 프로세스를 교체(빌드 실패 시 기존 stale 인스턴스 유지).
async function rebuildAndRestartApp(id: string, appDir: string, port: number): Promise<void> {
  const b = spawnSync("npm", ["run", "build"], {
    cwd: appDir,
    env: withoutAnthropicKeys({ ...process.env, ...readDotEnvLocal(appDir), PATH: SPAWN_PATH }),
    timeout: 180_000,
    stdio: "ignore",
  });
  if (b.status !== 0) {
    console.warn(`[app-registry] ${id}: stale 재빌드 실패(status=${b.status}) — 기존 인스턴스 유지`);
    return;
  }
  const killed = await killPortProcesses(port, id, appDir);
  if (!killed) {
    console.warn(`[app-registry] ${id}: 재빌드 후 :${port} 종료 실패 — 재기동 생략`);
    return;
  }
  await new Promise<void>((r) => setTimeout(r, 1500)); // OS 포트 해제 대기
  let logFd = -1;
  try { logFd = openSync(join(appDir, ".app.log"), "a"); } catch { /* noop */ }
  const st = resolveStartSpawn(appDir);
  const child = spawn(st.cmd, st.args, {
    cwd: appDir,
    // 명령 문자열 실행이므로 전 플랫폼 shell (npm 폴백 시 Windows npm.cmd ENOENT도 함께 해결)
    shell: true,
    // [로컬 패치] Windows: shell+detached 스폰은 windowsHide 없으면 매번 콘솔 창이 뜬다.
    // 재기동 루프와 겹치면 창 폭풍이 되므로 반드시 유지할 것.
    windowsHide: true,
    detached: true,
    stdio: logFd >= 0 ? ["ignore", logFd, logFd] : "ignore",
    env: appSpawnEnv(id, appDir, port),
  });
  child.on("error", (err) => console.warn(`[app-registry] ${id}: stale 재기동 spawn 오류:`, err.message));
  if (child.pid) {
    childPidMap.set(id, child.pid);
    console.log(`[app-registry] ${id}: stale 재빌드 후 재기동 PID ${child.pid}`);
  }
  child.unref();
  if (logFd >= 0) try { closeSync(logFd); } catch { /* noop */ }
}

// 빌드는 그대로 두고 프로세스만 재기동(kill + npm start). 재빌드가 이미 끝났고 프로세스만
// 오래된 경우 사용 — 새 buildId를 메모리에 로드해 청크 불일치를 해소한다.
async function restartAppProcess(id: string, appDir: string, port: number): Promise<void> {
  const killed = await killPortProcesses(port, id, appDir);
  if (!killed) {
    console.warn(`[app-registry] ${id}: :${port} 종료 실패 — 재기동 생략`);
    return;
  }
  await new Promise<void>((r) => setTimeout(r, 1500)); // OS 포트 해제 대기
  let logFd = -1;
  try { logFd = openSync(join(appDir, ".app.log"), "a"); } catch { /* noop */ }
  const st = resolveStartSpawn(appDir);
  const child = spawn(st.cmd, st.args, {
    cwd: appDir,
    // 명령 문자열 실행이므로 전 플랫폼 shell (npm 폴백 시 Windows npm.cmd ENOENT도 함께 해결)
    shell: true,
    // [로컬 패치] Windows: shell+detached 스폰은 windowsHide 없으면 매번 콘솔 창이 뜬다.
    // 재기동 루프와 겹치면 창 폭풍이 되므로 반드시 유지할 것.
    windowsHide: true,
    detached: true,
    stdio: logFd >= 0 ? ["ignore", logFd, logFd] : "ignore",
    env: appSpawnEnv(id, appDir, port),
  });
  child.on("error", (err) => console.warn(`[app-registry] ${id}: 재기동 spawn 오류:`, err.message));
  if (child.pid) {
    childPidMap.set(id, child.pid);
    console.log(`[app-registry] ${id}: 재기동 PID ${child.pid} (재빌드 생략)`);
  }
  child.unref();
  if (logFd >= 0) try { closeSync(logFd); } catch { /* noop */ }
}

async function warmOneApp(id: string, manifest: AppManifest, opts: { force?: boolean } = {}): Promise<void> {
  const port = manifest.ports?.http;
  if (!port) return;
  const healthy = await pingHealth(manifest);
  if (healthy) {
    activatedApps.add(id); // 정상 응답 확인 → 활성 앱으로 표시(이후 자동복구 대상)
    // 실행 중이어도 소스가 빌드보다 최신이면 stale 빌드를 서빙 중 → 재빌드 후 재기동.
    // (에이전트가 소스만 커밋하고 재빌드를 누락하면 "변경 미반영"이 방치되던 근본 원인.)
    // LaunchAgent 관리 앱은 launchd 소유 + 특수 빌드 필요 → 제외(각자 배포 스크립트에 위임).
    const runningFilePath = manifestFilePaths.get(id);
    const runningAppDir = runningFilePath ? dirname(runningFilePath) : null;
    if (runningAppDir && manifest.autostart && !hasLaunchAgent(id)
        && hasBuildScript(runningAppDir) && isBuildStale(runningAppDir)) {
      console.log(`[app-registry] pre-warm ${id}: 실행 중이나 소스가 빌드보다 최신 → 재빌드 후 재기동`);
      await rebuildAndRestartApp(id, runningAppDir, port);
    } else if (runningAppDir && manifest.autostart && !hasLaunchAgent(id)
        && await isProcessOlderThanBuild(runningAppDir, port)) {
      // 빌드는 최신이나 프로세스가 재빌드 이전 기동본 → 재빌드 없이 재기동만 하면 새 buildId 로드.
      // (활성 LaunchAgent 앱은 제외 — 현재 전 앱 plist는 .disabled라 모두 app-registry 관리 대상.)
      console.log(`[app-registry] pre-warm ${id}: 실행 중이나 빌드가 프로세스보다 최신 → 재기동(재빌드 생략)`);
      await restartAppProcess(id, runningAppDir, port);
    } else {
      console.log(`[app-registry] pre-warm ${id}: ✓ already running on :${port}`);
    }
    return;
  }
  if (!manifest.autostart && !opts.force) {
    console.warn(`[app-registry] pre-warm ${id}: ✗ not responding on :${port} (autostart=false — skipping spawn)`);
    return;
  }
  const filePath = manifestFilePaths.get(id);
  if (!filePath) return;
  const appDir = dirname(filePath);
  // 재빌드 가드: 소스가 빌드보다 최신이면 기동 전에 재빌드해 stale 빌드 서빙을 원천 차단.
  if (hasBuildScript(appDir) && isBuildStale(appDir)) {
    console.log(`[app-registry] pre-warm ${id}: 소스가 빌드보다 최신 → 재빌드 후 기동`);
    const b = spawnSync("npm", ["run", "build"], {
      cwd: appDir,
      env: withoutAnthropicKeys({ ...process.env, ...readDotEnvLocal(appDir), PATH: SPAWN_PATH }),
      timeout: 180_000,
      stdio: "ignore",
    });
    if (b.status !== 0) {
      console.warn(`[app-registry] pre-warm ${id}: 재빌드 실패(status=${b.status}) — 기존 빌드로 기동`);
    } else {
      console.log(`[app-registry] pre-warm ${id}: 재빌드 완료`);
    }
  }
  console.log(`[app-registry] pre-warm ${id}: ✗ not ready, spawning 'npm start' in ${appDir}`);
  let logFd = -1;
  try { logFd = openSync(join(appDir, ".app.log"), "a"); } catch { /* noop */ }
  const st = resolveStartSpawn(appDir);
  const child = spawn(st.cmd, st.args, {
    cwd: appDir,
    // 명령 문자열 실행이므로 전 플랫폼 shell (npm 폴백 시 Windows npm.cmd ENOENT도 함께 해결)
    shell: true,
    // [로컬 패치] Windows: shell+detached 스폰은 windowsHide 없으면 매번 콘솔 창이 뜬다.
    // 재기동 루프와 겹치면 창 폭풍이 되므로 반드시 유지할 것.
    windowsHide: true,
    detached: true,
    stdio: logFd >= 0 ? ["ignore", logFd, logFd] : "ignore",
    env: appSpawnEnv(id, appDir, port),
  });
  child.on("error", (err) =>
    console.warn(`[app-registry] autostart spawn error (${id}):`, err.message),
  );
  if (child.pid) childPidMap.set(id, child.pid);
  activatedApps.add(id); // 기동 시도 → 활성 앱으로 표시(죽으면 supervisor가 자동복구)
  child.unref();
  if (logFd >= 0) try { closeSync(logFd); } catch { /* noop */ }
}

function rescan(): void {
  for (const { id, manifestPaths } of getAllAppSources()) {
    const result = loadOne(id, manifestPaths);
    const next = result?.manifest ?? null;
    const prev = cache.get(id);
    if (next && !prev) {
      cache.set(id, next);
      manifestFilePaths.set(id, result!.filePath);
      console.log(`[app-registry] discovered: ${id}`);
      if (initialScanComplete) {
        void warmOneApp(id, next); // (c) 런타임 신규 앱 등록 시 자동 기동 훅
      }
    } else if (!next && prev) {
      cache.delete(id);
      manifestFilePaths.delete(id);
      console.log(`[app-registry] removed: ${id}`);
    } else if (next && prev && JSON.stringify(next) !== JSON.stringify(prev)) {
      cache.set(id, next);
      if (result) manifestFilePaths.set(id, result.filePath);
      console.log(`[app-registry] updated: ${id}`);
    }
  }
}

// Pre-warm all registered apps: ping health endpoints and optionally auto-start if needed.
// Called on portal startup. Non-blocking — failures are logged, not thrown.
export async function preWarmApps(): Promise<void> {
  const manifests = listManifests();
  await Promise.allSettled(manifests.map((m) => warmOneApp(m.id, m)));
}

export function startAppRegistry(): void {
  rescan();
  initialScanComplete = true;
  // fs.watch on the parent directory of each manifest candidate (more reliable than watching the file)
  for (const { id, manifestPaths } of getAllAppSources()) {
    for (const manifestPath of manifestPaths) {
      const dir = join(manifestPath, "..");
      try {
        if (existsSync(dir)) {
          const w = watch(dir, { persistent: false }, () => setTimeout(rescan, 200));
          watchers.push(() => w.close());
        }
      } catch (err) {
        console.warn(`[app-registry] watch failed for ${id} (${manifestPath}):`, err);
      }
    }
  }
  // Polling fallback (30s) — covers fs.watch gaps on macOS network/iCloud paths
  pollTimer = setInterval(rescan, 30_000);
  staleTimer = setInterval(() => { void runStaleSupervisor(); }, 3 * 60_000);
}

export function stopAppRegistry(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
  for (const close of watchers) try { close(); } catch {}
  watchers.length = 0;
  cache.clear();
}

export function listManifests(): AppManifest[] {
  return Array.from(cache.values());
}

export function getManifest(id: string): AppManifest | undefined {
  return cache.get(id);
}

// 프록시가 죽은 업스트림(ECONNREFUSED 등)을 만났을 때 호출하는 온디맨드 기동 훅.
// autostart=false 앱도 사용자가 열면 강제 기동한다. 15초 디바운스로 중복 spawn을 막고,
// 활성 앱으로 등록해 이후 죽으면 supervisor가 자동복구하게 한다. fire-and-forget(비블로킹).
export function ensureAppWarm(id: string): void {
  const manifest = cache.get(id);
  if (!manifest || !manifest.ports?.http) return;
  const now = Date.now();
  if (now - (warmDebounce.get(id) ?? 0) < 15_000) return;
  warmDebounce.set(id, now);
  activatedApps.add(id);
  void warmOneApp(id, manifest, { force: true });
}

// 앱 명시적 재시작 — 연동 마법사에서 키 저장 후 새 env로 재기동할 때 사용.
// 앱 소유 프로세스만 종료(killPortProcesses의 소유권 검사) 후 warmOneApp으로 재기동
// (재빌드 가드 포함 — Vite류 빌드타임 env 앱도 소스/빌드 stale 시 자동 재빌드).
export async function restartApp(id: string): Promise<{ ok: boolean; error?: string }> {
  const manifest = cache.get(id);
  if (!manifest) return { ok: false, error: `알 수 없는 앱: ${id}` };
  const port = manifest.ports?.http;
  if (!port) return { ok: false, error: `HTTP 포트 없는 앱: ${id}` };
  const filePath = manifestFilePaths.get(id);
  if (!filePath) return { ok: false, error: `매니페스트 경로 유실: ${id}` };
  const appDir = dirname(filePath);
  try {
    await killPortProcesses(port, id, appDir);
    await new Promise<void>((r) => setTimeout(r, 1500)); // 포트 해제 대기
    await warmOneApp(id, manifest, { force: true });
    console.log(`[app-registry] restartApp ${id}: 재기동 완료 요청 (health는 비동기 회복)`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

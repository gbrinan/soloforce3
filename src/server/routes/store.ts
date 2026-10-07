// MyCrew Store v1.3-BE — pair/install/uninstall/check-updates 실 구현
// 설계 문서: history/outputs/planner-researcher/2026-07-02-mycrew-store-design.md
// 시드 데이터: history/outputs/planner-researcher/2026-07-02-mycrew-store-v1.5-seed-manifests.md
import { Hono } from "hono";
import type { Context } from "hono";
import { randomInt, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile as fsWriteFile, readFile as fsReadFile, mkdtemp } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve as pathResolve, sep } from "node:path";
import { importStoreSession, getCurrentSession, hasAnyValidSession } from "../auth-google.js";
import { restartApp } from "../app-registry.js";
import { PROJECT_SELF_DIR } from "../../config.js";

const execFileAsync = promisify(execFile);

// 스토어 SSO(Private-Hub) 공개 기본값 — 패키지 배포본이 STORE_AUTH_SUPABASE_* env 없이도
// access_token을 검증할 수 있게 한다. anon 키는 스토어 프론트 번들에 이미 공개되는 설계값이며
// 여기서는 /auth/v1/user 읽기 전용 토큰 검증에만 쓰인다(쓰기·RLS 우회 아님).
const STORE_AUTH_SUPABASE_URL_DEFAULT = "https://yyknaylktzanlcnwuecb.supabase.co";
const STORE_AUTH_SUPABASE_ANON_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5a25heWxrdHphbmxjbnd1ZWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDcwMjQsImV4cCI6MjA4OTkyMzAyNH0.9U0mO5suI6z7LVeSYliRV78QjSiV6xcEvaJc8SprCk0";

export const storeRoutes = new Hono();

// mycrew-store(store.dooitspace.com)는 별도 오리진에서 이 서버(localhost)로 fetch하므로
// 명시적으로 허용한 오리진에 한해 CORS 응답 헤더를 붙인다. 매칭 실패 시 헤더 없이 통과
// (브라우저가 응답 본문 읽기를 차단 — 서버측 상태는 변경되지 않으므로 안전).
function allowedStoreOrigins(): string[] {
  return (
    process.env.STORE_ORIGIN ||
    "http://localhost:3000,https://store.dooitspace.com,https://mycrew-store.vercel.app"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeadersFor(origin: string | undefined): Record<string, string> | undefined {
  if (!origin || !allowedStoreOrigins().includes(origin)) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    // store.dooitspace.com(공개 HTTPS)이 localhost(사설망) 대상으로 fetch하므로
    // Chrome Private Network Access(PNA) preflight가 이 헤더 없이는 실 요청을 차단한다.
    "Access-Control-Allow-Private-Network": "true",
  };
}

function preflight(c: Context): Response {
  return new Response(null, { status: 204, headers: corsHeadersFor(c.req.header("Origin")) });
}

// ── 페어링 (10분 TTL, 메모리 저장 — 서버 재시작 시 소실되어도 무방한 단기 토큰) ──────────
interface PairRecord {
  expiresAt: number;
  userId?: string;
}
const PAIR_TTL_MS = 10 * 60 * 1000;
const pairs = new Map<string, PairRecord>();

function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function resolvePair(code: string): PairRecord | null {
  const rec = pairs.get(code);
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    pairs.delete(code);
    return null;
  }
  return rec;
}

// 페어링 코드에 연결된 사용자 UUID. store SSO(importStoreSession)로 로그인한 세션만
// supabaseUserId를 갖는다. v1.7 감사 B-4 P0: 과거엔 세션이 없으면 아래 플레이스홀더
// UUID를 모든 미인증 사용자가 공유해서 썼다 — 서로 다른 사용자의 백업/설치 소유권을
// 우회할 수 있는 취약점이었다. 이제 기본값은 401이며, 로컬 개발 편의를 위해서만
// .env에 STORE_ALLOW_ANON=1을 명시적으로 설정한 경우에 한해 폴백을 허용한다
// (프로덕션 배포 시 STORE_ALLOW_ANON을 절대 설정하지 말 것. 0003 마이그레이션 주석 참조).
const PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001";

function isAnonFallbackAllowed(): boolean {
  return process.env.STORE_ALLOW_ANON === "1";
}

// ── 로컬 인증 상태 (스토어 자동 로그인용) ─────────────────────────────────────
// 스토어(store.dooitspace.com)가 "이 컴퓨터의 마이크루에 로그인된 사용자가 있는가"를
// 조회해, 있으면 구글 재인증을 자동 트리거한다(비밀번호 없이 복귀).
// SameSite=Lax 쿠키는 크로스사이트 fetch에 실리지 않으므로 쿠키 대신 서버측
// 세션 존재 여부(boolean)만 노출 — 이메일 등 식별 정보는 반환하지 않는다.
storeRoutes.options("/local-auth-state", preflight);
storeRoutes.get("/local-auth-state", (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));
  return c.json({ authenticated: hasAnyValidSession() }, 200, cors);
});

storeRoutes.options("/pair", preflight);
storeRoutes.post("/pair", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));
  const session = getCurrentSession(c);
  let code = generatePairingCode();
  while (pairs.has(code)) code = generatePairingCode();
  const expiresAt = Date.now() + PAIR_TTL_MS;
  pairs.set(code, { expiresAt, userId: session?.supabaseUserId });
  return c.json({ code, expiresAt }, 200, cors);
});

/**
 * POST /api/store/session-import
 * mycrew-store(Supabase Google SSO)에서 발급한 access_token을 받아
 * Supabase Auth API로 유효성 검증 후, 허용 이메일(ALLOWED_EMAILS)이면
 * MyCrew 본체 세션 쿠키(mycrew_sid)를 발급해 SSO를 브릿지한다.
 * 요청은 사용자 브라우저가 localhost로 직접 보내므로 origin 검증 후 CORS 허용.
 */
storeRoutes.options("/session-import", preflight);

storeRoutes.post("/session-import", async (c: Context) => {
  const cors = corsHeadersFor(c.req.header("Origin"));

  let body: { access_token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400, cors);
  }
  const token = body.access_token;
  if (!token) return c.json({ error: "missing_access_token" }, 400, cors);

  // SSO 로그인(access_token 발급)은 스토어 프론트의 NEXT_PUBLIC Supabase(Private-Hub)에서
  // 일어나므로 토큰 검증도 같은 프로젝트를 향해야 한다. STORE_SUPABASE_URL(mycrew 데이터
  // 프로젝트)로 검증하면 발급 주체가 달라 항상 invalid_token이 된다.
  // 패키지 배포본은 STORE_AUTH_SUPABASE_* env가 없으므로 공개 Private-Hub 기본값으로 폴백.
  const supaUrl = process.env.STORE_AUTH_SUPABASE_URL || process.env.STORE_SUPABASE_URL || STORE_AUTH_SUPABASE_URL_DEFAULT;
  const supaAnonKey = process.env.STORE_AUTH_SUPABASE_ANON_KEY || process.env.STORE_SUPABASE_ANON_KEY || STORE_AUTH_SUPABASE_ANON_KEY_DEFAULT;
  if (!supaUrl || !supaAnonKey) {
    return c.json({ error: "store_supabase_not_configured" }, 503, cors);
  }

  let supaUser: { id?: string; email?: string; user_metadata?: Record<string, unknown> };
  try {
    const res = await fetch(`${supaUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supaAnonKey },
    });
    if (!res.ok) return c.json({ error: "invalid_token" }, 401, cors);
    supaUser = (await res.json()) as typeof supaUser;
  } catch (err) {
    console.error("[store/session-import] Supabase 토큰 검증 실패:", err);
    return c.json({ error: "token_verify_failed" }, 502, cors);
  }

  const email = (supaUser.email || "").toLowerCase();
  if (!email) return c.json({ error: "email_missing" }, 400, cors);
  const meta = supaUser.user_metadata || {};
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : undefined;
  const picture = typeof meta.avatar_url === "string" ? meta.avatar_url : typeof meta.picture === "string" ? meta.picture : undefined;

  const result = importStoreSession(c, email, name, picture, supaUser.id);
  if (!result.ok) {
    const status = result.reason === "sso_disabled" ? 503 : 403;
    return c.json({ error: result.reason }, status, cors);
  }
  return c.json({ ok: true, email: result.email, name: result.name ?? null, avatar_url: result.picture ?? null }, 200, cors);
});

// ── Supabase REST 헬퍼 (service role key — RLS 우회한 서버측 쓰기/조회) ──────────────────
interface ManifestRow {
  id: string;
  kind: "skill" | "plugin" | "app";
  name: string;
  version: string;
  artifact_url: string;
  artifact_sha256: string;
  artifact_type: string;
  artifact_size_bytes: number | null;
  install_path: string;
  category?: string | null;
}

function storeSupabaseConfig(): { url: string; serviceKey: string } | null {
  const url = process.env.STORE_SUPABASE_URL;
  const serviceKey = process.env.STORE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/+$/, ""), serviceKey };
}

async function supabaseRest(path: string, init: RequestInit = {}): Promise<Response> {
  const cfg = storeSupabaseConfig();
  if (!cfg) throw new Error("store_supabase_not_configured");
  return fetch(`${cfg.url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function findManifestByArtifactUrl(artifactUrl: string): Promise<ManifestRow | null> {
  const res = await supabaseRest(`/manifests?artifact_url=eq.${encodeURIComponent(artifactUrl)}&select=*`);
  if (!res.ok) throw new Error(`manifests query failed (${res.status})`);
  const rows = (await res.json()) as ManifestRow[];
  return rows[0] ?? null;
}

async function findManifestById(id: string): Promise<ManifestRow | null> {
  const res = await supabaseRest(`/manifests?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!res.ok) throw new Error(`manifests query failed (${res.status})`);
  const rows = (await res.json()) as ManifestRow[];
  return rows[0] ?? null;
}

async function upsertInstallation(userId: string, manifestId: string, installedVersion: string): Promise<void> {
  const res = await supabaseRest("/installations?on_conflict=user_id,manifest_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([
      {
        user_id: userId,
        manifest_id: manifestId,
        installed_version: installedVersion,
        mycrew_instance: "local-primary",
        last_updated_at: new Date().toISOString(),
      },
    ]),
  });
  if (!res.ok) throw new Error(`installations upsert failed (${res.status}): ${await res.text().catch(() => "")}`);
}

async function deleteInstallation(userId: string, manifestId: string): Promise<void> {
  const res = await supabaseRest(
    `/installations?user_id=eq.${encodeURIComponent(userId)}&manifest_id=eq.${encodeURIComponent(manifestId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`installations delete failed (${res.status})`);
}

// 실제 Supabase user.id(SSO 세션에서 확보)가 없으면 null을 반환한다.
// 호출부는 반드시 null을 401 unauthenticated 응답으로 처리해야 한다 — 절대 다른 값으로
// 조용히 대체하지 말 것(v1.7 감사 B-4 P0 재발 방지).
function userIdForPair(pair: PairRecord | null): string | null {
  if (pair?.userId) return pair.userId;
  return isAnonFallbackAllowed() ? PLACEHOLDER_USER_ID : null;
}

function unauthenticatedStoreResponse(c: Context, cors: Record<string, string> | undefined) {
  return c.json(
    { error: "unauthenticated_store_user", detail: "SSO 세션 없음 — store.dooitspace.com에서 다시 로그인하세요." },
    401,
    cors,
  );
}

// 백업 스냅샷 전용 소유자 식별. 백업은 이 머신의 로컬 파일(~/.mycrew/backups)만 다루고
// 페어링 코드 자체가 이 머신의 마이크루(SSO/루프백 게이트 뒤)에서 발급되므로,
// 코드 소지 = 로컬 소유 증명으로 충분하다 — Supabase userId(store SSO 브릿지) 부재 시에도
// 401 대신 단일 테넌트 소유자("local-owner")로 진행한다.
// 주의: 설치/제거(Supabase installations 기록) 쪽은 userIdForPair의 엄격 규칙(B-4)을 그대로 유지.
const BACKUP_LOCAL_OWNER = "local-owner";

function userIdForBackup(pair: PairRecord): string {
  return pair.userId ?? (isAnonFallbackAllowed() ? PLACEHOLDER_USER_ID : BACKUP_LOCAL_OWNER);
}

// 스냅샷 소유 판정 — local-owner는 단일 테넌트 로컬 데이터 전제 하에
// 과거 PLACEHOLDER uuid로 만들어진 스냅샷에도 접근을 허용한다.
function snapshotOwnedBy(snapshotUserId: string, userId: string): boolean {
  if (snapshotUserId === userId) return true;
  return userId === BACKUP_LOCAL_OWNER && snapshotUserId === PLACEHOLDER_USER_ID;
}

// 물리적 삭제 허용 경로 판별 — mycrew-system 리포 내부(apps/* 등 git 추적 코드)는
// store 시드로 등록된 "이미 설치된 자산"이 가리키는 경로일 수 있어 절대 삭제 금지.
// 실제 삭제 가능 대상은 ~/mycrew-apps, ~/.mycrew/plugins, ~/.claude/skills 하위뿐.
function isDeletableInstallPath(p: string): boolean {
  if (p.startsWith("local://") || p.startsWith("mycrew-builtin://")) return false;
  const resolved = pathResolve(p.replace(/^~(?=$|\/)/, homedir()));
  if (resolved === PROJECT_SELF_DIR || resolved.startsWith(PROJECT_SELF_DIR + sep)) return false;
  return true;
}

function installRootFor(kind: ManifestRow["kind"], id: string): string {
  if (kind === "skill") return join(homedir(), ".claude", "skills", id);
  if (kind === "plugin") return join(homedir(), ".mycrew", "plugins", id);
  return join(homedir(), "mycrew-apps", id);
}

async function downloadAndVerify(artifactUrl: string, expectedSha256: string): Promise<string> {
  const res = await fetch(artifactUrl);
  if (!res.ok) throw new Error(`artifact_download_failed:${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actualSha256 = createHash("sha256").update(buf).digest("hex");
  if (actualSha256 !== expectedSha256) throw new Error("sha256_mismatch");
  const tmpDir = await mkdtemp(join(tmpdir(), "mycrew-store-"));
  const tmpFile = join(tmpDir, "artifact.tar.gz");
  await fsWriteFile(tmpFile, buf);
  return tmpFile;
}

/**
 * POST /api/store/install
 * body: { pairingCode, manifestUrl }
 * manifestUrl은 클라이언트(InstallDialog)가 manifest.artifact.url을 그대로 보내는 값이므로,
 * 이 값을 키로 Supabase manifests.artifact_url을 조회해 매니페스트 전체 레코드를 얻는다
 * (원격 URL을 매니페스트 JSON으로 직접 fetch하지 않음 — 카탈로그 원본은 Supabase가 SOT).
 */
storeRoutes.options("/install", preflight);
storeRoutes.post("/install", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));

  let body: { pairingCode?: string; manifestUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400, cors);
  }
  const { pairingCode, manifestUrl } = body;
  if (!pairingCode || !manifestUrl) return c.json({ error: "missing_fields" }, 400, cors);

  const pair = resolvePair(pairingCode);
  if (!pair) return c.json({ error: "invalid_or_expired_pairing_code" }, 400, cors);

  if (!storeSupabaseConfig()) return c.json({ error: "store_supabase_not_configured" }, 503, cors);

  let manifest: ManifestRow | null;
  try {
    manifest = await findManifestByArtifactUrl(manifestUrl);
  } catch (err) {
    console.error("[store/install] manifest 조회 실패:", err);
    return c.json({ error: "manifest_query_failed" }, 502, cors);
  }
  if (!manifest) return c.json({ error: "manifest_not_found" }, 404, cors);

  const userId = userIdForPair(pair);
  if (!userId) return unauthenticatedStoreResponse(c, cors);
  const installPath = manifest.artifact_type === "local" ? manifest.install_path : installRootFor(manifest.kind, manifest.id);

  try {
    if (manifest.artifact_type !== "local") {
      const tmpFile = await downloadAndVerify(manifest.artifact_url, manifest.artifact_sha256);
      await mkdir(installPath, { recursive: true });
      // sha256만으로는 외부 아티팩트의 zip-slip/symlink 엔트리를 막지 못한다 —
      // 추출 직전 v1.12-Tar-Hardening과 동일한 방어를 재사용한다 (Woods QA #91 후속 지적).
      await assertSafeTarArchive(tmpFile, installPath);
      await execFileAsync("tar", ["-xzf", tmpFile, "-C", installPath]);
      await rm(join(tmpFile, ".."), { recursive: true, force: true });
    }
    await upsertInstallation(userId, manifest.id, manifest.version);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[store/install] 설치 실패:", msg);
    if (msg === "sha256_mismatch") return c.json({ error: "sha256_mismatch" }, 400, cors);
    if (msg.startsWith("artifact_download_failed")) return c.json({ error: "artifact_download_failed" }, 502, cors);
    if (msg.startsWith("tar_zip_slip_rejected")) return c.json({ error: "install_zip_slip_rejected", detail: msg }, 400, cors);
    if (msg.startsWith("tar_symlink_rejected")) return c.json({ error: "install_symlink_rejected", detail: msg }, 400, cors);
    return c.json({ error: "install_failed", detail: msg }, 500, cors);
  }

  return c.json({ ok: true, installed_version: manifest.version, install_path: installPath }, 200, cors);
});

/**
 * POST /api/store/uninstall
 * body: { pairingCode, manifestId }
 * kind:app(category!=core) + kind:skill → install_path가 mycrew-system 리포 밖(사용자 데이터 디렉토리)일
 * 때만 실제 폴더 삭제. kind:plugin은 내장 메뉴 토글이라 record(installed.jsonl)만 갱신.
 */
storeRoutes.options("/uninstall", preflight);
storeRoutes.post("/uninstall", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));

  let body: { pairingCode?: string; manifestId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400, cors);
  }
  const { pairingCode, manifestId } = body;
  if (!pairingCode || !manifestId) return c.json({ error: "missing_fields" }, 400, cors);

  const pair = resolvePair(pairingCode);
  if (!pair) return c.json({ error: "invalid_or_expired_pairing_code" }, 400, cors);

  if (!storeSupabaseConfig()) return c.json({ error: "store_supabase_not_configured" }, 503, cors);

  let manifest: ManifestRow | null;
  try {
    manifest = await findManifestById(manifestId);
  } catch (err) {
    console.error("[store/uninstall] manifest 조회 실패:", err);
    return c.json({ error: "manifest_query_failed" }, 502, cors);
  }
  if (!manifest) return c.json({ error: "manifest_not_found" }, 404, cors);

  if (manifest.kind === "app" && manifest.category === "core") {
    return c.json({ error: "core_app_protected" }, 403, cors);
  }

  const userId = userIdForPair(pair);
  if (!userId) return unauthenticatedStoreResponse(c, cors);
  let removed = false;

  try {
    if (manifest.kind === "plugin") {
      // 플러그인 = 내장 대시보드 메뉴 토글 (2026-07-04 개념 확정).
      // 상태는 installed.jsonl(record) ↔ navSettings 동기화(storeSync.ts)가 단일 소스다.
      // 과거 여기서 쓰던 ~/.mycrew/plugins-disabled.json은 읽는 코드가 없는 dead file이라 제거.
      removed = false;
    } else if (isDeletableInstallPath(manifest.install_path)) {
      await rm(manifest.install_path, { recursive: true, force: true });
      removed = true;
    }
    await deleteInstallation(userId, manifest.id);
  } catch (err) {
    console.error("[store/uninstall] 삭제 실패:", err);
    return c.json({ error: "uninstall_failed", detail: err instanceof Error ? err.message : String(err) }, 500, cors);
  }

  return c.json({ ok: true, removed }, 200, cors);
});

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * GET /api/store/check-updates?pairingCode=XXXXXX
 * 설치된 매니페스트들의 버전을 카탈로그 최신 버전과 비교해 업데이트 가능 목록 반환.
 */
storeRoutes.options("/check-updates", preflight);
storeRoutes.get("/check-updates", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));
  const pairingCode = c.req.query("pairingCode");
  if (!pairingCode) return c.json({ error: "missing_pairing_code" }, 400, cors);

  const pair = resolvePair(pairingCode);
  if (!pair) return c.json({ error: "invalid_or_expired_pairing_code" }, 400, cors);

  if (!storeSupabaseConfig()) return c.json({ error: "store_supabase_not_configured" }, 503, cors);

  const userId = userIdForPair(pair);
  if (!userId) return unauthenticatedStoreResponse(c, cors);
  try {
    const instRes = await supabaseRest(
      `/installations?user_id=eq.${encodeURIComponent(userId)}&select=manifest_id,installed_version`,
    );
    if (!instRes.ok) throw new Error(`installations query failed (${instRes.status})`);
    const installed = (await instRes.json()) as { manifest_id: string; installed_version: string }[];
    if (installed.length === 0) return c.json({ updatable: [] }, 200, cors);

    const ids = installed.map((i) => i.manifest_id).join(",");
    const manRes = await supabaseRest(`/manifests?id=in.(${ids})&select=id,version,artifact_type`);
    if (!manRes.ok) throw new Error(`manifests query failed (${manRes.status})`);
    const manifests = (await manRes.json()) as { id: string; version: string; artifact_type: string }[];
    const byId = new Map(manifests.map((m) => [m.id, m]));

    const updatable = installed
      .map((i) => {
        const m = byId.get(i.manifest_id);
        if (!m || m.artifact_type === "local") return null;
        if (compareSemver(m.version, i.installed_version) <= 0) return null;
        return { manifestId: i.manifest_id, currentVersion: i.installed_version, latestVersion: m.version };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return c.json({ updatable }, 200, cors);
  } catch (err) {
    console.error("[store/check-updates] 조회 실패:", err);
    return c.json({ error: "check_updates_failed" }, 502, cors);
  }
});

// ── 로컬 대시보드용 앱 업데이트 (update-check.ts + /api/apps/:id/update) ──────────────

/** 스토어 카탈로그의 앱 매니페스트 목록. Supabase 미구성 시 빈 배열(오프라인 정상). */
export async function listStoreAppManifests(): Promise<
  { id: string; version: string; artifact_type: string }[]
> {
  if (!storeSupabaseConfig()) return [];
  const res = await supabaseRest("/manifests?kind=eq.app&select=id,version,artifact_type");
  if (!res.ok) throw new Error(`manifests query failed (${res.status})`);
  return (await res.json()) as { id: string; version: string; artifact_type: string }[];
}

/**
 * 설치형 앱을 스토어 최신 아티팩트로 교체 후 재기동.
 * artifact_type=local(리포 내장 앱)은 프로그램 패키지와 함께 배포되므로 개별 업데이트 불가.
 * install_path가 리포 내부면 절대 덮어쓰지 않는다(isDeletableInstallPath와 동일 원칙).
 */
export async function updateAppFromStore(
  appId: string,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!storeSupabaseConfig()) return { ok: false, error: "store_supabase_not_configured" };
  let manifest: ManifestRow | null;
  try {
    manifest = await findManifestById(appId);
  } catch (err) {
    return { ok: false, error: `manifest_query_failed: ${err instanceof Error ? err.message : err}` };
  }
  if (!manifest || manifest.kind !== "app") return { ok: false, error: "manifest_not_found" };
  if (manifest.artifact_type === "local") return { ok: false, error: "bundled_app_updates_with_package" };
  const installPath = installRootFor("app", manifest.id);
  if (!isDeletableInstallPath(installPath)) return { ok: false, error: "install_path_protected" };
  try {
    const tmpFile = await downloadAndVerify(manifest.artifact_url, manifest.artifact_sha256);
    await mkdir(installPath, { recursive: true });
    await assertSafeTarArchive(tmpFile, installPath);
    await execFileAsync("tar", ["-xzf", tmpFile, "-C", installPath]);
    await rm(join(tmpFile, ".."), { recursive: true, force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[store/app-update] ${appId} 업데이트 실패:`, msg);
    return { ok: false, error: msg };
  }
  // 새 코드로 재기동 (실패해도 파일 교체는 완료 — 다음 stale-supervisor가 회복)
  const restart = await restartApp(appId);
  if (!restart.ok) console.warn(`[store/app-update] ${appId} 재기동 실패:`, restart.error);
  return { ok: true, version: manifest.version };
}

// ── Backup API (v1.7-BE) ─────────────────────────────────────────────────────────────
// 로컬 파일시스템 아티팩트. 인스턴스 종속적이라 Supabase 테이블에 저장하지 않고
// ~/.mycrew/backups/index.json에 배열로 보관 (Harry v1.7-spec §1.3).
const BACKUPS_ROOT = join(homedir(), ".mycrew", "backups");
const BACKUPS_INDEX = join(BACKUPS_ROOT, "index.json");
const MAX_SNAPSHOTS_PER_USER = 20;

// ── PIPA 아카이브 필터 (v1.12-Tar-Hardening) ──────────────────────────────────────────
// 백업 tar 생성 시 개인정보/비밀 파일이 설치 디렉토리 안에 섞여 있어도 아카이브에
// 포함되지 않도록 tar --exclude 글롭으로 걸러낸다 (v1.7 감사 P1-5, Woods 지적사항).
const SENSITIVE_BACKUP_GLOBS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "history/external/partners.json",
];

function globToSensitiveRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`(^|/)${escaped}$`);
}

const SENSITIVE_BACKUP_PATTERNS = SENSITIVE_BACKUP_GLOBS.map(globToSensitiveRegExp);

function isSensitivePath(relPath: string): boolean {
  const normalized = relPath.replace(/^\.\//, "").replace(/^\/+/, "");
  return SENSITIVE_BACKUP_PATTERNS.some((re) => re.test(normalized));
}

// ── zip-slip / symlink 방어 (v1.12-Tar-Hardening) ─────────────────────────────────────
// 복원 전 아카이브 내용을 먼저 나열해 대상 디렉토리 밖으로 나가는 경로(zip-slip)나
// symlink 엔트리(외부 파일 참조로 정보 유출 위험)가 있으면 추출 없이 즉시 거부한다.
// 이름 추출은 항상 비-verbose(-tzf)로만 한다 — verbose(-tvzf) 출력의 permission/date
// 필드 폭은 GNU tar와 macOS bsdtar 간에 달라 고정 컬럼 슬라이싱이 깨질 수 있다
// (실측: bsdtar에서 슬라이싱 시 파일명이 손상돼 "../" 탈출 탐지가 무력화됨).
async function listTarEntryNames(archivePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("tar", ["-tzf", archivePath]);
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

// symlink 판별은 verbose 출력 첫 글자(permission 문자열의 typeflag)만 본다 — 이 위치는
// GNU/BSD tar 공통으로 안정적이며, 이름 파싱과 달리 컬럼 폭에 영향받지 않는다.
async function assertNoSymlinkEntries(archivePath: string): Promise<void> {
  const { stdout } = await execFileAsync("tar", ["-tvzf", archivePath]);
  const symlinkLine = stdout.split("\n").find((line) => /^l/.test(line.trim()));
  if (symlinkLine) throw new Error(`tar_symlink_rejected:${symlinkLine.trim()}`);
}

function isEscapingTarPath(entryName: string, targetDir: string): boolean {
  if (!entryName || entryName.startsWith("/")) return true;
  const resolved = pathResolve(targetDir, entryName);
  return resolved !== targetDir && !resolved.startsWith(targetDir + sep);
}

async function assertSafeTarArchive(archivePath: string, targetDir: string): Promise<void> {
  await assertNoSymlinkEntries(archivePath);
  const names = await listTarEntryNames(archivePath);
  for (const name of names) {
    if (isEscapingTarPath(name, targetDir)) throw new Error(`tar_zip_slip_rejected:${name}`);
  }
}

interface SnapshotItem {
  manifestId: string;
  kind: ManifestRow["kind"];
  version: string;
  archiveFile: string;
  sizeBytes: number;
}

interface SnapshotRecord {
  id: string;
  userId: string;
  createdAt: string;
  isPreRestoreSnapshot: boolean;
  items: SnapshotItem[];
  totalSizeBytes: number;
}

async function readBackupIndex(): Promise<SnapshotRecord[]> {
  if (!existsSync(BACKUPS_INDEX)) return [];
  try {
    const raw = await fsReadFile(BACKUPS_INDEX, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SnapshotRecord[]) : [];
  } catch (err) {
    console.error("[store/backup] index.json 파싱 실패, 빈 배열로 폴백:", err);
    return [];
  }
}

async function writeBackupIndex(records: SnapshotRecord[]): Promise<void> {
  await mkdir(BACKUPS_ROOT, { recursive: true });
  await fsWriteFile(BACKUPS_INDEX, JSON.stringify(records, null, 2));
}

function nowSnapshotId(existing: Set<string>): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const base =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("snapshot_id_collision");
}

async function enforceUserSnapshotLimit(userId: string): Promise<SnapshotRecord[]> {
  const records = await readBackupIndex();
  const mine = records.filter((r) => r.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const others = records.filter((r) => r.userId !== userId);
  const excess = mine.length - MAX_SNAPSHOTS_PER_USER;
  if (excess <= 0) return records;
  const toEvict = mine.slice(0, excess);
  for (const rec of toEvict) {
    const dir = join(BACKUPS_ROOT, rec.id);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[store/backup] LRU 제거 실패 (${rec.id}):`, err);
    }
  }
  const kept = mine.slice(excess);
  const next = [...others, ...kept];
  await writeBackupIndex(next);
  return next;
}

async function fetchBackupableInstallations(
  userId: string,
  manifestIds?: string[],
): Promise<{ manifest: ManifestRow; installedVersion: string }[]> {
  const idsFilter =
    manifestIds && manifestIds.length > 0
      ? `&manifest_id=in.(${manifestIds.map((id) => encodeURIComponent(id)).join(",")})`
      : "";
  // local-owner(단일 테넌트 로컬 백업)는 이 머신의 설치물 전체가 대상 — user_id 필터 생략.
  // (기존 installations 데이터가 PLACEHOLDER uuid 소유로 시드되어 있어 필터하면 항상 0건이 된다)
  const userFilter = userId === BACKUP_LOCAL_OWNER ? "?manifest_id=not.is.null" : `?user_id=eq.${encodeURIComponent(userId)}`;
  const filter = `${userFilter}${idsFilter}`;
  const instRes = await supabaseRest(`/installations${filter}&select=manifest_id,installed_version`);
  if (!instRes.ok) throw new Error(`installations query failed (${instRes.status})`);
  const installed = (await instRes.json()) as { manifest_id: string; installed_version: string }[];
  if (installed.length === 0) return [];
  const ids = installed.map((i) => i.manifest_id).join(",");
  const manRes = await supabaseRest(`/manifests?id=in.(${ids})&select=*`);
  if (!manRes.ok) throw new Error(`manifests query failed (${manRes.status})`);
  const manifests = (await manRes.json()) as ManifestRow[];
  const byId = new Map(manifests.map((m) => [m.id, m]));
  return installed
    .map((i) => {
      const m = byId.get(i.manifest_id);
      if (!m || m.artifact_type === "local") return null;
      return { manifest: m, installedVersion: i.installed_version };
    })
    .filter((x): x is { manifest: ManifestRow; installedVersion: string } => x !== null);
}

async function createSnapshotInternal(
  userId: string,
  manifestIds: string[] | undefined,
  isPreRestoreSnapshot: boolean,
): Promise<{ record: SnapshotRecord; noBackupable: boolean }> {
  const targets = await fetchBackupableInstallations(userId, manifestIds);
  if (targets.length === 0) {
    return { record: null as unknown as SnapshotRecord, noBackupable: true };
  }
  const records = await readBackupIndex();
  const existingIds = new Set(records.map((r) => r.id));
  const snapshotId = nowSnapshotId(existingIds);
  const snapshotDir = join(BACKUPS_ROOT, snapshotId);
  await mkdir(snapshotDir, { recursive: true });

  const items: SnapshotItem[] = [];
  let totalSizeBytes = 0;
  for (const { manifest, installedVersion } of targets) {
    const installPath = installRootFor(manifest.kind, manifest.id);
    if (!existsSync(installPath)) continue; // 카탈로그엔 있지만 실제 파일 없음 — 스킵
    const archiveFile = `${manifest.kind}-${manifest.id}.tar.gz`;
    const archivePath = join(snapshotDir, archiveFile);
    await execFileAsync("tar", [
      "-czf",
      archivePath,
      ...SENSITIVE_BACKUP_GLOBS.flatMap((pattern) => ["--exclude", pattern]),
      "-C",
      installPath,
      ".",
    ]);
    // --exclude 실패/우회 가능성에 대비한 이중 검증 — 생성된 아카이브에 민감 경로가
    // 하나라도 남아있으면 즉시 실패시켜 유출을 막는다.
    const createdEntryNames = await listTarEntryNames(archivePath);
    const leaked = createdEntryNames.find((name) => isSensitivePath(name));
    if (leaked) throw new Error(`sensitive_path_leaked_into_backup:${leaked}`);
    const sizeBytes = statSync(archivePath).size;
    items.push({ manifestId: manifest.id, kind: manifest.kind, version: installedVersion, archiveFile, sizeBytes });
    totalSizeBytes += sizeBytes;
  }
  if (items.length === 0) {
    await rm(snapshotDir, { recursive: true, force: true });
    return { record: null as unknown as SnapshotRecord, noBackupable: true };
  }
  const record: SnapshotRecord = {
    id: snapshotId,
    userId,
    createdAt: new Date().toISOString(),
    isPreRestoreSnapshot,
    items,
    totalSizeBytes,
  };
  // manifest.json은 index 손상 시 복구용 (spec §1.2)
  await fsWriteFile(join(snapshotDir, "manifest.json"), JSON.stringify(record, null, 2));
  await writeBackupIndex([...records, record]);
  await enforceUserSnapshotLimit(userId);
  return { record, noBackupable: false };
}

/** POST /api/store/backup/create — body: { pairingCode, manifestId? } */
storeRoutes.options("/backup/create", preflight);
storeRoutes.post("/backup/create", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));
  let body: { pairingCode?: string; manifestId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400, cors);
  }
  const { pairingCode, manifestId } = body;
  if (!pairingCode) return c.json({ error: "missing_fields" }, 400, cors);
  const pair = resolvePair(pairingCode);
  if (!pair) return c.json({ error: "invalid_or_expired_pairing_code" }, 400, cors);
  if (!storeSupabaseConfig()) return c.json({ error: "store_supabase_not_configured" }, 503, cors);

  const userId = userIdForBackup(pair);
  try {
    const { record, noBackupable } = await createSnapshotInternal(userId, manifestId ? [manifestId] : undefined, false);
    if (noBackupable) {
      if (manifestId) return c.json({ error: "no_backupable_installations" }, 404, cors);
      return c.json({ ok: true, snapshotId: null, items: [] }, 200, cors);
    }
    return c.json(
      { ok: true, snapshotId: record.id, createdAt: record.createdAt, items: record.items },
      200,
      cors,
    );
  } catch (err) {
    console.error("[store/backup/create] 실패:", err);
    return c.json({ error: "backup_failed", detail: err instanceof Error ? err.message : String(err) }, 500, cors);
  }
});

/** GET /api/store/backup/list?pairingCode=XXXXXX */
storeRoutes.options("/backup/list", preflight);
storeRoutes.get("/backup/list", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));
  const pairingCode = c.req.query("pairingCode");
  if (!pairingCode) return c.json({ error: "missing_pairing_code" }, 400, cors);
  const pair = resolvePair(pairingCode);
  if (!pair) return c.json({ error: "invalid_or_expired_pairing_code" }, 400, cors);
  const userId = userIdForBackup(pair);
  const records = await readBackupIndex();
  const mine = records
    .filter((r) => snapshotOwnedBy(r.userId, userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      isPreRestoreSnapshot: r.isPreRestoreSnapshot,
      items: r.items,
      totalSizeBytes: r.totalSizeBytes,
    }));
  return c.json({ snapshots: mine }, 200, cors);
});

/** POST /api/store/backup/restore — body: { pairingCode, snapshotId } */
storeRoutes.options("/backup/restore", preflight);
storeRoutes.post("/backup/restore", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));
  let body: { pairingCode?: string; snapshotId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400, cors);
  }
  const { pairingCode, snapshotId } = body;
  if (!pairingCode || !snapshotId) return c.json({ error: "missing_fields" }, 400, cors);
  const pair = resolvePair(pairingCode);
  if (!pair) return c.json({ error: "invalid_or_expired_pairing_code" }, 400, cors);
  if (!storeSupabaseConfig()) return c.json({ error: "store_supabase_not_configured" }, 503, cors);

  const userId = userIdForBackup(pair);
  const records = await readBackupIndex();
  const snapshot = records.find((r) => r.id === snapshotId);
  if (!snapshot) return c.json({ error: "snapshot_not_found" }, 404, cors);
  if (!snapshotOwnedBy(snapshot.userId, userId)) return c.json({ error: "snapshot_owner_mismatch" }, 403, cors);

  // 사전 스냅샷: 복원 대상 항목 전체를 하나의 pre-restore 스냅샷으로 백업 (spec §1.5)
  const preRestoreManifestIds = snapshot.items.map((i) => i.manifestId);
  let rollbackSnapshotId: string | null = null;
  try {
    // createSnapshotInternal이 manifestIds 배열을 지원하므로 복원 대상 전체를
    // 하나의 pre-restore 스냅샷으로 커버한다 (개별 항목 누락 방지 — spec §1.5).
    if (preRestoreManifestIds.length > 0) {
      const { record } = await createSnapshotInternal(userId, preRestoreManifestIds, true);
      if (record) rollbackSnapshotId = record.id;
    }
  } catch (err) {
    console.error("[store/backup/restore] 사전 스냅샷 실패:", err);
    return c.json({ error: "pre_snapshot_failed", detail: err instanceof Error ? err.message : String(err) }, 500, cors);
  }

  const restoredItems: { manifestId: string; version: string }[] = [];
  try {
    for (const item of snapshot.items) {
      const manifest = await findManifestById(item.manifestId);
      if (!manifest) continue;
      const installPath = installRootFor(item.kind, item.manifestId);
      if (isDeletableInstallPath(installPath) && existsSync(installPath)) {
        await rm(installPath, { recursive: true, force: true });
      }
      await mkdir(installPath, { recursive: true });
      const archivePath = join(BACKUPS_ROOT, snapshot.id, item.archiveFile);
      await assertSafeTarArchive(archivePath, installPath);
      await execFileAsync("tar", ["-xzf", archivePath, "-C", installPath]);
      // local-owner는 Supabase installations 기록 대상이 아님(uuid 아님) — 로컬 파일 복원이 본질.
      if (userId !== BACKUP_LOCAL_OWNER) {
        await upsertInstallation(userId, item.manifestId, item.version);
      }
      restoredItems.push({ manifestId: item.manifestId, version: item.version });
    }
  } catch (err) {
    console.error("[store/backup/restore] 복원 실패:", err);
    return c.json(
      { error: "restore_failed", detail: err instanceof Error ? err.message : String(err), rollbackSnapshotId },
      500,
      cors,
    );
  }

  return c.json({ ok: true, restoredItems, rollbackSnapshotId }, 200, cors);
});

/** DELETE /api/store/backup/:id?pairingCode=XXXXXX */
storeRoutes.options("/backup/:id", preflight);
storeRoutes.delete("/backup/:id", async (c) => {
  const cors = corsHeadersFor(c.req.header("Origin"));
  const snapshotId = c.req.param("id");
  const pairingCode = c.req.query("pairingCode");
  if (!pairingCode) return c.json({ error: "missing_pairing_code" }, 400, cors);
  const pair = resolvePair(pairingCode);
  if (!pair) return c.json({ error: "invalid_or_expired_pairing_code" }, 400, cors);

  const userId = userIdForBackup(pair);
  const records = await readBackupIndex();
  const snapshot = records.find((r) => r.id === snapshotId);
  if (!snapshot) return c.json({ error: "snapshot_not_found" }, 404, cors);
  if (!snapshotOwnedBy(snapshot.userId, userId)) return c.json({ error: "snapshot_owner_mismatch" }, 403, cors);

  try {
    await rm(join(BACKUPS_ROOT, snapshot.id), { recursive: true, force: true });
    const next = records.filter((r) => r.id !== snapshot.id);
    await writeBackupIndex(next);
  } catch (err) {
    console.error("[store/backup/delete] 실패:", err);
    return c.json({ error: "delete_failed", detail: err instanceof Error ? err.message : String(err) }, 500, cors);
  }
  return c.json({ ok: true }, 200, cors);
});

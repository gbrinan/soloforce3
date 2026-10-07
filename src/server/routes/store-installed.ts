import { Hono } from "hono";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../../config.js";
import { storeCorsMiddleware } from "./store-cors.js";

// NOTE: 이 라우터는 src/server/index.ts에서 "/api/store/installed"에 마운트된다 (예: "/api/store/installed/install").
// 기존 src/server/routes/store.ts가 이미 "/api/store"에 마운트되어 POST /install, /uninstall을 점유하고 있어
// 동일 경로(/api/store/install)로 마운트하면 Hono가 먼저 등록된 store.ts 라우트를 우선 매칭해 이 라우터가 죽은 코드가 된다.
// 그래서 로컬 카탈로그 설치-상태 트래킹은 /api/store/installed/* 하위 경로로 분리한다.
export const storeInstalledRoutes = new Hono();

// store.dooitspace.com 브라우저가 직접 fetch(설치 상태 조회/설치/제거)하는 라우트 — CORS/PNA 헤더 필수.
storeInstalledRoutes.use("*", storeCorsMiddleware());

const STORE_DIR = join(HISTORY_DIR, "store");
const INSTALLED_FILE = join(STORE_DIR, "installed.jsonl");

interface InstalledRecord {
  // 로컬 설치는 Supabase auth user.id(uuid). "*"는 파트너 원격 설치 전용 sentinel —
  // 단일 테넌트(소유자 1인) 전제 하에 userId 무관하게 모든 조회에 노출시키기 위함.
  userId: string;
  itemId: string;
  kind: "skill" | "plugin" | "app";
  action: "install" | "uninstall" | "bootstrap";
  at: string;
  // v1.13 Phase4: 파트너 원격 설치 표기 (optional — 기존 로컬 레코드는 필드 없음, 하위 호환 유지)
  source?: "local" | "partner";
  partnerId?: string;
  partnerName?: string;
}

function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

function appendRecord(rec: InstalledRecord): void {
  ensureStoreDir();
  appendFileSync(INSTALLED_FILE, JSON.stringify(rec) + "\n", "utf-8");
}

// v1.13 Phase4: 파트너 원격 설치 승인 확정 후 store-install-executor.ts가 호출.
export function installFromPartner(
  kind: InstalledRecord["kind"],
  itemId: string,
  partnerId: string,
  partnerName: string,
): void {
  appendRecord({
    userId: "*",
    itemId,
    kind,
    action: "install",
    at: new Date().toISOString(),
    source: "partner",
    partnerId,
    partnerName,
  });
}

interface InstalledItemView {
  itemId: string;
  kind: string;
  installedAt: string;
  // 스토어 Phase4: 최초 실행 부트스트랩 완료 여부. action:"bootstrap" 레코드 존재 시 true.
  bootstrapped: boolean;
  source?: "local" | "partner";
  partnerId?: string;
  partnerName?: string;
}

// 기본 플러그인 — 스토어 활성화(설치) 없이 신품 상태부터 켜져 있는 플러그인 (알림·토큰).
// installed.jsonl에 기록이 없으면 설치된 것으로 간주하고, 명시적 uninstall 레코드로만 꺼진다.
const DEFAULT_PLUGIN_IDS = ["notifications", "costs"] as const;
const DEFAULT_INSTALLED_AT = "1970-01-01T00:00:00.000Z";

// 현재 설치 상태 = 기본 플러그인 시드 위에 install/uninstall 로그를 시간순 재생해
// 마지막 action이 install인 (userId,itemId,kind)만 남긴다.
function currentInstalled(userId: string): InstalledItemView[] {
  const state = new Map<string, InstalledItemView | null>();
  for (const id of DEFAULT_PLUGIN_IDS) {
    state.set(`plugin:${id}`, { itemId: id, kind: "plugin", installedAt: DEFAULT_INSTALLED_AT, bootstrapped: false });
  }
  if (!existsSync(INSTALLED_FILE)) {
    return [...state.values()].filter((v): v is InstalledItemView => v !== null);
  }
  const lines = readFileSync(INSTALLED_FILE, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    let rec: InstalledRecord;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    // "*" = 파트너 원격 설치 sentinel — 단일 테넌트 전제 하에 모든 userId 조회에 노출
    if (rec.userId !== userId && rec.userId !== "*") continue;
    const key = `${rec.kind}:${rec.itemId}`;
    if (rec.action === "install") {
      state.set(key, {
        itemId: rec.itemId,
        kind: rec.kind,
        installedAt: rec.at,
        bootstrapped: false,
        source: rec.source,
        partnerId: rec.partnerId,
        partnerName: rec.partnerName,
      });
    } else if (rec.action === "bootstrap") {
      // install 상태 위에만 의미 있음 — uninstall 이후/설치 기록 없는 항목의 bootstrap 레코드는 무시.
      const existing = state.get(key);
      if (existing) state.set(key, { ...existing, bootstrapped: true });
    } else {
      state.set(key, null);
    }
  }
  return [...state.values()].filter((v): v is InstalledItemView => v !== null);
}

// 스토어에서 uninstall된 앱 id 집합 — 런처(/api/apps/manifest)가 노출 목록에서 제외한다.
// "기록이 없으면 보임"(하위 호환): 명시적으로 최종 action이 uninstall인 앱만 숨긴다.
// 소스 삭제가 아니라 노출 제거 — 스토어에서 재설치하면 즉시 복구된다.
export function getUninstalledAppIds(): Set<string> {
  if (!existsSync(INSTALLED_FILE)) return new Set();
  const lines = readFileSync(INSTALLED_FILE, "utf-8").split("\n").filter(Boolean);
  const finalAction = new Map<string, "install" | "uninstall">();
  for (const line of lines) {
    let rec: InstalledRecord;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.kind !== "app") continue;
    if (rec.userId !== "local-owner" && rec.userId !== "*") continue;
    if (rec.action === "install" || rec.action === "uninstall") {
      finalAction.set(rec.itemId, rec.action);
    }
  }
  const hidden = new Set<string>();
  for (const [id, action] of finalAction) {
    if (action === "uninstall") hidden.add(id);
  }
  return hidden;
}

// managed(패키지 배포) 모드에서 런처가 노출할 "설치된 앱" id 집합.
// 최종 action이 install인 app 레코드만 (local-owner 또는 파트너 "*"). uninstall이면 제외.
export function getInstalledAppIds(): Set<string> {
  if (!existsSync(INSTALLED_FILE)) return new Set();
  const lines = readFileSync(INSTALLED_FILE, "utf-8").split("\n").filter(Boolean);
  const finalAction = new Map<string, "install" | "uninstall">();
  for (const line of lines) {
    let rec: InstalledRecord;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.kind !== "app") continue;
    if (rec.userId !== "local-owner" && rec.userId !== "*") continue;
    if (rec.action === "install" || rec.action === "uninstall") {
      finalAction.set(rec.itemId, rec.action);
    }
  }
  const installed = new Set<string>();
  for (const [id, action] of finalAction) {
    if (action === "install") installed.add(id);
  }
  return installed;
}

storeInstalledRoutes.get("/", (c) => {
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId required" }, 400);
  return c.json({ userId, items: currentInstalled(userId) });
});

storeInstalledRoutes.post("/install", async (c) => {
  const body = await c.req.json().catch(() => null) as { userId?: string; itemId?: string; kind?: string } | null;
  if (!body?.userId || !body.itemId || !body.kind) {
    return c.json({ error: "userId, itemId, kind required" }, 400);
  }
  if (body.kind !== "skill" && body.kind !== "plugin" && body.kind !== "app") {
    return c.json({ error: "kind must be skill|plugin|app" }, 400);
  }
  appendRecord({ userId: body.userId, itemId: body.itemId, kind: body.kind, action: "install", at: new Date().toISOString() });
  return c.json({ ok: true });
});

storeInstalledRoutes.post("/uninstall", async (c) => {
  const body = await c.req.json().catch(() => null) as { userId?: string; itemId?: string; kind?: string } | null;
  if (!body?.userId || !body.itemId || !body.kind) {
    return c.json({ error: "userId, itemId, kind required" }, 400);
  }
  if (body.kind !== "skill" && body.kind !== "plugin" && body.kind !== "app") {
    return c.json({ error: "kind must be skill|plugin|app" }, 400);
  }
  appendRecord({ userId: body.userId, itemId: body.itemId, kind: body.kind, action: "uninstall", at: new Date().toISOString() });
  return c.json({ ok: true });
});

// 스토어 Phase4: 3rd-party 앱 최초 실행 부트스트랩 완료 마킹 (client: src/client/utils/appBootstrap.ts).
storeInstalledRoutes.post("/bootstrap", async (c) => {
  const body = await c.req.json().catch(() => null) as { userId?: string; itemId?: string; kind?: string } | null;
  if (!body?.userId || !body.itemId || !body.kind) {
    return c.json({ error: "userId, itemId, kind required" }, 400);
  }
  if (body.kind !== "skill" && body.kind !== "plugin" && body.kind !== "app") {
    return c.json({ error: "kind must be skill|plugin|app" }, 400);
  }
  appendRecord({ userId: body.userId, itemId: body.itemId, kind: body.kind, action: "bootstrap", at: new Date().toISOString() });
  return c.json({ ok: true });
});

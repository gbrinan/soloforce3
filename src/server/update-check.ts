// 프로그램/앱 자동 업데이트 확인 — 스토어의 공개 패키지 메타(/api/package/meta)와
// 앱 카탈로그(Supabase manifests)를 폴링해 로컬 버전보다 새 버전이 올라오면
// 지니 메시지(패키지 1회) + 알림 센터(kind: update, 버전별 1회)로 알린다.
// (플랫폼 분석 2026-07-04 P0: 설치본 사용자가 새 zip 출시를 알 방법이 없던 문제)
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SELF_DIR, HISTORY_DIR } from "../config.js";
import { listManifests } from "./app-registry.js";
import { listStoreAppManifests } from "./routes/store.js";
import { emitNotification } from "./notifications.js";
import { getAllWorkerAgents } from "../agent-registry.js";
import { getGenieAgent } from "../agents/genie.js";
import { MODEL_CATALOG_FILE, loadModelCatalog, getAppliedSuccessions, invalidateCatalogCache, type CatalogModel } from "./model-catalog.js";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간
const NOTIFIED_FILE = join(HISTORY_DIR, "update-notified.json"); // 버전별 1회 알림 기록

export interface AppUpdateStatus {
  id: string;
  name: string;
  currentVersion: string;
  latestVersion: string;
  updatable: boolean;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updatable: boolean;
  notes: string | null;
  downloadUrl: string | null;
  checkedAt: string | null;
  apps: AppUpdateStatus[];
}

let lastStatus: UpdateStatus = {
  currentVersion: localVersion(),
  latestVersion: null,
  updatable: false,
  notes: null,
  downloadUrl: null,
  checkedAt: null,
  apps: [],
};

function localVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_SELF_DIR, "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function compareSemver(a: string, b: string): number { // 테스트 노출
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function alreadyNotified(version: string): boolean {
  try {
    if (!existsSync(NOTIFIED_FILE)) return false;
    const seen = JSON.parse(readFileSync(NOTIFIED_FILE, "utf-8")) as string[];
    return Array.isArray(seen) && seen.includes(version);
  } catch {
    return false;
  }
}

function markNotified(version: string): void {
  try {
    let seen: string[] = [];
    if (existsSync(NOTIFIED_FILE)) {
      const parsed = JSON.parse(readFileSync(NOTIFIED_FILE, "utf-8"));
      if (Array.isArray(parsed)) seen = parsed;
    }
    if (!seen.includes(version)) seen.push(version);
    writeFileSync(NOTIFIED_FILE, JSON.stringify(seen.slice(-20)));
  } catch (err) {
    console.warn("[UpdateCheck] 알림 기록 실패:", err instanceof Error ? err.message : err);
  }
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus;
}

async function checkPackageOnce(): Promise<void> {
  const storeUrl = (process.env.MYCREW_STORE_URL || "https://store.dooitspace.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${storeUrl}/api/package/meta`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const body = (await res.json()) as { version?: string; notes?: string | null; downloadUrl?: string };
    if (!body.version) return;

    const current = localVersion();
    const updatable = compareSemver(body.version, current) > 0;
    lastStatus = {
      ...lastStatus,
      currentVersion: current,
      latestVersion: body.version,
      updatable,
      notes: body.notes ?? null,
      downloadUrl: body.downloadUrl ?? `${storeUrl}/api/download/latest`,
      checkedAt: new Date().toISOString(),
    };

    if (updatable) {
      // 알림 센터 — 버전별 1회 (idempotencyKey 중복 제거), 클릭 시 설정 > 일반의 업데이트 화면으로 이동
      emitNotification({
        kind: "update",
        title: `마이크루 새 버전 v${body.version}`,
        body: `현재 v${current} → 최신 v${body.version}. 설정에서 업데이트할 수 있습니다.`,
        deepLink: { panel: "settings", route: "general" },
        idempotencyKey: `update:package:${body.version}`,
      });
    }
    if (updatable && !alreadyNotified(body.version)) {
      markNotified(body.version);
      // 지니 채팅으로 1회 안내 (circular import 회피 — 동적 import)
      const chat = await import("./chat.js");
      chat.addGenieMessage(
        `🆕 **마이크루 새 버전 v${body.version}** 이 나왔습니다 (현재 v${current}).\n` +
          (body.notes ? `\n변경사항: ${body.notes.slice(0, 300)}\n` : "") +
          `\n업데이트: ${storeUrl} 에서 새 설치본을 받아 기존 폴더에 덮어쓰고 setup을 다시 실행하세요.`,
      );
      console.log(`[UpdateCheck] 새 버전 알림: v${current} → v${body.version}`);
    }
  } catch (err) {
    // 네트워크 오류는 조용히 스킵 (오프라인 환경 정상)
    console.warn("[UpdateCheck] 확인 실패:", err instanceof Error ? err.message : err);
  }
}

// 설치형 앱 버전 비교 — 로컬 app-registry(manifest.json) vs 스토어 카탈로그(Supabase manifests).
// artifact_type=local(리포 내장 앱)은 프로그램 패키지와 함께 배포되므로 개별 업데이트 대상에서 제외.
async function checkAppsOnce(): Promise<void> {
  try {
    const rows = await listStoreAppManifests();
    if (rows.length === 0) return; // 스토어 미구성/오프라인 — 기존 상태 유지
    const byId = new Map(rows.map((r) => [r.id, r]));
    const apps: AppUpdateStatus[] = [];
    for (const m of listManifests()) {
      const row = byId.get(m.id);
      if (!row || row.artifact_type === "local") continue;
      const updatable = compareSemver(row.version, m.version) > 0;
      apps.push({
        id: m.id,
        name: m.name,
        currentVersion: m.version,
        latestVersion: row.version,
        updatable,
      });
      if (updatable) {
        emitNotification({
          kind: "update",
          title: `${m.name} 앱 새 버전 v${row.version}`,
          body: `현재 v${m.version} → 최신 v${row.version}. 앱 화면에서 업데이트할 수 있습니다.`,
          deepLink: { panel: "apps", appId: m.id },
          idempotencyKey: `update:app:${m.id}:${row.version}`,
        });
      }
    }
    lastStatus = { ...lastStatus, apps, checkedAt: new Date().toISOString() };
  } catch (err) {
    console.warn("[UpdateCheck] 앱 업데이트 확인 실패:", err instanceof Error ? err.message : err);
  }
}

// ── 모델 카탈로그 확인 — 스토어 중앙 카탈로그(/api/models/catalog)와 비교 ──────────
// 신규 모델 출시 → NEW 알림으로 안내(모델 변경 유도). 지원 종료(deprecated) 모델을
// 쓰는 직원이 있으면 직원 이름과 함께 교체 안내. 알림은 모델·상태별 1회(idempotencyKey).

// 지정 모델(prefix 매칭 — claude-haiku-4-5-20251001 같은 dated ID 포함)을 쓰는 직원 이름 목록.
function agentsUsingModel(modelId: string): string[] {
  const names: string[] = [];
  try {
    const genie = getGenieAgent();
    if (genie.model?.startsWith(modelId)) names.push("지니");
  } catch { /* */ }
  try {
    for (const a of getAllWorkerAgents()) {
      if (a.model?.startsWith(modelId)) names.push(a.name);
    }
  } catch { /* */ }
  return names;
}

async function checkModelsOnce(): Promise<void> {
  const storeUrl = (process.env.MYCREW_STORE_URL || "https://store.dooitspace.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${storeUrl}/api/models/catalog`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return; // 구버전 스토어(카탈로그 미배포) — 조용히 스킵
    const body = (await res.json()) as { models?: CatalogModel[] };
    const models = Array.isArray(body.models) ? body.models : [];
    if (models.length === 0) return;

    const seen = loadModelCatalog();
    const seenIds = new Set((seen ?? []).map((m) => m.id));

    for (const m of models) {
      // 1) 신규 모델 출시 — 이전 카탈로그에 없던 active 모델.
      //    최초 폴링(seen 없음)은 기준선 저장만 하고 알림 생략(기존 설치본 소음 방지).
      if (m.status === "active" && seen !== null && !seenIds.has(m.id)) {
        emitNotification({
          kind: "update",
          title: `🆕 새 AI 모델 출시: ${m.label}`,
          body: `${m.note ? `${m.note} — ` : ""}설정 > 직원에서 에이전트 모델을 ${m.label}(으)로 변경할 수 있어요.`,
          deepLink: { panel: "settings", route: "staff" },
          idempotencyKey: `model:new:${m.id}`,
        });
        console.log(`[UpdateCheck] 신규 모델 알림: ${m.id}`);
      }
      // 2) 지원 종료 모델.
      //    승계 대상이 있으면 레지스트리가 읽는 시점에 자동으로 갈아탄다(model-catalog.ts).
      //    그래서 여기서는 "바꿔 주세요"가 아니라 "바꿨습니다"를 알린다 — 사람이 처리해야만
      //    하는 알림은 실제로 처리되지 않았고, 코퍼스키퍼가 죽은 모델로 몇 세대를 돌았다.
      //    승계 대상이 없을 때만(카탈로그에 replacement 미기재) 수동 교체를 안내한다.
      if (m.status === "deprecated") {
        const succeeded = getAppliedSuccessions().filter((s) => s.from.startsWith(m.id));
        const repl = models.find((x) => x.id === m.replacement);
        if (succeeded.length > 0) {
          emitNotification({
            kind: "update",
            title: `${m.label} 모델 지원 종료 — 자동 교체했습니다`,
            body: `${succeeded.map((s) => s.agentId).join(", ")}이(가) ${repl ? repl.label : m.replacement}(으)로 옮겨졌습니다. 저장된 설정은 그대로이니 설정 > 직원에서 다른 모델로 바꾸셔도 됩니다.`,
            deepLink: { panel: "settings", route: "staff" },
            idempotencyKey: `model:succeeded:${m.id}`,
          });
          console.log(`[UpdateCheck] 지원 종료 모델 자동 승계: ${m.id} → ${m.replacement} (${succeeded.map((s) => s.agentId).join(",")})`);
        } else {
          const using = agentsUsingModel(m.id);
          if (using.length > 0) {
            emitNotification({
              kind: "update",
              title: `⚠️ ${m.label} 모델 지원 종료 예정`,
              body: `${using.join(", ")}이(가) ${m.label}을(를) 사용 중인데 승계 모델이 지정되지 않았습니다. 설정 > 직원에서 직접 변경해 주세요.`,
              deepLink: { panel: "settings", route: "staff" },
              idempotencyKey: `model:deprecated:${m.id}`,
            });
            console.log(`[UpdateCheck] 지원 종료 모델 알림(승계 없음): ${m.id} (사용: ${using.join(",")})`);
          }
        }
      }
    }

    writeFileSync(MODEL_CATALOG_FILE, JSON.stringify({ models, checkedAt: new Date().toISOString() }, null, 2));
    invalidateCatalogCache(); // 새 카탈로그를 받았으니 승계 맵을 다시 만든다
  } catch (err) {
    console.warn("[UpdateCheck] 모델 카탈로그 확인 실패:", err instanceof Error ? err.message : err);
  }
}

// ── 공지 확인 — 스토어 공개 공지(/api/notices)를 수신해 알림 드로어 '공지'로 전파 ────
// 알림은 공지 id별 1회(idempotencyKey + seen 파일). 본문(HTML)·이동 버튼은 notice
// 페이로드로 실어 클라이언트가 인라인 펼침으로 렌더한다.
const NOTICES_SEEN_FILE = join(HISTORY_DIR, "notices-seen.json");

interface StoreNotice {
  id: string;
  title: string;
  body_html: string;
  button_enabled: boolean;
  button_label: string | null;
  button_target_type: "url" | "app" | "plugin" | null;
  button_target: string | null;
  button_new_tab?: boolean;
  created_at: string;
}

// 관리자 작성 HTML이지만 방어적으로 script/이벤트 핸들러는 제거해 저장한다.
function sanitizeNoticeHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function loadSeenNotices(): Set<string> {
  try {
    if (!existsSync(NOTICES_SEEN_FILE)) return new Set();
    const parsed = JSON.parse(readFileSync(NOTICES_SEEN_FILE, "utf-8"));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

async function checkNoticesOnce(): Promise<void> {
  const storeUrl = (process.env.MYCREW_STORE_URL || "https://store.dooitspace.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${storeUrl}/api/notices`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return; // 구버전 스토어 — 조용히 스킵
    const body = (await res.json()) as { notices?: StoreNotice[] };
    const notices = Array.isArray(body.notices) ? body.notices : [];
    if (notices.length === 0) return;

    const seen = loadSeenNotices();
    let changed = false;
    for (const n of notices) {
      if (!n.id || !n.title || seen.has(n.id)) continue;
      const button = n.button_enabled && n.button_label && n.button_target_type && n.button_target
        ? { label: n.button_label, targetType: n.button_target_type, target: n.button_target, newTab: n.button_new_tab !== false }
        : undefined;
      emitNotification({
        kind: "notice",
        title: `📢 ${n.title}`,
        body: "클릭하면 내용이 펼쳐집니다",
        notice: { html: sanitizeNoticeHtml(n.body_html || ""), ...(button ? { button } : {}) },
        idempotencyKey: `notice:${n.id}`,
      });
      seen.add(n.id);
      changed = true;
      console.log(`[UpdateCheck] 새 공지 알림: ${n.title}`);
    }
    if (changed) {
      writeFileSync(NOTICES_SEEN_FILE, JSON.stringify([...seen].slice(-200)));
    }
  } catch (err) {
    console.warn("[UpdateCheck] 공지 확인 실패:", err instanceof Error ? err.message : err);
  }
}

// ── 스킬 자동 동기화 — store.dooitspace.com/catalog/skill 기준 ────────────────────────
// 카탈로그의 GitHub 스킬 리포를 없으면 설치 / outdated면 최신 커밋으로 갱신하고 알림한다.
// MYCREW_SKILL_AUTOSYNC=0 으로 옵트아웃. 실제 다운로드/설치는 store-github-skills.ts의
// 기존 안전장치(github.com 전용·zip-slip 방어·80MB 상한·관리 마커)를 그대로 재사용한다.
async function checkSkillsOnce(): Promise<void> {
  if (process.env.MYCREW_SKILL_AUTOSYNC === "0") return;
  try {
    const { syncStoreSkillCatalog } = await import("./routes/store-github-skills.js");
    const results = await syncStoreSkillCatalog();
    const changed = results.filter((r) => r.action === "installed" || r.action === "updated");
    for (const r of changed) {
      const label = r.repoUrl.split("/").slice(-2).join("/");
      emitNotification({
        kind: "update",
        title: r.action === "installed" ? `🆕 새 스킬 설치: ${label}` : `⬆️ 스킬 업데이트: ${label}`,
        body: `${r.skills.length}개 스킬을 ${r.action === "installed" ? "다운로드·설치" : "최신 버전으로 갱신"}했습니다.`,
        deepLink: { panel: "settings", route: "general" },
        idempotencyKey: `skill:${r.action}:${r.repoUrl}:${r.skills.length}`,
      });
    }
    const failedList = results.filter((r) => r.action === "failed");
    for (const f of failedList) console.warn(`[UpdateCheck] 스킬 동기화 실패: ${f.repoUrl} — ${f.detail ?? "unknown"}`);
    if (changed.length || failedList.length) {
      console.log(`[UpdateCheck] 스킬 자동동기화: 변경 ${changed.length}, 실패 ${failedList.length}, 전체 ${results.length}`);
    }
  } catch (err) {
    console.warn("[UpdateCheck] 스킬 자동동기화 실패:", err instanceof Error ? err.message : err);
  }
}

/** 즉시 재확인 (설정 화면 "지금 확인" 버튼) — 갱신된 상태를 반환. */
export async function checkUpdatesNow(): Promise<UpdateStatus> {
  await Promise.allSettled([checkPackageOnce(), checkAppsOnce(), checkModelsOnce(), checkNoticesOnce(), checkSkillsOnce()]);
  return lastStatus;
}

export function startUpdateCheck(): void {
  // 부팅 30초 후 1회 (기동 경합 회피) → 이후 6시간 주기
  setTimeout(() => void checkUpdatesNow(), 30_000).unref?.();
  setInterval(() => void checkUpdatesNow(), CHECK_INTERVAL_MS).unref?.();
}

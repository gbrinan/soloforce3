// Client-side app registry: polls /api/apps/manifest, caches in memory + localStorage.
// Stores per-app user settings (enabled, headerShortcut, fabPosition, autostart, displayMode).
// 앱 설치 온보딩 안내 — 서버 스키마 미러 (src/server/app-registry.ts AppSetupGuide).
export interface AppSetupGuide {
  intro?: string;
  steps: { title: string; detail?: string }[];
  envVars?: { name: string; label?: string; required?: boolean }[];
  services?: { name: string; url: string; desc?: string }[];
  docsUrl?: string;
}

export interface AppManifestClient {
  id: string;
  name: string;
  version: string;
  icon?: string;
  category: "core" | "optional";
  entry: { kind: "iframe" | "window"; url: string; bypassProxy?: boolean };
  capabilities?: string[];
  description?: string;
  healthPath?: string;
  setupGuide?: AppSetupGuide;
}

export interface AppUserSettings {
  enabled: boolean;
  headerShortcut: boolean;
  autostart: boolean;
  fabPosition: "br" | "bl" | "tr";
  displayMode: "iframe" | "window";
}

const STORAGE_KEY = "mycrew:appSettings";
const ORDER_KEY = "mycrew:appOrder";
const SETTINGS_EVENT = "mycrew:app-settings-changed";
const REGISTRY_EVENT = "mycrew:app-registry-changed";
const ORDER_EVENT = "mycrew:app-order-changed";

function defaultSettings(): AppUserSettings {
  return { enabled: true, headerShortcut: true, autostart: true, fabPosition: "br", displayMode: "iframe" };
}

let cachedManifests: AppManifestClient[] = [];
let pollTimer: number | null = null;

export function loadAppSettings(): Record<string, AppUserSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch { return {}; }
}

export function getAppSettings(appId: string): AppUserSettings {
  const all = loadAppSettings();
  return { ...defaultSettings(), ...(all[appId] || {}) };
}

export function saveAppSettings(appId: string, next: Partial<AppUserSettings>): void {
  const all = loadAppSettings();
  all[appId] = { ...defaultSettings(), ...(all[appId] || {}), ...next };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch {}
  try { window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { appId } })); } catch {}
}

export function onAppSettingsChanged(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(SETTINGS_EVENT, h);
  return () => window.removeEventListener(SETTINGS_EVENT, h);
}

export function getManifests(): AppManifestClient[] {
  return applyOrder(cachedManifests);
}

export function getVisibleManifests(): AppManifestClient[] {
  return applyOrder(cachedManifests).filter((m) => {
    const s = getAppSettings(m.id);
    return s.enabled && s.headerShortcut;
  });
}

// Persisted app display order — id[] in user-chosen sequence. Unknown ids appended after.
export function loadAppOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function saveAppOrder(ids: string[]): void {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch {}
  try { window.dispatchEvent(new CustomEvent(ORDER_EVENT)); } catch {}
}

export function onAppOrderChanged(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(ORDER_EVENT, h);
  return () => window.removeEventListener(ORDER_EVENT, h);
}

function applyOrder(list: AppManifestClient[]): AppManifestClient[] {
  const order = loadAppOrder();
  if (order.length === 0) return list;
  const byId = new Map(list.map((m) => [m.id, m]));
  const ordered: AppManifestClient[] = [];
  for (const id of order) {
    const m = byId.get(id);
    if (m) { ordered.push(m); byId.delete(id); }
  }
  for (const m of byId.values()) ordered.push(m);
  return ordered;
}

export async function removeApp(appId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/apps/${appId}/remove`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      return { ok: false, error: body?.error || res.statusText };
    }
    // Order list cleanup — drop removed id.
    const order = loadAppOrder().filter((x) => x !== appId);
    if (order.length) saveAppOrder(order);
    // Force a manifest refresh so the UI updates immediately instead of waiting up to 30s.
    await pollOnce();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function onAppRegistryChanged(cb: (list: AppManifestClient[]) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<AppManifestClient[]>).detail);
  window.addEventListener(REGISTRY_EVENT, h as EventListener);
  return () => window.removeEventListener(REGISTRY_EVENT, h as EventListener);
}

async function pollOnce(): Promise<void> {
  try {
    const res = await fetch("/api/apps/manifest");
    if (!res.ok) return;
    // Server wraps the manifest list in { apps: [...] }. Unwrap defensively in case
    // a future build returns the bare array.
    const body = await res.json() as { apps?: AppManifestClient[] } | AppManifestClient[];
    const list: AppManifestClient[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.apps) ? body.apps : [];
    const prev = JSON.stringify(cachedManifests);
    const next = JSON.stringify(list);
    if (prev !== next) {
      cachedManifests = list;
      try { window.dispatchEvent(new CustomEvent(REGISTRY_EVENT, { detail: list })); } catch {}
    }
  } catch {}
}

export function startAppRegistryPoll(intervalMs = 30_000): void {
  pollOnce();
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(pollOnce, intervalMs);
}

export function stopAppRegistryPoll(): void {
  if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
}

export async function requestPairToken(appId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/apps/${appId}/pair`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.token === "string" ? data.token : null;
  } catch { return null; }
}

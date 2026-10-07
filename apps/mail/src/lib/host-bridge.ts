export type HostToAppType =
  | "chat.state"
  | "theme.sync"
  | "auth.token"
  | "lock.state"
  | "locale.sync"
  | "uninstall.request"
  | "asset.load";

export interface AssetLoadPayload {
  kind: string;
  url: string;
  name?: string;
}

export interface HostMessage {
  source: "mycrew-host";
  type: HostToAppType;
  payload: unknown;
}

function isHostMessage(d: unknown): d is HostMessage {
  if (typeof d !== "object" || d === null) return false;
  const m = d as { source?: unknown; type?: unknown };
  return m.source === "mycrew-host" && typeof m.type === "string";
}

const ALLOWED_HOST_ORIGINS = [
  "http://localhost:3457",
  "http://localhost:3456",
  "http://127.0.0.1:3457",
  "http://127.0.0.1:3456",
  "https://mycrew.doitspace.com",
];

export function postReadyToHost(unreadCount = 0): void {
  if (typeof window === "undefined") return;
  if (window.parent === window) return;
  window.parent.postMessage(
    { source: "mycrew-mail", type: "app.ready" },
    "*",
  );
  window.parent.postMessage(
    { source: "mycrew-mail", type: "mail.status", payload: { unreadCount } },
    "*",
  );
}

export interface HostHandlers {
  onTheme?: (theme: "light" | "dark") => void;
  onLocale?: (locale: string) => void;
  onLock?: (locked: boolean) => void;
  onAsset?: (asset: AssetLoadPayload) => void;
  onAssets?: (assets: AssetLoadPayload[]) => void;
  onMailto?: (email: string) => void;
}

export function subscribeHost(handlers: HostHandlers): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onMessage = (e: MessageEvent) => {
    const sameOrigin = e.origin === window.location.origin;
    if (!sameOrigin && !ALLOWED_HOST_ORIGINS.includes(e.origin)) return;
    if (!isHostMessage(e.data)) return;
    const { type, payload } = e.data;
    if (type === "theme.sync" && handlers.onTheme) {
      if (payload === "light" || payload === "dark") handlers.onTheme(payload);
    } else if (type === "locale.sync" && handlers.onLocale) {
      if (typeof payload === "string") handlers.onLocale(payload);
    } else if (type === "lock.state" && handlers.onLock) {
      handlers.onLock(Boolean(payload));
    } else if (type === "asset.load" && (handlers.onAsset || handlers.onAssets || handlers.onMailto)) {
      const p = payload as Partial<AssetLoadPayload & { assets?: unknown; mailto?: unknown }> | null;
      if (p) {
        if (typeof p.mailto === "string" && p.mailto && handlers.onMailto) {
          handlers.onMailto(p.mailto);
        } else if (Array.isArray(p.assets) && p.assets.length > 0 && handlers.onAssets) {
          const valid = (p.assets as Array<Partial<AssetLoadPayload>>)
            .filter((a) => typeof a.url === "string")
            .map((a) => ({ kind: typeof a.kind === "string" ? a.kind : "file", url: a.url as string, name: a.name }));
          if (valid.length > 0) handlers.onAssets(valid);
        } else if (typeof p.url === "string" && handlers.onAsset) {
          handlers.onAsset({ kind: typeof p.kind === "string" ? p.kind : "file", url: p.url, name: p.name });
        }
      }
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

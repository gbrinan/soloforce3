// HostBridge — MyCrew 호스트 ↔ design iframe postMessage 어댑터.
// mymovie/isenssign 패턴(SSOReceiver 등)을 따른다: 자식은 ready 신호를
// 부모(window.parent)에 1회 전송하고, theme.sync / lock.state 등 호스트
// 푸시 메시지를 수신해 로컬 상태에 반영.

export type HostToAppType =
  | "chat.state"
  | "theme.sync"
  | "auth.token"
  | "lock.state"
  | "locale.sync"
  | "uninstall.request"
  | "asset.load";

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

export function postReadyToHost(): void {
  if (typeof window === "undefined") return;
  if (window.parent === window) return;
  // host iframe origin is unknown to us at runtime; "*" is acceptable for the
  // ready handshake (no secrets exchanged).
  window.parent.postMessage(
    { source: "mycrew-design", type: "app.ready" },
    "*",
  );
}

export interface AssetHandoffPayload {
  targetAppId: string;
  kind: "image" | "video" | "file";
  /** base64 data: URL so the receiving app can fetch it from any origin */
  dataUrl: string;
  name: string;
}

// Forward a finished artifact (e.g. PNG/SVG export) to another installed
// MyCrew app via the host shell. Host routes it through openAppWithAsset.
export function postAssetHandoffToHost(payload: AssetHandoffPayload): void {
  if (typeof window === "undefined") return;
  if (window.parent === window) return;
  window.parent.postMessage(
    { source: "mycrew-design", type: "asset.handoff", payload },
    "*",
  );
}

export interface HostAsset {
  kind: "image" | "video";
  url: string;
  name?: string;
}

export interface HostHandlers {
  onTheme?: (theme: "light" | "dark") => void;
  onLocale?: (locale: string) => void;
  onLock?: (locked: boolean) => void;
  onAsset?: (asset: HostAsset) => void;
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
    } else if (type === "asset.load" && handlers.onAsset) {
      const p = payload as { kind?: string; url?: string; name?: string } | null;
      if (p && typeof p.url === "string") {
        handlers.onAsset({
          kind: p.kind === "video" ? "video" : "image",
          url: p.url,
          name: typeof p.name === "string" ? p.name : undefined,
        });
      }
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

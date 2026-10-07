export type HostToAppType =
  | "chat.state"
  | "theme.sync"
  | "auth.token"
  | "lock.state"
  | "locale.sync"
  | "uninstall.request";

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
  window.parent.postMessage(
    { source: "mycrew-booking", type: "app.ready" },
    "*",
  );
}

export interface HostHandlers {
  onTheme?: (theme: "light" | "dark") => void;
  onLocale?: (locale: string) => void;
  onLock?: (locked: boolean) => void;
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
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

// ChatBridge: thin postMessage helper between host and app iframe.
// Used by AppHostFrame to push state TO the iframe (chat open/close, theme, auth).
export type HostToAppType = "chat.state" | "theme.sync" | "auth.token" | "lock.state" | "uninstall.request" | "asset.load" | "asset.save" | "travel.applyPatch" | "mymaps:add-place";

export function postToApp(iframe: HTMLIFrameElement | null, type: HostToAppType, payload: unknown): void {
  if (!iframe || !iframe.contentWindow) return;
  try {
    const targetOrigin = new URL(iframe.src).origin;
    iframe.contentWindow.postMessage({ source: "mycrew-host", type, payload }, targetOrigin);
  } catch (err) {
    console.warn("[ChatBridge] postToApp failed:", err);
  }
}

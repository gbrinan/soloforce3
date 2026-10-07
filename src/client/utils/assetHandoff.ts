// Hands a chat media asset (image/video) off to an installed sub-app.
// MediaActions dispatches; App.tsx listens, opens the app, and stages the asset
// for AppHostFrame to deliver into the iframe once the app reports ready.
import { getManifests, getAppSettings } from "./appRegistry";

export type MediaKind = "image" | "video" | "file";

export interface AssetHandoff {
  appId: string;
  kind: MediaKind;
  url: string;
  name?: string;
  localFile?: boolean;
  assets?: Array<{ kind: MediaKind; url: string; name?: string }>;
  mailto?: string;
}

const OPEN_EVENT = "mycrew:open-app-with-asset";

// An app is usable as a handoff target only when installed AND enabled in the launcher popup.
export function isAppAvailable(appId: string): boolean {
  return getManifests().some((m) => m.id === appId) && getAppSettings(appId).enabled;
}

// Resolve a possibly-relative asset URL to an absolute one so the sub-app iframe can load it.
export function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

export function openAppWithAsset(asset: AssetHandoff): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { ...asset, url: toAbsoluteUrl(asset.url) } }));
}

export function onOpenAppWithAsset(cb: (asset: AssetHandoff) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<AssetHandoff>).detail);
  window.addEventListener(OPEN_EVENT, h as EventListener);
  return () => window.removeEventListener(OPEN_EVENT, h as EventListener);
}

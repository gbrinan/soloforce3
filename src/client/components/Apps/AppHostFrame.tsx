import { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Button, Group, Text, useComputedColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconRefresh, IconX } from "@tabler/icons-react";
import { fetchAppUpdateMap, updateApp, type AppUpdateStatus } from "../../utils/appUpdates";
import { requestPairToken, type AppManifestClient } from "../../utils/appRegistry";
import { postToApp } from "./ChatBridge";
import { openAppWithAsset, type AssetHandoff } from "../../utils/assetHandoff";
import { useAppDisplayName } from "./useAppDisplayName";
import { btn } from "../../ui/controls";
import { useT } from "../../i18n/I18nProvider";

interface Props {
  manifest: AppManifestClient;
  onReturn: () => void;
  onChatOpenRequest: (ctx: { view?: string; albumId?: string | null; assetId?: string | null }) => void;
  onChatCloseRequest: () => void;
  pendingAsset?: AssetHandoff | null;
  onAssetDelivered?: () => void;
  onNavigate?: (to: string) => void;
}

// External apps served by their own live host (not a local port) load their URL directly
// and skip the proxy pairing / health-ping machinery, which only applies to locally-spawned port apps.
function isExternalUrl(url?: string): url is string {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !/^https?:\/\/(127\.0\.0\.1|localhost)\b/i.test(url);
}

// Some apps (TREK travel) serve absolute paths (/assets/...) and ship their own
// SAMEORIGIN headers. They cannot route through /api/apps/:id/proxy because the
// browser resolves absolute paths against the parent origin, not the proxy
// prefix. Such manifests opt out via entry.bypassProxy=true so the iframe loads
// the URL directly (a sidecar must strip X-Frame-Options upstream).
function isDirectLoadUrl(manifest: { entry?: { url?: string; bypassProxy?: boolean } }): boolean {
  return Boolean(manifest.entry?.bypassProxy && manifest.entry?.url);
}

const PING_DELAY_MS = 3000;
const PING_RETRY_COUNT = 6;
const PING_RETRY_INTERVAL_MS = 2000;
const PING_FETCH_TIMEOUT_MS = 4000;

// 앱 헤더 업데이트 버튼 — 스토어에 새 버전이 있을 때만 렌더. 현재/최신 버전을 툴팁으로 안내.
function AppUpdateButton({ appId, onUpdated }: { appId: string; onUpdated: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAppUpdateMap()
      .then((map) => { if (!cancelled) setStatus(map.get(appId) ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [appId]);

  if (!status?.updatable) return null;

  const run = async () => {
    setUpdating(true);
    try {
      const r = await updateApp(appId);
      notifications.show({ color: "green", title: t('apps.updateCompleteTitle'), message: t('apps.updateCompleteMessage', { name: status.name, version: r.version }) });
      setStatus({ ...status, currentVersion: r.version, updatable: false });
      onUpdated();
    } catch (err) {
      notifications.show({ color: "red", title: t('apps.updateFailedTitle'), message: (err as Error).message });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Button
      size="compact-xs"
      color="indigo"
      loading={updating}
      onClick={() => void run()}
      title={t('apps.updateTooltip', { current: status.currentVersion, latest: status.latestVersion })}
    >
      {t('apps.updateButtonLabel', { version: status.latestVersion })}
    </Button>
  );
}

export default function AppHostFrame({ manifest, onReturn, onChatOpenRequest, onChatCloseRequest, pendingAsset, onAssetDelivered, onNavigate }: Props) {
  const t = useT();
  const getDisplayName = useAppDisplayName();
  const displayName = getDisplayName(manifest);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ssoToken, setSsoToken] = useState<string | null>(null);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [appStatus, setAppStatus] = useState<{ status?: string; label?: string } | null>(null);

  const appReadyRef = useRef(false);
  const deliveredRef = useRef(false);
  // Guards against re-sending auth.token on every app.ready event. Travel
  // iframe was looping mount/unmount and we don't want the host to refire
  // SSO each cycle — once delivered, stay delivered until manifest changes.
  const authTokenSentRef = useRef(false);

  // Clear any app-reported status badge when switching apps.
  useEffect(() => { setAppStatus(null); appReadyRef.current = false; deliveredRef.current = false; authTokenSentRef.current = false; }, [manifest.id]);

  // Deliver a pending media handoff. photos has no postMessage receiver, so the image
  // is uploaded into its library via the proxy; design/movie receive "asset.load" (open
  // it in the editor). Guarded so it fires once per asset.
  const deliverPendingAsset = useCallback(() => {
    if (!pendingAsset || deliveredRef.current) return;
    if (pendingAsset.appId !== manifest.id) return;
    deliveredRef.current = true;
    if (manifest.id === "photos") {
      // The photos app has no asset.save postMessage handler, so save the image by
      // uploading it into the library via the same-origin proxy. The upload emits a
      // library.imported bus event, so the already-open iframe refreshes its timeline.
      const asset = pendingAsset;
      void (async () => {
        try {
          const res = await fetch(asset.url);
          if (!res.ok) throw new Error(`fetch image ${res.status}`);
          const blob = await res.blob();
          const ext = (blob.type.split("/")[1] || "png").split("+")[0];
          const filename = asset.name && /\.[a-z0-9]+$/i.test(asset.name) ? asset.name : `${asset.name || "image"}.${ext}`;
          const fd = new FormData();
          fd.append("file[]", blob, filename);
          const up = await fetch("/api/apps/photos/proxy/api/library/upload", { method: "POST", body: fd });
          if (!up.ok) throw new Error(`upload ${up.status}`);
        } catch (err) {
          console.warn("[AppHostFrame] photos save failed:", err);
        }
      })();
    } else {
      if (pendingAsset.mailto) {
        postToApp(iframeRef.current, "asset.load", { mailto: pendingAsset.mailto });
      } else if (pendingAsset.assets && pendingAsset.assets.length > 0) {
        postToApp(iframeRef.current, "asset.load", { assets: pendingAsset.assets });
      } else {
        postToApp(iframeRef.current, "asset.load", { kind: pendingAsset.kind, url: pendingAsset.url, name: pendingAsset.name, localFile: pendingAsset.localFile });
      }
    }
    onAssetDelivered?.();
  }, [pendingAsset, manifest.id, onAssetDelivered]);

  // Fallback: some apps don't emit app.ready. Once iframe src is set and the app has
  // had time to attach its listener, deliver anyway.
  useEffect(() => {
    if (!pendingAsset || !src) return;
    deliveredRef.current = false;
    if (appReadyRef.current) { deliverPendingAsset(); return; }
    const timer = setTimeout(() => deliverPendingAsset(), PING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pendingAsset, src, deliverPendingAsset]);

  // Acquire pairing token then build iframe src via the host's same-origin proxy.
  // Loading manifest.entry.url (e.g. http://127.0.0.1:3201) directly fails for
  // external hosts / https origins / mixed-content / private-network-access; the
  // /api/apps/:id/proxy/* route forwards transparently and stays same-origin.
  useEffect(() => {
    if (isExternalUrl(manifest.entry?.url) || isDirectLoadUrl(manifest)) {
      setToken(null);
      setSrc(manifest.entry.url);
      return;
    }
    let cancelled = false;
    (async () => {
      const t = await requestPairToken(manifest.id);
      if (cancelled) return;
      setToken(t);
      const base = `/api/apps/${manifest.id}/proxy`;
      const withToken = t ? `${base}/?token=${encodeURIComponent(t)}` : `${base}/`;
      setSrc(withToken);
    })();
    return () => { cancelled = true; };
  }, [manifest.id, manifest.entry?.url]);

  // Fetch SSO token + Google id_token for iframe auto-login (Firebase SSO)
  // travel 앱이면서 needsReauth=true (세션에 refresh_token 없거나 Google이 revoke) → 사용자에게
  // 재로그인 안내. 다른 앱은 Firebase 의존도가 없으므로 조용히 게스트로 진입.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ssoRes, idTokenRes] = await Promise.all([
          fetch("/api/sso/issue-token", { credentials: "include" }),
          fetch("/api/sso/google-id-token", { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (ssoRes.ok) {
          const data = await ssoRes.json();
          setSsoToken(data.token || null);
        }
        if (idTokenRes.ok) {
          const data = (await idTokenRes.json()) as { idToken: string | null; needsReauth?: boolean };
          setGoogleIdToken(data.idToken || null);
          if (!data.idToken && data.needsReauth && manifest.id === "travel") {
            notifications.show({
              id: "travel-sso-reauth",
              color: "yellow",
              title: t('apps.travelReauthTitle'),
              message: t('apps.travelReauthMessage'),
              autoClose: 8000,
              withCloseButton: true,
              onClick: () => { window.location.href = "/auth/logout"; },
              styles: { root: { cursor: "pointer" } },
            });
          }
        }
      } catch (err) {
        console.warn("[AppHostFrame] SSO token fetch failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [manifest.id, t]);

  // Expose travel patch emitter so ChatPanel can push trip mutations into the iframe
  useEffect(() => {
    if (manifest.id !== "travel") return;
    const w = window as unknown as { __mycrewTravelEmit?: (patch: unknown) => void };
    w.__mycrewTravelEmit = (patch) => postToApp(iframeRef.current, "travel.applyPatch", patch);
    return () => { delete w.__mycrewTravelEmit; };
  }, [manifest.id]);

  // Expose mymaps place injector so PlaceCard can push places into the active mymaps iframe
  useEffect(() => {
    if (manifest.id !== "mymaps") return;
    const w = window as unknown as { __mycrewSendToMymaps?: (place: unknown) => void };
    w.__mycrewSendToMymaps = (place) => postToApp(iframeRef.current, "mymaps:add-place", place);
    return () => { delete w.__mycrewSendToMymaps; };
  }, [manifest.id]);

  // Push MyCrew's color scheme into the travel iframe. The TREK overlay
  // requests this on handshake and re-applies on every change so TREK's
  // theme stays in sync with MyCrew. Only travel needs this today; gate by
  // manifest id so other iframes don't receive spurious messages.
  const computedColorScheme = useComputedColorScheme("dark", { getInitialValueInEffect: true });
  useEffect(() => {
    if (manifest.id !== "travel") return;
    postToApp(iframeRef.current, "theme.sync", computedColorScheme);
  }, [manifest.id, computedColorScheme, src]);

  // Postmessage router — same-origin proxy apps share window.origin; directLoad
  // apps (e.g. travel/TREK at localhost:4002) have a different origin so we
  // also allow their iframe entry URL's origin.
  useEffect(() => {
    const allowedOrigins = new Set<string>([window.location.origin]);
    try {
      if (isDirectLoadUrl(manifest)) {
        allowedOrigins.add(new URL(manifest.entry!.url!).origin);
      }
    } catch { /* ignore malformed entry url */ }
    const allowedSources = ["mycrew-photos", "mycrew-isenssign", "mycrew-mymovie", "mycrew-pdf", "mycrew-design", "mycrew-booking", "mycrew-mail", "mycrew-payment", "mycrew-travel", "mycrew-mymaps", "mycrew-notes", "mycrew-bookshelf"];
    const onMsg = (e: MessageEvent) => {
      if (!allowedOrigins.has(e.origin)) return;
      const d = e.data;
      if (!d || !allowedSources.includes(d.source)) return;
      if (d.type === "chat.open") onChatOpenRequest(d.payload?.context || {});
      else if (d.type === "pdf.status") setAppStatus(d.payload || null);
      else if (d.type === "chat.close") onChatCloseRequest();
      else if (d.type === "navigate.back") onReturn();
      else if (d.type === "navigate" && typeof d.to === "string") onNavigate?.(d.to);
      else if (d.type === "mail:add-schedule") {
        // Mail extracted an event from a message body — register it as a MyCrew schedule.
        const p = (d.payload ?? {}) as { title?: unknown; date?: unknown; time?: unknown; location?: unknown; subject?: unknown };
        const title = typeof p.title === "string" ? p.title.trim() : "";
        const date = typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : "";
        if (!title || !date) {
          notifications.show({ color: "red", message: t('apps.scheduleInvalidMessage') });
          return;
        }
        const time = typeof p.time === "string" && /^\d{2}:\d{2}$/.test(p.time) ? p.time : null;
        const allDay = !time;
        const start = time ? `${date}T${time}:00` : `${date}T00:00:00`;
        const end = time
          ? new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString()
          : `${date}T23:59:59`;
        void (async () => {
          try {
            const res = await fetch("/api/schedules", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                title,
                start,
                end,
                allDay,
                location: typeof p.location === "string" ? p.location : undefined,
                description: typeof p.subject === "string" ? t('apps.scheduleFromMailDesc', { subject: p.subject }) : undefined,
              }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            notifications.show({ color: "green", title: t('apps.scheduleAddedTitle'), message: `${date}${time ? ` ${time}` : ""} — ${title}` });
          } catch (err) {
            notifications.show({ color: "red", title: t('apps.scheduleAddFailedTitle'), message: (err as Error).message });
          }
        })();
      } else if (d.type === "mymaps:place-attach") {
        // MyMaps "보내기" button → push place into ChatPanel's attachment area via custom event
        if (d.payload?.attachment) {
          window.dispatchEvent(new CustomEvent("mycrew:place-attach", { detail: d.payload.attachment }));
        }
      } else if (d.type === "drag.start") {
        // Stage payload in window-level slots. Cross-origin sandboxed iframes can strip
        // dataTransfer payload before parent onDrop fires; ChatPanel.handleDrop reads
        // these slots as a last-resort fallback after dataTransfer-based extraction fails.
        const w = window as unknown as { __mycrewDropUrl?: string | null; __mycrewDropAttachment?: unknown; __mycrewDropMeta?: { url: string; name: string } | null };
        if (d.payload?.url) w.__mycrewDropUrl = String(d.payload.url);
        if (d.payload?.attachment) w.__mycrewDropAttachment = d.payload.attachment;
        if (d.payload?.url) w.__mycrewDropMeta = { url: String(d.payload.url), name: typeof d.payload.name === "string" ? d.payload.name : "" };
      } else if (d.type === "drag.end") {
        // Defer clear so onDrop (fires before dragend on some browsers) still sees the payload.
        setTimeout(() => {
          const w = window as unknown as { __mycrewDropUrl?: string | null; __mycrewDropAttachment?: unknown; __mycrewDropMeta?: unknown };
          w.__mycrewDropUrl = null;
          w.__mycrewDropAttachment = null;
          w.__mycrewDropMeta = null;
        }, 1500);
      } else if (d.type === "app.ready") {
        // App is alive — push SSO token + Google id_token for Firebase SSO
        appReadyRef.current = true;
        // travel(Firebase)만 googleIdToken이 필수. sign 등 다른 앱은 ssoToken만으로 자동 로그인하므로
        // googleIdToken이 null이어도 즉시 전송한다. (이 게이트가 없으면 sign 앱에 토큰이 영원히 안 감 → API 401)
        // 여기서 못 보내면(googleIdToken 미도착) 아래 late-arrival useEffect가 도착 시 한 번 더 보낸다.
        const requiresGoogleToken = manifest.id === "travel";
        if (ssoToken && (googleIdToken || !requiresGoogleToken) && !authTokenSentRef.current) {
          authTokenSentRef.current = true;
          postToApp(iframeRef.current, "auth.token", { ssoToken, googleIdToken });
        }
        deliverPendingAsset();
      } else if (d.type === "theme.request" || d.type === "trek-ready") {
        // Travel/TREK overlay asks for current theme on every load.
        if (manifest.id === "travel") {
          postToApp(iframeRef.current, "theme.sync", computedColorScheme);
        }
      } else if (d.type === "asset.handoff") {
        // iframe sub-app forwards a finished artifact to another installed app
        // (e.g. design → mail). Payload carries a self-contained data: URL so the
        // receiving app can fetch() it from any origin.
        const p = (d.payload ?? {}) as { targetAppId?: unknown; kind?: unknown; dataUrl?: unknown; name?: unknown; assets?: unknown };
        if (typeof p.targetAppId === "string") {
          if (Array.isArray(p.assets) && p.assets.length > 0) {
            const validAssets = (p.assets as Array<{ kind?: unknown; url?: unknown; name?: unknown }>)
              .filter((a) => typeof a.url === "string" && (a.url.startsWith("data:") || (a.url as string).startsWith("/api/")))
              .map((a) => ({
                kind: (a.kind === "image" || a.kind === "video" ? a.kind : "file") as AssetHandoff["kind"],
                url: a.url as string,
                name: typeof a.name === "string" && a.name ? a.name : "attachment",
              }));
            if (validAssets.length > 0) {
              openAppWithAsset({ appId: p.targetAppId, kind: validAssets[0].kind, url: validAssets[0].url, name: validAssets[0].name, assets: validAssets });
            }
          } else if (typeof p.dataUrl === "string" && (p.dataUrl.startsWith("data:") || p.dataUrl.startsWith("/api/"))) {
            const kind: AssetHandoff["kind"] = p.kind === "image" || p.kind === "video" ? p.kind : "file";
            const name = typeof p.name === "string" && p.name ? p.name : "attachment";
            openAppWithAsset({ appId: p.targetAppId, kind, url: p.dataUrl, name });
          } else if (typeof (p as { mailto?: unknown }).mailto === "string" && (p as { mailto?: unknown }).mailto) {
            openAppWithAsset({ appId: p.targetAppId, kind: "file", url: "", mailto: (p as { mailto?: unknown }).mailto as string });
          }
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onChatOpenRequest, onChatCloseRequest, onReturn, onNavigate, ssoToken, googleIdToken, deliverPendingAsset, manifest, computedColorScheme, t]);

  // SSO 토큰이 travel의 app.ready보다 늦게 도착하는 race 방지:
  // 토큰 fetch 완료 시 이미 app.ready를 받았고 아직 token을 보내지 않았다면 1회만 전송한다.
  // (google-id-token은 Google 서버 왕복이라 app.ready보다 늦을 수 있음)
  useEffect(() => {
    const requiresGoogleToken = manifest.id === "travel";
    if (appReadyRef.current && ssoToken && (googleIdToken || !requiresGoogleToken) && !authTokenSentRef.current) {
      authTokenSentRef.current = true;
      postToApp(iframeRef.current, "auth.token", { ssoToken, googleIdToken });
    }
  }, [ssoToken, googleIdToken, manifest.id]);

  // Health ping with retry — iframe loads regardless; ping only gates the error banner.
  // 클라이언트에서 manifest.entry.url(예: http://127.0.0.1:3201)을 직접 fetch하면
  // (1) 메인이 https로 노출될 때 mixed-content 차단, (2) cross-origin CORS preflight 실패,
  // (3) 사용자가 다른 머신에서 접속 시 127.0.0.1 격리로 fetch 실패한다.
  // 호스트 서버가 server-side로 :3201로 fetch하는 same-origin proxy를 거치도록 우회.
  useEffect(() => {
    if (isExternalUrl(manifest.entry?.url) || isDirectLoadUrl(manifest)) { setError(null); return; }
    let alive = true;
    setError(null);
    const healthPath = manifest.healthPath || "/health";
    const normalized = healthPath.startsWith("/") ? healthPath.slice(1) : healthPath;
    const url = `/api/apps/${manifest.id}/proxy/${normalized}`;
    const pingOnce = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), PING_FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        return res.ok ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, reason: (err as Error).message || "fetch error" };
      } finally {
        clearTimeout(abortTimer);
      }
    };
    const run = async () => {
      await new Promise((r) => setTimeout(r, PING_DELAY_MS));
      let lastReason = "";
      for (let attempt = 1; attempt <= PING_RETRY_COUNT; attempt++) {
        if (!alive) return;
        const result = await pingOnce();
        if (!alive) return;
        if (result.ok) return;
        lastReason = result.reason;
        if (attempt < PING_RETRY_COUNT) {
          await new Promise((r) => setTimeout(r, PING_RETRY_INTERVAL_MS));
        }
      }
      if (alive) setError(t('apps.pingFailed', { count: PING_RETRY_COUNT, reason: lastReason, url }));
    };
    void run();
    return () => { alive = false; };
  }, [manifest.id, manifest.healthPath, retryNonce, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, position: "relative" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
        flexWrap: manifest.id === 'projects' ? 'wrap' : 'nowrap',
        borderBottom: "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-body)",
      }}>
        <ActionIcon variant="subtle" size="sm" onClick={onReturn} title={t('apps.backToMycrew')} aria-label="back">
          <IconArrowLeft size={16} />
        </ActionIcon>
        {manifest.icon && (manifest.icon.startsWith("data:") || manifest.icon.startsWith("http") || manifest.icon.startsWith("/"))
          ? <img src={manifest.icon} alt="" width={20} height={20} style={{ objectFit: "contain", borderRadius: 4 }} />
          : <span style={{ fontSize: 16 }}>{manifest.icon || "📦"}</span>
        }
        <Text fw={600} size="sm">{displayName}</Text>
        <AppUpdateButton
          appId={manifest.id}
          onUpdated={() => {
            // 새 버전으로 재기동된 앱을 다시 로드
            setTimeout(() => iframeRef.current?.contentWindow?.location.reload(), 3000);
          }}
        />
        <div style={{ flex: 1 }} />
        {manifest.id === 'projects' && (
          <Button component="a" href="/project-drive" size="compact-xs" variant="light" title="Google Drive 프로젝트 업로드·가져오기" style={{ flexShrink: 0 }}>
            Drive 전송
          </Button>
        )}
        {appStatus?.label && (
          <Badge
            color={appStatus.status === "online" ? "teal" : appStatus.status === "offline" ? "red" : "gray"}
            variant="light"
            size="sm"
          >
            ● {appStatus.label}
          </Badge>
        )}
        <ActionIcon variant="subtle" size="sm" onClick={() => iframeRef.current?.contentWindow?.location.reload()} title={t('apps.refresh')} aria-label="reload">
          <IconRefresh size={16} />
        </ActionIcon>
        <ActionIcon variant="subtle" size={36} className="drawer-close" color="gray" onClick={onReturn} title={t('common.close')} aria-label="close">
          <IconX size={18} />
        </ActionIcon>
      </div>
      {error && (
        <div style={{ padding: 16, color: "var(--mantine-color-red-6)", fontSize: "var(--font-m)", whiteSpace: "pre-wrap" }}>
          {error}
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={() => setRetryNonce((n) => n + 1)} style={btn('sm', 'neutral')}>{t('apps.retry')}</button>
            <button onClick={onReturn} style={btn('sm', 'neutral')}>{t('apps.backToMycrew')}</button>
          </div>
        </div>
      )}
      {!error && src && (
        <iframe
          ref={iframeRef}
          src={src}
          style={{ flex: 1, border: 0, width: "100%" }}
          title={displayName}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
          allow="clipboard-read; clipboard-write; camera"
        />
      )}
      {!src && !error && (
        <div style={{ padding: 24, color: "var(--text-muted)", fontSize: "var(--font-m)" }}>
          {t('apps.pairingStatus', { status: token === null ? t('apps.pairingRequesting') : t('apps.pairingIssued') })}
        </div>
      )}
    </div>
  );
}

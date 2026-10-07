import { useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCopy, IconCheck, IconDownload, IconPhotoPlus, IconWand, IconMovie, IconMail } from "@tabler/icons-react";
import { isAppAvailable, openAppWithAsset, type MediaKind } from "../../utils/assetHandoff";
import { useT } from "../../i18n/I18nProvider";

interface Props {
  kind: MediaKind;
  url: string;
  name?: string;
  // Visual placement: floating overlay on the media, or inline row.
  variant?: "overlay" | "bar";
  // "url" mode: text-copy + link-open instead of blob fetch (for external embeds like YouTube).
  mode?: "blob" | "url";
}

function fileNameFrom(url: string, fallback: string): string {
  try {
    const u = new URL(url, window.location.origin);
    const last = u.pathname.split("/").pop();
    return last || fallback;
  } catch {
    return url.split("/").pop() || fallback;
  }
}

export default function MediaActions({ kind, url, name, variant = "overlay", mode }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const isImage = kind === "image";
  const dlName = name || fileNameFrom(url, isImage ? "image.png" : "video.mp4");

  const handleCopy = async () => {
    if (mode === "url") {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (err) {
        console.warn("[MediaActions] copy failed:", err);
      }
      return;
    }
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("[MediaActions] copy failed:", err);
    }
  };

  const handleSave = async () => {
    if (mode === "url" && kind === "video") {
      if (downloading) return;
      setDownloading(true);
      try {
        const res = await fetch("/api/youtube/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json() as { ok: boolean; path?: string; name?: string; error?: string };
        if (data.ok) {
          notifications.show({ color: "green", title: t("chat.downloadComplete"), message: t("chat.downloadCompleteDesc", { name: data.name ?? "" }), autoClose: 5000 });
        } else {
          notifications.show({ color: "red", title: t("chat.downloadFailed"), message: data.error ?? "download failed", autoClose: 5000 });
        }
      } catch (err) {
        notifications.show({ color: "red", title: t("chat.downloadFailed"), message: (err as Error).message, autoClose: 5000 });
      } finally {
        setDownloading(false);
      }
      return;
    }
    if (mode === "url") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = dlName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (err) {
      console.warn("[MediaActions] save failed:", err);
    }
  };

  const handleEdit = async () => {
    if (editLoading) return;
    if (mode === "url" && kind === "video") {
      setEditLoading(true);
      try {
        const res = await fetch("/api/youtube/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json() as { ok: boolean; serveUrl?: string; name?: string; error?: string };
        if (data.ok && data.serveUrl) {
          openAppWithAsset({ appId: "movie", kind: "video", url: data.serveUrl, name: data.name ?? dlName, localFile: true });
        } else {
          notifications.show({ color: "red", title: t("chat.downloadFailed"), message: data.error ?? "download failed", autoClose: 5000 });
        }
      } catch (err) {
        notifications.show({ color: "red", title: t("chat.downloadFailed"), message: (err as Error).message, autoClose: 5000 });
      } finally {
        setEditLoading(false);
      }
      return;
    }
    openAppWithAsset({ appId: "movie", kind, url, name: dlName });
  };

  const showPhotos = isImage && isAppAvailable("photos");
  const showDesign = isImage && isAppAvailable("design");
  const showMovie = !isImage && isAppAvailable("movie");
  const showMail = isAppAvailable("mail");

  const wrap: React.CSSProperties = variant === "overlay"
    ? {
        position: "absolute", top: 6, right: 6, display: "flex", gap: 4,
        padding: 4, borderRadius: 6, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        opacity: 0, transition: "opacity 0.15s ease",
      }
    : { display: "flex", gap: 6, marginTop: 6 };

  const iconBtnStyle = variant === "overlay" ? { color: "#fff" } : undefined;

  return (
    <div className="media-actions" style={wrap} onClick={(e) => e.stopPropagation()}>
      {(isImage || mode === "url") && (
        <Tooltip label={mode === "url" ? t("chat.mediaCopyUrl") : t("chat.mediaCopy")} withArrow>
          <ActionIcon variant={variant === "overlay" ? "transparent" : "subtle"} size="md" onClick={handleCopy} aria-label={mode === "url" ? t("chat.mediaCopyUrl") : t("chat.mediaCopy")} style={iconBtnStyle}>
            {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label={downloading ? t("chat.mediaDownloading") : t("chat.mediaSave")} withArrow>
        <ActionIcon variant={variant === "overlay" ? "transparent" : "subtle"} size="md" onClick={handleSave} aria-label={t("chat.mediaSave")} disabled={downloading} loading={downloading} style={iconBtnStyle}>
          <IconDownload size={18} />
        </ActionIcon>
      </Tooltip>
      {showPhotos && (
        <Tooltip label={t("chat.mediaSaveToPhotos")} withArrow>
          <ActionIcon variant={variant === "overlay" ? "transparent" : "subtle"} size="md" onClick={() => openAppWithAsset({ appId: "photos", kind, url, name: dlName })} aria-label={t("chat.mediaSaveToPhotos")} style={iconBtnStyle}>
            <IconPhotoPlus size={18} />
          </ActionIcon>
        </Tooltip>
      )}
      {showDesign && (
        <Tooltip label={t("chat.mediaEditDesign")} withArrow>
          <ActionIcon variant={variant === "overlay" ? "transparent" : "subtle"} size="md" onClick={() => openAppWithAsset({ appId: "design", kind, url, name: dlName })} aria-label={t("chat.mediaEditDesign")} style={iconBtnStyle}>
            <IconWand size={18} />
          </ActionIcon>
        </Tooltip>
      )}
      {showMovie && (
        <Tooltip label={editLoading ? t("chat.mediaDownloading") : t("chat.mediaEditVideo")} withArrow>
          <ActionIcon variant={variant === "overlay" ? "transparent" : "subtle"} size="md" onClick={handleEdit} aria-label={t("chat.mediaEditVideo")} disabled={editLoading} loading={editLoading} style={iconBtnStyle}>
            <IconMovie size={18} />
          </ActionIcon>
        </Tooltip>
      )}
      {showMail && (
        <Tooltip label={t("chat.mediaSendMail")} withArrow>
          <ActionIcon variant={variant === "overlay" ? "transparent" : "subtle"} size="md" onClick={() => openAppWithAsset({ appId: "mail", kind, url, name: dlName })} aria-label={t("chat.mediaSendMail")} style={iconBtnStyle}>
            <IconMail size={18} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
}

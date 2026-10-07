"use client";

import { useEffect } from "react";

// Bridges postMessage from the MyCrew host shell into the mymovie app.
// Sends app.ready so AppHostFrame delivers pending assets immediately.
// Converts asset.load → mymovie:asset-load custom event for EditorScreen to consume.
export default function HostBridge() {
  useEffect(() => {
    window.parent.postMessage({ source: "mycrew-mymovie", type: "app.ready" }, "*");

    const handler = (e: MessageEvent) => {
      if (e.data?.source !== "mycrew-host") return;
      if (e.data?.type === "asset.load") {
        const { kind, url, localFile } = (e.data?.payload ?? {}) as { kind?: string; url?: string; localFile?: boolean };
        if (kind === "video" && typeof url === "string" && url.length > 0) {
          window.dispatchEvent(new CustomEvent("mymovie:asset-load", { detail: { url, localFile: !!localFile } }));
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return null;
}

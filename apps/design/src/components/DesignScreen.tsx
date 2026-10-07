"use client";

import { useEffect, useState } from "react";
import { useDesign, makeShape } from "@/lib/store/designStore";
import { useI18n, type Locale } from "@/lib/i18n/I18nProvider";
import { postReadyToHost, subscribeHost } from "@/lib/host-bridge";
import Toolbar from "./Toolbar";
import LayersPanel from "./LayersPanel";
import Canvas from "./Canvas";
import PropertiesPanel from "./PropertiesPanel";
import DesignFab from "./DesignFab";

export default function DesignScreen() {
  const setPan = useDesign((s) => s.setPan);
  const { setLocale, t } = useI18n();
  const [locked, setLocked] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"layers" | "properties" | null>(null);

  // initial small offset so the artboard is not flush against the edges
  useEffect(() => {
    setPan({ x: 40, y: 40 });
  }, [setPan]);

  // Host (MyCrew) bridge — announce ready, listen for theme/locale/lock pushes.
  useEffect(() => {
    postReadyToHost();
    const off = subscribeHost({
      onLocale: (l) => {
        if (l === "ko" || l === "en" || l === "ja") setLocale(l as Locale);
      },
      onLock: (l) => setLocked(l),
      onAsset: (a) => {
        if (a.kind !== "image" || !a.url) return;
        const insert = (w: number, h: number) => {
          const st = useDesign.getState();
          const cx = st.doc.width / 2;
          const cy = st.doc.height / 2;
          st.addShape(
            makeShape("image", {
              x: Math.round(cx - w / 2),
              y: Math.round(cy - h / 2),
              width: w,
              height: h,
              href: a.url,
              name: a.name || "이미지",
            }),
          );
          st.setTool("select");
        };
        const img = new Image();
        img.onload = () => {
          const maxDim = 600;
          let w = img.naturalWidth || 400;
          let h = img.naturalHeight || 300;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          insert(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
        };
        img.onerror = () => insert(400, 300);
        img.src = a.url;
      },
    });
    return off;
  }, [setLocale]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) setMobilePanel(null);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#04070F",
        pointerEvents: locked ? "none" : "auto",
        opacity: locked ? 0.6 : 1,
      }}
    >
      <Toolbar />
      {isMobile && (
        <div
          style={{
            display: "flex",
            background: "#070D1A",
            borderBottom: "1px solid #1F293D",
            flex: "0 0 auto",
          }}
        >
          <button
            onClick={() => setMobilePanel(mobilePanel === "layers" ? null : "layers")}
            style={{
              flex: 1,
              minHeight: 44,
              background: mobilePanel === "layers" ? "#6366F1" : "transparent",
              color: mobilePanel === "layers" ? "#fff" : "#9DB7EB",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t("panel.layers")}
          </button>
          <button
            onClick={() => setMobilePanel(mobilePanel === "properties" ? null : "properties")}
            style={{
              flex: 1,
              minHeight: 44,
              background: mobilePanel === "properties" ? "#6366F1" : "transparent",
              color: mobilePanel === "properties" ? "#fff" : "#9DB7EB",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t("panel.properties")}
          </button>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        {!isMobile && <LayersPanel />}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <Canvas />
        </div>
        {!isMobile && <PropertiesPanel />}
        {isMobile && mobilePanel === "layers" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#070D1A",
              zIndex: 10,
              overflowY: "auto",
            }}
          >
            <LayersPanel />
          </div>
        )}
        {isMobile && mobilePanel === "properties" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#070D1A",
              zIndex: 10,
              overflowY: "auto",
            }}
          >
            <PropertiesPanel />
          </div>
        )}
      </div>
      <DesignFab />
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Box } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { TOOLS, getTool, type PdfTool } from "@/lib/stirling";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n/I18nProvider";
import PdfFab from "./PdfFab";
import ToolSidebar from "./ToolSidebar";
import PdfPreview from "./PdfPreview";
import ToolOptionsPanel from "./ToolOptionsPanel";

type StirlingStatus = "checking" | "online" | "offline";

function defaultParams(tool: PdfTool): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of tool.params) out[p.name] = p.def;
  return out;
}

export default function PdfScreen() {
  const { t } = useI18n();
  const [toolId, setToolId] = useState<string>(TOOLS[0].id);
  const tool = useMemo(() => getTool(toolId) ?? TOOLS[0], [toolId]);

  const [files, setFiles] = useState<File[]>([]);
  const [params, setParams] = useState<Record<string, string>>(() => defaultParams(tool));
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<StirlingStatus>("checking");

  // Page state lifted here so both PdfPreview and PageThumbnails share it
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // PDF helper drawer (triggered from sidebar bottom button)
  const [helperOpen, setHelperOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // probe Stirling backend on mount + every 20s
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const res = await fetch(apiUrl("/api/pdf/status"));
        const data = (await res.json()) as { online?: boolean };
        if (alive) setStatus(data.online ? "online" : "offline");
      } catch {
        if (alive) setStatus("offline");
      }
    };
    void probe();
    const id = setInterval(probe, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const label =
      status === "online"
        ? t("status.online")
        : status === "offline"
        ? t("status.offline")
        : t("status.checking");
    window.parent?.postMessage(
      { source: "mycrew-pdf", type: "pdf.status", payload: { status, label } },
      "*",
    );
  }, [status, t]);

  const selectTool = (id: string) => {
    const nextTool = getTool(id);
    if (!nextTool) return;
    setToolId(id);
    setParams(defaultParams(nextTool));
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
  };

  const resetParams = () => {
    setParams(defaultParams(tool));
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
  };

  const handleFiles = (newFiles: File[]) => {
    setFiles(newFiles);
    setCurrentPage(1);
    setNumPages(0);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
  };

  const handleParamChange = (name: string, value: string) => {
    setParams((s) => ({ ...s, [name]: value }));
  };

  const run = async () => {
    if (loading) return;
    if (files.length === 0) {
      notifications.show({ color: "yellow", message: t("hint.needFile") });
      return;
    }
    setLoading(true);
    if (resultUrl) { URL.revokeObjectURL(resultUrl); setResultUrl(null); }
    try {
      const form = new FormData();
      for (const f of files) form.append(tool.fileField, f);
      for (const p of tool.params) form.append(p.name, params[p.name] ?? p.def);

      const res = await fetch(apiUrl(`/api/pdf/${tool.endpoint}`), {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const err = (await res.json()) as { error?: string; detail?: string };
          if (err.error === "stirling_unreachable") detail = t("hint.stirlingDown");
          else detail = err.detail || err.error || detail;
        } catch { /* non-json */ }
        notifications.show({ color: "red", title: t("result.error"), message: detail });
        return;
      }

      const blob = await res.blob();
      setResultUrl(URL.createObjectURL(blob));
      notifications.show({ color: "jarvis", message: t("result.ready") });
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("result.error"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) { setSidebarOpen(false); setOptionsOpen(false); }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const selectToolAndClose = (id: string) => {
    selectTool(id);
    setSidebarOpen(false);
  };

  const previewFile =
    files.length > 0 && files[0].type === "application/pdf" ? files[0] : null;

  return (
    <Box style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#04070F" }}>
      {/* Mobile toggle bar */}
      {isMobile && (
        <div style={{ display: "flex", background: "#070D1A", borderBottom: "1px solid #1B2740", flex: "0 0 auto" }}>
          <button
            onClick={() => { setSidebarOpen((v) => !v); setOptionsOpen(false); }}
            style={{
              flex: 1,
              minHeight: 44,
              background: sidebarOpen ? "rgba(99, 102, 241,0.2)" : "transparent",
              color: sidebarOpen ? "#818CF8" : "#9DB7EB",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t("mobile.tools")}
          </button>
          <button
            onClick={() => { setOptionsOpen((v) => !v); setSidebarOpen(false); }}
            style={{
              flex: 1,
              minHeight: 44,
              background: optionsOpen ? "rgba(99, 102, 241,0.2)" : "transparent",
              color: optionsOpen ? "#818CF8" : "#9DB7EB",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t("mobile.options")}
          </button>
        </div>
      )}

      {/* Main area */}
      <Box style={{ flex: "1 1 auto", display: "flex", minHeight: 0, position: "relative" }}>
        {!isMobile && <ToolSidebar activeTool={toolId} onSelect={selectTool} onOpenHelper={() => setHelperOpen(true)} />}

        <PdfPreview
          file={previewFile}
          onFileSelect={handleFiles}
          acceptMultiple={tool.multiple}
          accept={tool.accept}
          pageNumber={currentPage}
          onPageChange={setCurrentPage}
          onNumPagesLoad={setNumPages}
          numPages={numPages}
        />

        {!isMobile && (
          <ToolOptionsPanel
            tool={tool}
            files={files}
            params={params}
            loading={loading}
            resultUrl={resultUrl}
            onFilesChange={handleFiles}
            onParamChange={handleParamChange}
            onReset={resetParams}
            onRun={() => void run()}
          />
        )}

        {/* Mobile: left sidebar overlay */}
        {isMobile && sidebarOpen && (
          <div
            style={{
              position: "absolute",
              inset: "0 auto 0 0",
              width: "70vw",
              background: "#070D1A",
              zIndex: 10,
              overflowY: "auto",
            }}
          >
            <ToolSidebar
              activeTool={toolId}
              onSelect={selectToolAndClose}
              onOpenHelper={() => { setHelperOpen(true); setSidebarOpen(false); }}
            />
          </div>
        )}

        {/* Mobile: bottom sheet for options */}
        {isMobile && optionsOpen && (
          <div
            style={{
              position: "absolute",
              inset: "auto 0 0 0",
              maxHeight: "70vh",
              background: "#070D1A",
              borderTop: "1px solid #1B2740",
              zIndex: 10,
              overflowY: "auto",
            }}
          >
            <ToolOptionsPanel
              tool={tool}
              files={files}
              params={params}
              loading={loading}
              resultUrl={resultUrl}
              onFilesChange={handleFiles}
              onParamChange={handleParamChange}
              onReset={resetParams}
              onRun={() => void run()}
            />
          </div>
        )}
      </Box>

      <PdfFab opened={helperOpen} onClose={() => setHelperOpen(false)} onPick={selectTool} file={previewFile} />
    </Box>
  );
}

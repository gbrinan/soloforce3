"use client";

import { useState, useEffect, useRef } from "react";
import { Box, Group, ActionIcon, Text, Stack, Center, Button, Tabs } from "@mantine/core";
import {
  IconChevronLeft,
  IconChevronRight,
  IconUpload,
  IconCopy,
  IconDownload,
  IconCheck,
  IconScan,
} from "@tabler/icons-react";
import PageThumbnails from "./PageThumbnails";
import PdfAiPanel from "./PdfAiPanel";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n/I18nProvider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Document: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Page: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjs: any = null;

interface PdfPreviewProps {
  file: File | null;
  onFileSelect: (files: File[]) => void;
  acceptMultiple: boolean;
  accept: string;
  pageNumber: number;
  onPageChange: (page: number) => void;
  onNumPagesLoad: (n: number) => void;
  numPages: number;
}

const THUMB_DEFAULT = 100;
const THUMB_MIN = 60;
const THUMB_MAX = 240;

// Minimum chars to consider pdfjs extraction successful (scanned PDFs return near-zero)
const OCR_FALLBACK_THRESHOLD = 50;

export default function PdfPreview({
  file,
  onFileSelect,
  acceptMultiple,
  accept,
  pageNumber,
  onPageChange,
  onNumPagesLoad,
  numPages,
}: PdfPreviewProps) {
  const { t } = useI18n();
  const [libReady, setLibReady] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(500);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [pageAspect, setPageAspect] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sizeMode, setSizeMode] = useState<"fit" | "original">("fit");

  const [activeTab, setActiveTab] = useState<"preview" | "text" | "ai">("preview");
  const [thumbAreaHeight, setThumbAreaHeight] = useState(THUMB_DEFAULT);
  const splitterDragging = useRef(false);
  const splitterStartY = useRef(0);
  const splitterStartH = useRef(0);

  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isOcrExtracting, setIsOcrExtracting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (Document && Page) { setLibReady(true); return; }
    import("react-pdf").then((mod) => {
      Document = mod.Document;
      Page = mod.Page;
      pdfjs = mod.pdfjs;
      pdfjs.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      setLibReady(true);
    });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerWidth(e.contentRect.width);
        setContainerHeight(e.contentRect.height);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [libReady, file]);

  useEffect(() => { setPageAspect(null); }, [file]);

  useEffect(() => {
    setExtractedText(null);
    setActiveTab("preview");
  }, [file]);

  const fitWidth = (() => {
    const availW = containerWidth > 0 ? containerWidth : 500;
    if (!pageAspect || containerHeight <= 0) return availW;
    return Math.min(availW, containerHeight / pageAspect);
  })();

  const prevPage = () => onPageChange(Math.max(1, pageNumber - 1));
  const nextPage = () => onPageChange(Math.min(numPages, pageNumber + 1));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === "application/pdf" || accept.includes(f.name.split(".").pop() || "")
    );
    if (dropped.length > 0) onFileSelect(acceptMultiple ? dropped : [dropped[0]]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length > 0) onFileSelect(picked);
  };

  /** Extract text from an ArrayBuffer using pdfjs. Returns null on failure. */
  const pdfjsExtract = async (data: ArrayBuffer): Promise<string | null> => {
    try {
      const doc = await pdfjs.getDocument({ data }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const content = await pg.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = content.items.map((item: any) => ("str" in item ? item.str : "")).join(" ");
        pages.push(`--- ${t("text.pageMarker").replace("{n}", String(i))} ---\n${text}`);
      }
      return pages.join("\n\n");
    } catch {
      return null;
    }
  };

  /** Call Stirling OCR endpoint, then extract text from the returned PDF. */
  const extractTextViaOcr = async (lang = "kor") => {
    if (!file || !pdfjs) return;
    setIsOcrExtracting(true);
    try {
      const form = new FormData();
      form.append("fileInput", file);
      form.append("languages", lang);
      const res = await fetch(apiUrl("/api/pdf/misc/ocr-pdf"), { method: "POST", body: form });
      if (!res.ok) {
        setExtractedText(t("text.ocrFailed").replace("{status}", String(res.status)));
        return;
      }
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const text = await pdfjsExtract(arrayBuffer);
      setExtractedText(text ?? t("text.ocrNoText"));
    } catch (e) {
      setExtractedText(t("text.ocrExtractFailed").replace("{err}", e instanceof Error ? e.message : String(e)));
    } finally {
      setIsOcrExtracting(false);
    }
  };

  /** Primary extraction: pdfjs first; auto-fallback to OCR if scanned PDF detected. */
  const extractText = async () => {
    if (!file || !pdfjs) return;
    setIsExtracting(true);
    let needsOcr = false;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const combined = await pdfjsExtract(arrayBuffer);
      if (!combined) {
        setExtractedText(t("text.extractFailed"));
        return;
      }
      // Strip page headers to measure actual content length (locale-agnostic)
      const textOnly = combined.replace(/--- .*? ---\n/g, "").trim();
      if (textOnly.length < OCR_FALLBACK_THRESHOLD) {
        // Likely a scanned PDF — trigger OCR fallback
        needsOcr = true;
        setExtractedText(null);
      } else {
        setExtractedText(combined);
      }
    } finally {
      setIsExtracting(false);
    }
    if (needsOcr) {
      await extractTextViaOcr();
    }
  };

  const handleCopy = async () => {
    if (!extractedText) return;
    await navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!extractedText || !file) return;
    const blob = new Blob([extractedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name.replace(/\.pdf$/i, "") + "_text.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const isBusy = isExtracting || isOcrExtracting;

  if (!file) {
    return (
      <Box
        ref={containerRef}
        style={{
          flex: "1 1 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#04070F",
          cursor: "pointer",
          border: isDragging ? "2px dashed #6366F1" : "2px dashed transparent",
          transition: "border-color 0.2s",
        }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={acceptMultiple}
          style={{ display: "none" }}
          onChange={handleFileInput}
        />
        <Stack align="center" gap="md">
          <Box
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "rgba(99,102,241,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconUpload size={36} color="#6366F1" />
          </Box>
          <Stack align="center" gap={4}>
            <Text size="lg" c="gray.2" fw={500}>{t("preview.dropTitle")}</Text>
            <Text size="sm" c="dimmed">{t("preview.dropHint")}</Text>
          </Stack>
        </Stack>
      </Box>
    );
  }

  if (!libReady) {
    return (
      <Box style={{ flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#04070F" }}>
        <Text c="dimmed">{t("preview.libLoading")}</Text>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      style={{
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        background: "#04070F",
        overflow: "hidden",
      }}
    >
      {/* Tab navigation */}
      <Box style={{ flexShrink: 0, borderBottom: "1px solid #1B2740" }}>
        <Tabs
          value={activeTab}
          onChange={(v) => {
            if (!v) return;
            const tab = v as "preview" | "text" | "ai";
            setActiveTab(tab);
            if (tab === "text" && extractedText === null && !isBusy) {
              void extractText();
            }
          }}
          styles={{ list: { borderBottomColor: "#1B2740" } }}
        >
          <Tabs.List>
            <Tabs.Tab value="preview">{t("tab.preview")}</Tabs.Tab>
            <Tabs.Tab value="text">{t("tab.text")}</Tabs.Tab>
            <Tabs.Tab value="ai">{t("tab.ai")}</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </Box>

      {/* ── Preview tab ─────────────────────────────── */}
      {activeTab === "preview" && (
        <>
          <Box
            ref={viewportRef}
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflow: "auto",
              display: "flex",
              alignItems: "safe center",
              justifyContent: "safe center",
              padding: "16px 16px 8px",
            }}
          >
            {Document && Page && (
              <Document
                file={file}
                onLoadSuccess={({ numPages: n }: { numPages: number }) => onNumPagesLoad(n)}
                loading={
                  <Center style={{ height: "100%" }}>
                    <Text c="dimmed">{t("preview.loading")}</Text>
                  </Center>
                }
                error={
                  <Center style={{ height: "100%" }}>
                    <Text c="red.4">{t("preview.error")}</Text>
                  </Center>
                }
              >
                {numPages > 0 && (
                  <Page
                    pageNumber={pageNumber}
                    {...(sizeMode === "original" ? { scale: 1 } : { width: fitWidth })}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onLoadSuccess={(page: any) => {
                      const vp = page.getViewport({ scale: 1 });
                      if (vp?.width > 0) setPageAspect(vp.height / vp.width);
                    }}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                )}
              </Document>
            )}
          </Box>

          {numPages > 0 && (
            <>
              {/* Page navigation */}
              <Box
                style={{
                  borderTop: "1px solid #1B2740",
                  flexShrink: 0,
                  padding: "6px 0",
                  background: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <Group justify="center" gap="sm">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    disabled={pageNumber <= 1}
                    onClick={prevPage}
                    aria-label={t("nav.prevPage")}
                  >
                    <IconChevronLeft size={16} />
                  </ActionIcon>
                  <Text size="sm" c="gray.3">
                    {pageNumber} / {numPages}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    disabled={pageNumber >= numPages}
                    onClick={nextPage}
                    aria-label={t("nav.nextPage")}
                  >
                    <IconChevronRight size={16} />
                  </ActionIcon>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => setSizeMode((m) => (m === "fit" ? "original" : "fit"))}
                  >
                    {sizeMode === "fit" ? t("view.originalSize") : t("view.fitScreen")}
                  </Button>
                </Group>
              </Box>

              {/* Splitter — drag up to expand thumbnail strip */}
              <Box
                style={{
                  height: 6,
                  flexShrink: 0,
                  cursor: "ns-resize",
                  background: "#070D1A",
                  borderTop: "1px solid #1F293D",
                  borderBottom: "1px solid #1F293D",
                  userSelect: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  splitterDragging.current = true;
                  splitterStartY.current = e.clientY;
                  splitterStartH.current = thumbAreaHeight;
                }}
                onPointerMove={(e) => {
                  if (!splitterDragging.current) return;
                  const delta = splitterStartY.current - e.clientY;
                  setThumbAreaHeight(
                    Math.max(THUMB_MIN, Math.min(THUMB_MAX, splitterStartH.current + delta))
                  );
                }}
                onPointerUp={() => { splitterDragging.current = false; }}
              >
                <Box style={{ width: 28, height: 2, background: "#7D8699", borderRadius: 1 }} />
              </Box>

              {/* Thumbnail strip */}
              <PageThumbnails
                file={file}
                numPages={numPages}
                currentPage={pageNumber}
                onPageClick={onPageChange}
                areaHeight={thumbAreaHeight}
              />
            </>
          )}
        </>
      )}

      {/* ── AI analysis tab ─────────────────────────── */}
      {activeTab === "ai" && (
        <PdfAiPanel file={file} pageNumber={pageNumber} onPageChange={onPageChange} />
      )}

      {/* ── Text tab ────────────────────────────────── */}
      {activeTab === "text" && (
        <Box style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Toolbar */}
          <Group px="md" py={6} gap="xs" style={{ borderBottom: "1px solid #1B2740", flexShrink: 0 }}>
            <Text size="xs" c="dimmed" style={{ flex: 1 }}>
              {isExtracting
                ? t("text.extracting")
                : isOcrExtracting
                ? t("text.ocrProcessing")
                : extractedText
                ? t("text.charCount").replace("{n}", extractedText.length.toLocaleString())
                : t("text.none")}
            </Text>
            {!isBusy && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => { setExtractedText(null); void extractText(); }}
              >
                {t("text.reExtract")}
              </Button>
            )}
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={isBusy}
              onClick={() => { setExtractedText(null); void extractTextViaOcr(); }}
              aria-label={t("text.ocrExtract")}
              title={t("text.ocrExtractTitle")}
            >
              <IconScan size={15} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color={copied ? "green" : "gray"}
              disabled={!extractedText || isBusy}
              onClick={() => void handleCopy()}
              aria-label={t("text.copy")}
              title={copied ? t("text.copied") : t("text.copy")}
            >
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={!extractedText || isBusy}
              onClick={handleDownload}
              aria-label={t("text.downloadTxt")}
              title={t("text.downloadTxt")}
            >
              <IconDownload size={15} />
            </ActionIcon>
          </Group>

          {/* Editable text area */}
          <Box style={{ flex: "1 1 auto", minHeight: 0 }}>
            <textarea
              value={extractedText ?? ""}
              placeholder={
                isExtracting
                  ? t("text.extracting")
                  : isOcrExtracting
                  ? t("text.ocrProcessingLong")
                  : t("text.empty")
              }
              onChange={(e) => setExtractedText(e.currentTarget.value)}
              style={{
                width: "100%",
                height: "100%",
                background: "#04070F",
                color: "#F8F8F8",
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 14,
                lineHeight: 1.6,
                border: "none",
                outline: "none",
                padding: "12px 16px",
                resize: "none",
                boxSizing: "border-box",
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

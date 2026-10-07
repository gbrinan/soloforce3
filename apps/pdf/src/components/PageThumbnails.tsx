"use client";

import { useEffect, useRef, useState } from "react";
import { Box } from "@mantine/core";
import { useI18n } from "@/lib/i18n/I18nProvider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DocComp: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PageComp: any = null;

interface PageThumbnailsProps {
  file: File | null;
  numPages: number;
  currentPage: number;
  onPageClick: (page: number) => void;
  areaHeight?: number;
}

export default function PageThumbnails({
  file,
  numPages,
  currentPage,
  onPageClick,
  areaHeight = 100,
}: PageThumbnailsProps) {
  const { t } = useI18n();
  const [libReady, setLibReady] = useState(false);
  const activeRef = useRef<HTMLDivElement>(null);

  const thumbH = Math.max(48, areaHeight - 20);

  useEffect(() => {
    if (DocComp && PageComp) { setLibReady(true); return; }
    import("react-pdf").then((mod) => {
      DocComp = mod.Document;
      PageComp = mod.Page;
      if (!mod.pdfjs.GlobalWorkerOptions.workerSrc) {
        mod.pdfjs.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${mod.pdfjs.version}/build/pdf.worker.min.mjs`;
      }
      setLibReady(true);
    });
  }, []);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentPage]);

  if (!file || !libReady || numPages === 0 || !DocComp || !PageComp) return null;

  const DC = DocComp;
  const PC = PageComp;
  const count = numPages;

  return (
    <Box
      style={{
        height: areaHeight,
        flexShrink: 0,
        background: "#070D1A",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        overflowX: "auto",
        scrollSnapType: "x mandatory",
      }}
    >
      {Array.from({ length: count }, (_, i) => i + 1).map((page) => (
        <Box
          key={page}
          ref={page === currentPage ? activeRef : undefined}
          onClick={() => onPageClick(page)}
          style={{
            flexShrink: 0,
            scrollSnapAlign: "start",
            cursor: "pointer",
            border: `2px solid ${page === currentPage ? "#6366F1" : "transparent"}`,
            borderRadius: 4,
            overflow: "hidden",
            transition: "border-color 0.15s",
            lineHeight: 0,
          }}
          title={t("thumb.page").replace("{n}", String(page))}
        >
          <DC file={file} loading={null} error={null}>
            <PC
              pageNumber={page}
              height={thumbH}
              renderAnnotationLayer={false}
              renderTextLayer={false}
            />
          </DC>
        </Box>
      ))}
    </Box>
  );
}

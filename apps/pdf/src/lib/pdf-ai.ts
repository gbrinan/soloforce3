// Client-side PDF helpers shared by PdfFab (Q&A) and PdfAiPanel (outline/table/fields).
// Reuses react-pdf's bundled pdfjs — same worker setup as PdfPreview.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("react-pdf").then((mod) => {
      const pdfjs = mod.pdfjs;
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      }
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Extract full document text with page markers ("--- 페이지 N ---"). */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const content = await pg.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = content.items.map((item: any) => ("str" in item ? item.str : "")).join(" ");
    pages.push(`--- 페이지 ${i} ---\n${text}`);
  }
  return pages.join("\n\n");
}

/** Render a single PDF page to a PNG blob (scale 2 for legible OCR input). */
export async function renderPdfPageToPng(file: File, pageNumber: number): Promise<Blob> {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
      "image/png",
    );
  });
}

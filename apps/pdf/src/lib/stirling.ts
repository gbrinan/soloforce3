// Stirling-PDF tool catalog — single source of truth for the MyPDF app.
// Each tool maps to a Stirling-PDF v1 REST endpoint. Endpoint paths and form
// field names follow Stirling-PDF v1 conventions; adjust here if the running
// Stirling version differs (no component code change needed).
//
// The browser never talks to Stirling directly. It POSTs multipart/form-data to
// the same-origin proxy `/api/pdf/<endpoint>`, which the Next route forwards to
// `${STIRLING_PDF_URL}/api/v1/<endpoint>` (default http://127.0.0.1:8080).

export type ParamType = "select" | "text" | "number";

export interface ToolParam {
  /** form field name sent to Stirling */
  name: string;
  /** i18n key for the field label */
  labelKey: string;
  type: ParamType;
  /** default value (string form) */
  def: string;
  /** for select: option values + i18n label keys */
  options?: { value: string; labelKey: string }[];
  min?: number;
  max?: number;
}

export interface PdfTool {
  id: string;
  /** Stirling v1 endpoint path, relative to /api/v1 (e.g. "general/merge-pdfs") */
  endpoint: string;
  /** i18n keys */
  labelKey: string;
  descKey: string;
  icon: string;
  /** multipart field name for the uploaded file(s) */
  fileField: string;
  /** allow multiple file selection */
  multiple: boolean;
  /** input accept attribute */
  accept: string;
  /** extra params rendered as form fields */
  params: ToolParam[];
  /** suggested output filename (extension hints the result kind) */
  outName: string;
}

export const STIRLING_API_PREFIX = "/api/v1";

export const TOOLS: PdfTool[] = [
  // ── General ──────────────────────────────────────────────────────────────
  {
    id: "merge",
    endpoint: "general/merge-pdfs",
    labelKey: "tool.merge",
    descKey: "tool.merge.desc",
    icon: "🔗",
    fileField: "fileInput",
    multiple: true,
    accept: "application/pdf",
    params: [],
    outName: "merged.pdf",
  },
  {
    id: "split",
    endpoint: "general/split-pages",
    labelKey: "tool.split",
    descKey: "tool.split.desc",
    icon: "✂️",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      { name: "pageNumbers", labelKey: "param.pageNumbers", type: "text", def: "1,2-4" },
    ],
    outName: "split.zip",
  },
  {
    id: "remove-pages",
    endpoint: "general/remove-pages",
    labelKey: "tool.removePages",
    descKey: "tool.removePages.desc",
    icon: "🗑️",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      { name: "pageNumbers", labelKey: "param.pageNumbers", type: "text", def: "1,3" },
    ],
    outName: "removed.pdf",
  },
  {
    id: "rotate",
    endpoint: "general/rotate-pdf",
    labelKey: "tool.rotate",
    descKey: "tool.rotate.desc",
    icon: "🔄",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      {
        name: "angle",
        labelKey: "param.angle",
        type: "select",
        def: "90",
        options: [
          { value: "90", labelKey: "param.angle.90" },
          { value: "180", labelKey: "param.angle.180" },
          { value: "270", labelKey: "param.angle.270" },
        ],
      },
    ],
    outName: "rotated.pdf",
  },
  {
    id: "compress",
    endpoint: "misc/compress-pdf",
    labelKey: "tool.compress",
    descKey: "tool.compress.desc",
    icon: "🗜️",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      {
        name: "optimizeLevel",
        labelKey: "param.optimizeLevel",
        type: "select",
        def: "5",
        options: [
          { value: "1", labelKey: "param.optimizeLevel.light" },
          { value: "5", labelKey: "param.optimizeLevel.medium" },
          { value: "9", labelKey: "param.optimizeLevel.strong" },
        ],
      },
    ],
    outName: "compressed.pdf",
  },
  {
    id: "flatten",
    endpoint: "misc/flatten",
    labelKey: "tool.flatten",
    descKey: "tool.flatten.desc",
    icon: "📋",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [],
    outName: "flattened.pdf",
  },
  {
    id: "repair",
    endpoint: "misc/repair",
    labelKey: "tool.repair",
    descKey: "tool.repair.desc",
    icon: "🔧",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [],
    outName: "repaired.pdf",
  },

  // ── Add Text / Overlay ────────────────────────────────────────────────────
  {
    id: "watermark",
    endpoint: "security/add-watermark",
    labelKey: "tool.watermark",
    descKey: "tool.watermark.desc",
    icon: "💧",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      { name: "watermarkText", labelKey: "param.watermarkText", type: "text", def: "CONFIDENTIAL" },
      { name: "fontSize", labelKey: "param.fontSize", type: "number", def: "30", min: 8, max: 200 },
      { name: "rotation", labelKey: "param.rotation", type: "number", def: "45", min: 0, max: 360 },
      { name: "opacity", labelKey: "param.opacity", type: "number", def: "30", min: 1, max: 100 },
    ],
    outName: "watermarked.pdf",
  },
  {
    id: "add-page-numbers",
    endpoint: "misc/add-page-numbers",
    labelKey: "tool.addPageNumbers",
    descKey: "tool.addPageNumbers.desc",
    icon: "🔢",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      {
        name: "position",
        labelKey: "param.pageNumPosition",
        type: "select",
        def: "bottom-center",
        options: [
          { value: "bottom-center", labelKey: "param.pageNumPosition.bottomCenter" },
          { value: "bottom-right", labelKey: "param.pageNumPosition.bottomRight" },
          { value: "bottom-left", labelKey: "param.pageNumPosition.bottomLeft" },
          { value: "top-center", labelKey: "param.pageNumPosition.topCenter" },
          { value: "top-right", labelKey: "param.pageNumPosition.topRight" },
          { value: "top-left", labelKey: "param.pageNumPosition.topLeft" },
        ],
      },
      { name: "fontSize", labelKey: "param.fontSize", type: "number", def: "12", min: 6, max: 72 },
      { name: "startingNumber", labelKey: "param.startingNumber", type: "number", def: "1", min: 0 },
    ],
    outName: "numbered.pdf",
  },

  // ── Security ──────────────────────────────────────────────────────────────
  {
    id: "add-password",
    endpoint: "security/add-password",
    labelKey: "tool.addPassword",
    descKey: "tool.addPassword.desc",
    icon: "🔒",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      { name: "password", labelKey: "param.password", type: "text", def: "" },
      { name: "ownerPassword", labelKey: "param.ownerPassword", type: "text", def: "" },
    ],
    outName: "protected.pdf",
  },
  {
    id: "remove-password",
    endpoint: "security/remove-password",
    labelKey: "tool.removePassword",
    descKey: "tool.removePassword.desc",
    icon: "🔓",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      { name: "password", labelKey: "param.password", type: "text", def: "" },
    ],
    outName: "unlocked.pdf",
  },

  // ── Misc ──────────────────────────────────────────────────────────────────
  {
    id: "ocr",
    endpoint: "misc/ocr-pdf",
    labelKey: "tool.ocr",
    descKey: "tool.ocr.desc",
    icon: "🔍",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      {
        name: "languages",
        labelKey: "param.ocrLang",
        type: "select",
        def: "kor",
        options: [
          { value: "kor", labelKey: "param.ocrLang.ko" },
          { value: "eng", labelKey: "param.ocrLang.en" },
          { value: "kor+eng", labelKey: "param.ocrLang.koEn" },
          { value: "jpn", labelKey: "param.ocrLang.ja" },
          { value: "chi_sim", labelKey: "param.ocrLang.zhCn" },
        ],
      },
    ],
    outName: "ocr.pdf",
  },
  {
    id: "extract-images",
    endpoint: "misc/extract-images",
    labelKey: "tool.extractImages",
    descKey: "tool.extractImages.desc",
    icon: "🖼️",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      {
        name: "format",
        labelKey: "param.imageFormat",
        type: "select",
        def: "png",
        options: [
          { value: "png", labelKey: "param.imageFormat.png" },
          { value: "jpg", labelKey: "param.imageFormat.jpg" },
        ],
      },
    ],
    outName: "images.zip",
  },

  // ── Convert ───────────────────────────────────────────────────────────────
  {
    id: "pdf-to-img",
    endpoint: "convert/pdf/img",
    labelKey: "tool.pdfToImg",
    descKey: "tool.pdfToImg.desc",
    icon: "📸",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [
      {
        name: "imageFormat",
        labelKey: "param.imageFormat",
        type: "select",
        def: "png",
        options: [
          { value: "png", labelKey: "param.imageFormat.png" },
          { value: "jpg", labelKey: "param.imageFormat.jpg" },
          { value: "webp", labelKey: "param.imageFormat.webp" },
        ],
      },
      {
        name: "singleOrMultiple",
        labelKey: "param.pageMode",
        type: "select",
        def: "multiple",
        options: [
          { value: "multiple", labelKey: "param.pageMode.multiple" },
          { value: "single", labelKey: "param.pageMode.single" },
        ],
      },
    ],
    outName: "images.zip",
  },
  {
    id: "img-to-pdf",
    endpoint: "convert/img/pdf",
    labelKey: "tool.imgToPdf",
    descKey: "tool.imgToPdf.desc",
    icon: "📑",
    fileField: "fileInput",
    multiple: true,
    accept: "image/*",
    params: [],
    outName: "converted.pdf",
  },
  {
    id: "pdf-to-word",
    endpoint: "convert/pdf/word",
    labelKey: "tool.pdfToWord",
    descKey: "tool.pdfToWord.desc",
    icon: "📝",
    fileField: "fileInput",
    multiple: false,
    accept: "application/pdf",
    params: [],
    outName: "converted.docx",
  },
  {
    id: "office-to-pdf",
    endpoint: "convert/file/pdf",
    labelKey: "tool.officeToPdf",
    descKey: "tool.officeToPdf.desc",
    icon: "📊",
    fileField: "fileInput",
    multiple: false,
    accept: ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp",
    params: [],
    outName: "converted.pdf",
  },
];

export function getTool(id: string): PdfTool | undefined {
  return TOOLS.find((t) => t.id === id);
}

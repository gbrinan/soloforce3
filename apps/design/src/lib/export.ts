import type { DesignDoc, Page, Shape } from "@/lib/design/types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shadowFilter(shape: Shape): string {
  if (!shape.shadow) return "";
  const { x, y, blur, color } = shape.shadow;
  const id = `shadow_${shape.id}`;
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${x}" dy="${y}" stdDeviation="${blur / 2}" flood-color="${esc(color)}" flood-opacity="0.8"/></filter>`;
}

function filterAttr(shape: Shape): string {
  if (!shape.shadow) return "";
  return ` filter="url(#shadow_${shape.id})"`;
}

function shapeToSvg(s: Shape): string {
  if (!s.visible) return "";
  if (s.type === "group") return ""; // children rendered individually
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  const rot = s.rotation ? ` transform="rotate(${s.rotation} ${cx} ${cy})"` : "";
  const op = s.opacity !== 1 ? ` opacity="${s.opacity}"` : "";
  const fill = s.fill === "none" ? "none" : s.fill;
  const stroke = s.stroke === "none" ? "" : ` stroke="${s.stroke}" stroke-width="${s.strokeWidth}"`;
  const filterDef = shadowFilter(s);
  const filter = filterAttr(s);
  const defs = filterDef ? `<defs>${filterDef}</defs>` : "";

  switch (s.type) {
    case "rect":
    case "frame":
      return `${defs}<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${s.radius || 0}" fill="${fill}"${stroke}${op}${rot}${filter}/>`;
    case "ellipse":
      return `${defs}<ellipse cx="${cx}" cy="${cy}" rx="${s.width / 2}" ry="${s.height / 2}" fill="${fill}"${stroke}${op}${rot}${filter}/>`;
    case "line":
      return `${defs}<line x1="${s.x}" y1="${s.y}" x2="${s.x2}" y2="${s.y2}" stroke="${s.stroke === "none" ? "#000" : s.stroke}" stroke-width="${s.strokeWidth || 2}" stroke-linecap="round"${op}${rot}${filter}/>`;
    case "text": {
      const anchor = s.align === "center" ? "middle" : s.align === "right" ? "end" : "start";
      const tx = s.align === "center" ? cx : s.align === "right" ? s.x + s.width : s.x;
      return `${defs}<text x="${tx}" y="${s.y + s.fontSize}" font-size="${s.fontSize}" font-family="${esc(s.fontFamily)}" font-weight="${s.fontWeight}" fill="${s.color}" text-anchor="${anchor}"${op}${rot}${filter}>${esc(s.text)}</text>`;
    }
    case "path":
      return `${defs}<g transform="translate(${s.x} ${s.y})"><path d="${esc(s.d)}" fill="${fill}"${stroke}${op}${filter}/></g>`;
    case "image":
      return `${defs}<image href="${esc(s.href)}" x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" preserveAspectRatio="xMidYMid slice"${op}${rot}${filter}/>`;
  }
}

export function docToSvg(doc: DesignDoc, page: Page): string {
  const body = page.shapes.map(shapeToSvg).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">
  <rect x="0" y="0" width="${doc.width}" height="${doc.height}" fill="#ffffff"/>
  ${body}
</svg>`;
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Same SVG string used by both download and handoff paths.
export function buildSvg(doc: DesignDoc, page: Page): string {
  return docToSvg(doc, page);
}

export function exportSvg(doc: DesignDoc, page: Page): void {
  const svg = buildSvg(doc, page);
  download(`${doc.name || "design"}.svg`, new Blob([svg], { type: "image/svg+xml" }));
}

export async function exportPdf(doc: DesignDoc, page: Page): Promise<void> {
  // jspdf · svg2pdf.js 는 클라이언트 전용. SSR 평가를 피하기 위해 dynamic import.
  // svg2pdf.js 는 jsPDF prototype 에 `.svg()` 를 부착하는 side-effect import 다.
  const jspdfMod = await import("jspdf");
  await import("svg2pdf.js");
  const JsPDFCtor =
    (jspdfMod as { jsPDF?: typeof import("jspdf").jsPDF }).jsPDF ??
    (jspdfMod as unknown as { default: typeof import("jspdf").jsPDF }).default;

  const svgStr = docToSvg(doc, page);
  const parser = new DOMParser();
  const svgEl = parser.parseFromString(svgStr, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;

  const pdf = new JsPDFCtor({
    orientation: doc.width >= doc.height ? "landscape" : "portrait",
    unit: "px",
    format: [doc.width, doc.height],
    hotfixes: ["px_scaling"],
  });
  // jsPDF + svg2pdf.js
  const pdfWithSvg = pdf as unknown as {
    svg: (
      el: SVGSVGElement,
      opts: { width: number; height: number; x?: number; y?: number },
    ) => Promise<void>;
  };
  await pdfWithSvg.svg(svgEl, { width: doc.width, height: doc.height });
  const blob = pdf.output("blob");
  download(`${doc.name || "design"}.pdf`, blob);
}

// Rasterize the active page to PNG and return a base64 data URL.
// Returns null if the 2D context cannot be acquired.
export async function buildPngDataUrl(doc: DesignDoc, page: Page, scale = 2): Promise<string | null> {
  const svg = docToSvg(doc, page);
  const img = new Image();
  const svgUrl =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("svg load failed"));
    img.src = svgUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = doc.width * scale;
  canvas.height = doc.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export async function exportPng(doc: DesignDoc, page: Page, scale = 2): Promise<void> {
  const dataUrl = await buildPngDataUrl(doc, page, scale);
  if (!dataUrl) return;
  // Convert data URL to Blob without an extra fetch round-trip.
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  download(`${doc.name || "design"}.png`, blob);
}

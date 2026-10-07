import { readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import ExcelJS from "exceljs";
import _PptxGenJS from "pptxgenjs";
const PptxGenJS = (_PptxGenJS as any).default || _PptxGenJS;

export interface FileEntry {
  name: string;
  relativePath: string;
  size: number;
  ext: string;
  mtime: string;
  /** 자료실 표시용 한글 제목 — md 파일의 첫 `# 제목` 추출. routes.ts /api/files에서 채움. */
  title?: string;
}

export interface XlsxSheet {
  sheetName: string;
  headers: string[];
  rows: (string | number)[][];
}

export interface PptxSlide {
  title: string;
  content: string;
}

export function listFiles(basePath: string): FileEntry[] {
  if (!existsSync(basePath)) return [];
  const results: FileEntry[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const st = statSync(full);
        results.push({
          name: entry.name,
          relativePath: relative(basePath, full),
          size: st.size,
          ext: extname(entry.name).slice(1).toLowerCase(),
          mtime: st.mtime.toISOString(),
        });
      }
    }
  }

  walk(basePath);
  return results;
}

export async function createXlsx(
  sheets: XlsxSheet[],
  outputPath: string,
): Promise<string> {
  const dir = join(outputPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.sheetName);
    ws.addRow(s.headers);
    for (const row of s.rows) {
      ws.addRow(row);
    }
  }
  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

export async function createPptx(
  title: string,
  slides: PptxSlide[],
  outputPath: string,
): Promise<string> {
  const dir = join(outputPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.title = title;

  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.5, y: 0.5, fontSize: 24, bold: true });
    slide.addText(s.content, { x: 0.5, y: 1.5, fontSize: 14 });
  }

  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

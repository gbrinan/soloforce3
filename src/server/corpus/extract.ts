import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { extname, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { CorpusChunk, CorpusFormat, CorpusProfile, SourceUnit } from '../../shared/corpus.js';
import { markdownSections, sourceUnit } from './source-reader.js';

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const PIPELINE_VERSION = 'corpus-2';
const MAX_TEXT = 2_000_000;
const MAX_CHUNKS = 10_000;
const extensions: Record<string, CorpusFormat> = {
  '.txt': 'text', '.md': 'markdown', '.csv': 'csv', '.tsv': 'csv', '.json': 'json',
  '.pdf': 'pdf', '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx', '.hwpx': 'hwpx',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.tiff': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video',
};

export class CorpusError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 502 | 503 = 422) { super(code); }
}
export function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }

export interface ExtractionOptions {
  maxSourceBytes?: number;
  maxExpandedBytes?: number;
  maxPdfPages?: number;
  startUnit?: number;
  unitLimit?: number;
  onUnit?: (unit: SourceUnit, ordinal: number) => void;
}
class ExtractionPaused extends Error {}

function safeZip(bytes: Buffer, maxExpandedBytes = 64 * 1024 * 1024): AdmZip {
  const zip = new AdmZip(bytes);
  const entries = zip.getEntries();
  if (entries.length > 5000 || entries.reduce((n, e) => n + e.header.size, 0) > maxExpandedBytes) {
    throw new CorpusError('archive_expansion_limit', 413);
  }
  return zip;
}

export function classify(name: string, mime: string, bytes: Buffer, options: ExtractionOptions = {}): CorpusProfile {
  if (bytes.length > (options.maxSourceBytes ?? MAX_SOURCE_BYTES)) throw new CorpusError('file_too_large', 413);
  const extension = extname(name).toLowerCase();
  const declared = extensions[extension] ?? 'unknown';
  let format: CorpusFormat = declared;
  const evidence = [`extension:${extension || '(none)'}`, `mime:${mime || 'unknown'}`];
  const warnings: string[] = [];
  const sig = bytes.subarray(0, 16);
  if (sig.subarray(0, 5).toString() === '%PDF-') { format = 'pdf'; evidence.push('signature:PDF'); }
  else if (sig.subarray(0, 2).toString() === 'PK') {
    try {
      const zip = safeZip(bytes, options.maxExpandedBytes);
      format = zip.getEntry('word/document.xml') ? 'docx'
        : zip.getEntry('xl/workbook.xml') ? 'xlsx'
        : zip.getEntry('ppt/presentation.xml') ? 'pptx'
        : zip.getEntry('Contents/content.hpf') ? 'hwpx' : 'unknown';
    } catch (error) {
      if (error instanceof CorpusError) throw error;
      format = 'unknown'; warnings.push('압축 구조가 손상되어 원본 확인이 필요합니다.');
    }
    evidence.push(`archive:${format}`);
  } else if (sig.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) || sig.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    format = 'image'; evidence.push('signature:image');
  } else if (['pdf', 'docx', 'xlsx', 'pptx', 'hwpx'].includes(declared)) {
    format = 'unknown'; warnings.push('파일 확장자와 실제 형식이 다릅니다.');
  } else if (format === 'unknown' && /^text\//.test(mime)) format = 'text';
  if (declared !== 'unknown' && declared !== format) warnings.push(`확장자 ${declared} 대신 실제 형식 ${format}으로 처리합니다.`);
  return { format, mime: mime || 'application/octet-stream', evidence, warnings, routes: [] };
}

export function chunkText(text: string, locator: string, kind: 'text' | 'table' = 'text', cells?: string[]): CorpusChunk[] {
  if (text.length > MAX_TEXT) throw new CorpusError('extracted_text_limit', 413);
  const out: CorpusChunk[] = [];
  // 1,200자 + 120자 겹침. 표는 행을 먼저 분리한 뒤 긴 행만 추가 분할한다.
  for (let start = 0; start < text.length; start += 1080) {
    const part = text.slice(start, start + 1200).trim();
    if (part) out.push({ id: hash(`${locator}:${start}:${part}`).slice(0, 24), kind, locator: `${locator} · ${start + 1}자`, text: part, ...(cells ? { cells } : {}) });
    if (start + 1200 >= text.length) break;
  }
  return out;
}

// RFC 4180: 인용부호, 셀 내부 쉼표/개행, 이중 따옴표를 보존한다.
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false; let closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (c === delimiter) { row.push(value); value = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = ''; closed = false;
    } else { if (closed) throw new CorpusError('invalid_csv'); value += c; }
    if (rows.length > MAX_CHUNKS || row.length > 1000) throw new CorpusError('table_limit', 413);
  }
  if (quoted) throw new CorpusError('unclosed_csv_quote');
  if (value || row.length || closed) { row.push(value); rows.push(row); }
  return rows;
}

function decode(bytes: Buffer): string {
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    if (text.includes('\0')) throw new Error('binary');
    if (text.length > MAX_TEXT) throw new CorpusError('extracted_text_limit', 413);
    return text;
  } catch (e) { if (e instanceof CorpusError) throw e; throw new CorpusError('unsupported_text_encoding'); }
}

function xmlText(xml: string): string {
  // No XML entity expansion or fetching; Office/HWPX text-bearing tags only.
  return [...xml.matchAll(/<(?:w:t|a:t|hp:t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|a:t|hp:t)>/g)]
    .map(m => m[1].replace(/&#(x[0-9a-f]+|\d+);|&(lt|gt|amp|quot|apos);/gi, (_, n: string, entity: string) => {
      if (n) { const cp = n[0] === 'x' ? parseInt(n.slice(1), 16) : Number(n); return cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; }
      return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[entity] ?? '';
    })).join(' ');
}

export async function extract(name: string, mime: string, bytes: Buffer, labels: string[] = [], options: ExtractionOptions = {}): Promise<{ profile: CorpusProfile; chunks: CorpusChunk[]; units: SourceUnit[]; progress: { cursor: number; complete: boolean } }> {
  const profile = classify(name, mime, bytes, options);
  const chunks: CorpusChunk[] = [];
  const units: SourceUnit[] = [];
  let seen = 0; let cursor = options.startUnit ?? 0; let complete = true;
  const add = (text: string, locator: string, kind: 'text' | 'table' = 'text', cells?: string[], headingPath: string[] = [], contextStatus?: SourceUnit['contextStatus']) => {
    if (!text.trim()) return;
    if (seen++ < (options.startUnit ?? 0)) return;
    if (units.length >= (options.unitLimit ?? Number.MAX_SAFE_INTEGER)) throw new ExtractionPaused();
    const unit = sourceUnit(text, locator, kind, cells, headingPath, contextStatus);
    const derived = chunkText(text, locator, kind).map(chunk => ({ ...chunk, unitId: unit.id }));
    chunks.push(...derived);
    if (chunks.length > MAX_CHUNKS) throw new CorpusError('chunk_limit', 413);
    units.push(unit); cursor = seen;
    options.onUnit?.(unit, cursor);
  };
  const table = (rows: string[][], locator: string) => {
    const header = rows[0]?.join(' | ') ?? '';
    rows.forEach((cells, index) => add(`${index ? `열: ${header}\n` : ''}${cells.join(' | ')}`, `${locator} 행 ${index + 1}`, 'table', cells));
  };
  try {
    switch (profile.format) {
      case 'csv': table(parseDelimited(decode(bytes), extname(name).toLowerCase() === '.tsv' ? '\t' : ','), 'CSV'); break;
      case 'json': {
        const value: unknown = JSON.parse(decode(bytes));
        if (Array.isArray(value) && value.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
          const keys = [...new Set(value.flatMap(row => Object.keys(row)))];
          table([keys, ...value.map(row => keys.map(key => JSON.stringify(row[key]) ?? ''))], 'JSON');
        } else add(JSON.stringify(value, null, 2), 'JSON');
        break;
      }
      case 'text': case 'markdown': {
        const text = decode(bytes);
        for (const section of markdownSections(text)) add(section.text, `본문 ${section.line}행`, 'text', undefined, section.headingPath, 'section');
        // 혼합 문서: 본문 색인과 별도로 Markdown 표의 행/열을 유지한다.
        const blocks = text.match(/(?:^\s*\|.+\|\s*\r?\n){2,}/gm) ?? [];
        for (const [i, block] of blocks.entries()) {
          table(block.trim().split('\n').filter(line => !/^\s*\|[\s:|\-]+\|\s*$/.test(line)).map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim())), `Markdown 표 ${i + 1}`);
        }
        break;
      }
      case 'xlsx': {
        safeZip(bytes, options.maxExpandedBytes);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
        let cellCount = 0;
        for (const sheet of workbook.worksheets) {
          let header = '';
          sheet.eachRow((row, rowNumber) => {
            const cells: string[] = [];
            row.eachCell({ includeEmpty: true }, (cell) => {
              if (++cellCount > 100_000) throw new CorpusError('table_limit', 413);
              const formula = cell.type === ExcelJS.ValueType.Formula ? ` [formula=${cell.formula}; cached=${JSON.stringify(cell.result) ?? 'unknown'}]` : '';
              cells.push(`${cell.text}${formula}${cell.numFmt ? ` [format=${cell.numFmt}]` : ''}`);
            });
            if (!header) header = cells.join(' | ');
            add(`열: ${header}\n${cells.join(' | ')}`, `${sheet.name}!행${rowNumber}`, 'table', cells);
          });
        }
        profile.warnings.push('수식은 재계산하지 않습니다. 저장된 결과와 표시 형식을 함께 보존합니다.');
        break;
      }
      case 'docx': case 'pptx': case 'hwpx': {
        const zip = safeZip(bytes, options.maxExpandedBytes);
        const media = zip.getEntries().filter(entry => /(?:^|\/)(?:media|BinData)\//i.test(entry.entryName) && !entry.isDirectory).length;
        if (media) profile.routes.push({ route: 'ocr', status: 'needs_tool', detail: `삽입 매체 ${media}개는 원본에 보존했습니다. 내용 판독은 별도 처리입니다.` });
        const pattern = profile.format === 'docx' ? /^word\/document.xml$/ : profile.format === 'pptx' ? /^ppt\/slides\/slide\d+.xml$/ : /^Contents\/section\d+.xml$/;
        for (const entry of zip.getEntries().filter(e => pattern.test(e.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }))) {
          const xml = entry.getData().toString('utf8');
          const body = xml.replace(/<(?:w:tbl|a:tbl|hp:tbl)(?:\s[^>]*)?>[\s\S]*?<\/(?:w:tbl|a:tbl|hp:tbl)>/g, '');
          if (profile.format === 'docx') {
            let paragraphs: string[] = []; let headings: string[] = []; let first = 1;
            const flush = () => { add(paragraphs.join('\n'), `${entry.entryName} 문단${first}`, 'text', undefined, [...headings], 'section'); paragraphs = []; };
            [...body.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].forEach((p, i) => {
              const text = xmlText(p[0]); const style = p[0].match(/<w:pStyle\b[^>]*w:val="(?:Heading|heading|제목)\s*([1-6])"/);
              if (style) { flush(); headings = headings.slice(0, Number(style[1]) - 1); headings[Number(style[1]) - 1] = text; first = i + 1; }
              paragraphs.push(text);
            });
            flush();
          } else add(xmlText(body), entry.entryName, 'text', undefined, [], profile.format === 'pptx' ? 'page' : 'section');
          const tables = [...xml.matchAll(/<(?:w:tbl|a:tbl|hp:tbl)(?:\s[^>]*)?>[\s\S]*?<\/(?:w:tbl|a:tbl|hp:tbl)>/g)];
          tables.forEach((match, i) => {
            const rows = [...match[0].matchAll(/<(?:w:tr|a:tr|hp:tr)(?:\s[^>]*)?>[\s\S]*?<\/(?:w:tr|a:tr|hp:tr)>/g)].map(r =>
              [...r[0].matchAll(/<(?:w:tc|a:tc|hp:tc)(?:\s[^>]*)?>[\s\S]*?<\/(?:w:tc|a:tc|hp:tc)>/g)].map(c => xmlText(c[0])));
            table(rows, `${entry.entryName} 표${i + 1}`);
          });
        }
        profile.warnings.push('본문과 단순 표를 추출했습니다. 도형·각주·병합 셀·삽입 이미지의 원본 배치는 백업 파일에서 확인하세요.');
        break;
      }
      case 'pdf': {
        const [major, minor] = process.versions.node.split('.').map(Number);
        if (major < 22 || (major === 22 && minor < 13)) throw new CorpusError('pdf_requires_node_22_13_or_newer');
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const assets = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
        const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false,
          standardFontDataUrl: join(assets, 'standard_fonts') + '/', cMapUrl: join(assets, 'cmaps') + '/', cMapPacked: true });
        try {
          const document = await task.promise;
          if (document.numPages > (options.maxPdfPages ?? 300)) throw new CorpusError('pdf_page_limit', 413);
          let missing = 0;
          for (let n = 1; n <= document.numPages; n++) {
            const page = await document.getPage(n);
            const content = await page.getTextContent();
            const text = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('');
            if (text.trim().length < 10) missing++;
            add(text, `PDF ${n}쪽`, 'text', undefined, [], 'page'); page.cleanup();
          }
          if (missing) profile.routes.push({ route: 'ocr', status: 'needs_tool', detail: `${missing}쪽에 추출 가능한 텍스트가 부족합니다.` });
          profile.warnings.push('PDF 표의 셀 경계는 확정하지 않습니다. 숫자와 표 구조는 원본 대조가 필요합니다.');
        } finally { await task.destroy(); }
        break;
      }
      case 'image': profile.routes.push({ route: 'ocr', status: 'needs_tool', detail: 'OCR 도구 연결 필요. 원본 보존 완료.' }); break;
      case 'audio': case 'video': profile.routes.push({ route: 'transcription', status: 'needs_tool', detail: '전사 도구 연결 필요. 원본 보존 완료.' }); break;
      default: profile.routes.push({ route: 'review', status: 'needs_review', detail: '지원하지 않는 형식입니다. 변환한 파일을 다시 등록하세요.' });
    }
  } catch (error) {
    if (error instanceof ExtractionPaused) { complete = false; }
    else {
    if (error instanceof CorpusError && error.status === 413) throw error;
    chunks.length = 0;
    units.length = 0;
    profile.routes.push({ route: 'review', status: 'needs_review', detail: error instanceof CorpusError ? error.code : '파싱 실패 또는 암호화된 문서입니다.' });
    if (options.onUnit) throw error; // The worker must not finalize a partially failed parse.
    }
  }
  if (chunks.some(c => c.kind === 'text')) profile.routes.push({ route: 'text', status: 'ready', detail: '원문 위치를 포함한 본문 검색' });
  if (chunks.some(c => c.kind === 'table')) profile.routes.push({ route: 'table', status: 'ready', detail: '행·열 및 원래 값 보존' });
  if (labels.length && chunks.length) profile.routes.push({ route: 'graph', status: 'ready', detail: '사용자가 지정한 업무 분류로 자료 간 연결' });
  if (!chunks.length && !profile.routes.length) profile.routes.push({ route: 'review', status: 'needs_review', detail: '추출된 내용이 없습니다.' });
  if (chunks.reduce((n, c) => n + c.text.length, 0) > MAX_TEXT * 2) throw new CorpusError('extracted_text_limit', 413);
  return { profile, chunks, units, progress: { cursor, complete } };
}

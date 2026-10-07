// OCR batch → document (PDF/Markdown/TXT) generator + external library uploader.
// Reuses processOcr/getOcr cache, writes to OS tmpdir for download,
// and copies the result into the host MyCrew "external-reports" library.
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { createWriteStream, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { processOcr, getOcr } from './ocr.mjs';

// External library = MyCrew host external-reports directory.
const EXTERNAL_REPORTS_DIR = join(homedir(), 'mycrew-system', 'history', 'external-reports');

// macOS Korean font candidates (PDF needs an embedded TTF for Hangul).
const KOREAN_FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/AppleSDGothicNeo.ttc',
  '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
  '/Library/Fonts/AppleSDGothicNeo.ttc',
  '/System/Library/Fonts/AppleSDGothicNeo.ttc',
  '/System/Library/Fonts/NotoSansKR-Regular.otf',
];

function findKoreanFont() {
  for (const p of KOREAN_FONT_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

function safeFileName(name) {
  return String(name || 'OCR-Document')
    .replace(/[^a-zA-Z0-9가-힣._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'OCR-Document';
}

function randomId() {
  return randomBytes(4).toString('hex');
}

function pad2(n) { return String(n).padStart(2, '0'); }
function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

// Run OCR over N photos. Reuses cached results; runs tesseract for misses.
export async function processBatchOcr(rootDir, photoIds, onProgress) {
  const results = [];
  for (let i = 0; i < photoIds.length; i++) {
    const sha = photoIds[i];
    let entry = getOcr(sha);
    if (!entry || !entry.text) {
      try {
        const r = await processOcr(rootDir, sha);
        entry = { text: r.text, confidence: r.confidence, language: r.language, processedAt: r.processedAt };
      } catch (e) {
        entry = { text: '', confidence: 0, language: 'unknown', error: e.message };
      }
    }
    results.push({ sha256: sha, ...entry });
    if (onProgress) {
      try { onProgress({ done: i + 1, total: photoIds.length, sha }); } catch (_) {}
    }
  }
  return results;
}

export function generateMarkdown(items, title) {
  const t = title || `OCR 문서화 ${nowStamp()}`;
  let md = `# ${t}\n\n`;
  md += `_생성: ${new Date().toLocaleString('ko-KR')} · 자산 ${items.length}건_\n\n`;
  items.forEach((it, idx) => {
    md += `## ${idx + 1}. ${it.sha256.slice(0, 12)}…\n\n`;
    if (it.error) {
      md += `> ⚠️ OCR 실패: ${it.error}\n\n`;
    } else {
      md += '```\n' + (it.text || '(인식된 텍스트 없음)') + '\n```\n\n';
      md += `_신뢰도: ${Math.round((it.confidence || 0) * 100)}% · 언어: ${it.language || '-'}_\n\n`;
    }
  });
  return md;
}

export function generateTxt(items, title) {
  const t = title || `OCR 문서화 ${nowStamp()}`;
  let txt = `${t}\n${'='.repeat(Math.min(t.length, 60))}\n\n`;
  items.forEach((it, idx) => {
    txt += `[${idx + 1}] ${it.sha256.slice(0, 12)}\n`;
    if (it.error) txt += `! 실패: ${it.error}\n`;
    else txt += (it.text || '(텍스트 없음)') + '\n';
    txt += '\n---\n\n';
  });
  return txt;
}

export function generatePdf(items, title, outPath) {
  return new Promise((resolve, reject) => {
    const t = title || `OCR 문서화 ${nowStamp()}`;
    const fontPath = findKoreanFont();
    const doc = new PDFDocument({ margin: 50, size: 'A4', info: { Title: t } });
    const stream = createWriteStream(outPath);
    doc.pipe(stream);

    if (fontPath) {
      try {
        if (fontPath.endsWith('.ttc')) {
          // AppleSDGothicNeo.ttc → first member name
          doc.registerFont('kr', fontPath, 'AppleSDGothicNeo-Regular');
        } else {
          doc.registerFont('kr', fontPath);
        }
        doc.font('kr');
      } catch (e) {
        console.warn('[ocr-document] Korean font registration failed, fallback to default:', e.message);
      }
    }

    doc.fontSize(18).text(t, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`생성: ${new Date().toLocaleString('ko-KR')} · 자산 ${items.length}건`);
    doc.moveDown(1);

    items.forEach((it, idx) => {
      if (idx > 0) doc.addPage();
      doc.fontSize(13).text(`${idx + 1}. ${it.sha256.slice(0, 16)}…`);
      doc.moveDown(0.3);
      if (it.error) {
        doc.fontSize(11).fillColor('#aa0000').text(`OCR 실패: ${it.error}`);
        doc.fillColor('#000000');
      } else {
        doc.fontSize(11).text(it.text || '(인식된 텍스트 없음)', { paragraphGap: 4 });
        doc.moveDown(0.4);
        doc.fontSize(9).fillColor('#888888')
          .text(`신뢰도 ${Math.round((it.confidence || 0) * 100)}% · 언어 ${it.language || '-'}`);
        doc.fillColor('#000000');
      }
    });

    doc.end();
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

// Heuristic key:value extraction from a single OCR text block.
// Matches lines like "총액: 12,000원" / "Total: $5.99" / "상호 : ABC마트" (Korean colon ：도 허용).
// Returns Map<key, value>. Keys are trimmed and length-capped to avoid noise.
function extractReceiptFields(text) {
  const out = new Map();
  if (!text) return out;
  const lines = String(text).split(/\r?\n/);
  const re = /^\s*([^\s:：][^:：]{0,28})\s*[:：]\s*(.+?)\s*$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    // skip pure number-only keys / URL fragments / overly long values
    if (!key || /^\d+$/.test(key) || /^https?$/i.test(key)) continue;
    if (val.length > 200) continue;
    if (!out.has(key)) out.set(key, val);
  }
  return out;
}

// Build xlsx with union-of-keys header across all OCR items.
export async function generateXlsx(items, title, outPath) {
  const t = title || `OCR 문서화 ${nowStamp()}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MyCrew Photos';
  wb.created = new Date();
  const ws = wb.addWorksheet('OCR');

  // Pre-pass: collect union of extracted keys across items, preserve first-seen order.
  const keyOrder = [];
  const keySet = new Set();
  const perItemFields = items.map((it) => {
    const fields = it.error ? new Map() : extractReceiptFields(it.text);
    for (const k of fields.keys()) {
      if (!keySet.has(k)) { keySet.add(k); keyOrder.push(k); }
    }
    return fields;
  });

  const baseCols = ['#', 'sha256', 'confidence', 'language', 'text', 'error'];
  const headers = baseCols.concat(keyOrder);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  perItemFields.forEach((fields, idx) => {
    const it = items[idx];
    const row = [
      idx + 1,
      it.sha256 ? String(it.sha256).slice(0, 16) : '',
      it.confidence != null ? Math.round((it.confidence || 0) * 100) / 100 : '',
      it.language || '',
      it.error ? '' : (it.text || ''),
      it.error || '',
    ];
    for (const k of keyOrder) row.push(fields.get(k) || '');
    ws.addRow(row);
  });

  // Modest column widths.
  ws.columns.forEach((col, i) => {
    if (i === 0) col.width = 4;
    else if (i === 1) col.width = 18;
    else if (i === 4) col.width = 60;
    else col.width = 18;
  });

  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// Copy generated file into MyCrew host library using its naming convention.
async function notifyHostNewFile(base, fileName) {
  const HOST_URL = process.env.MYCREW_HOST_URL || 'http://127.0.0.1:3456';
  const TOKEN = process.env.MYCREW_PHOTOS_WEBHOOK_TOKEN || '';
  
  if (!TOKEN) {
    console.warn('[ocr-document] MYCREW_PHOTOS_WEBHOOK_TOKEN not set, skipping host notification');
    return;
  }
  
  try {
    const res = await fetch(`${HOST_URL}/api/files/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Photos-Token': TOKEN,
      },
      body: JSON.stringify({ base, fileName }),
    });
    
    if (!res.ok) {
      if (res.status === 404) {
        console.warn('[ocr-document] host endpoint /api/files/notify not implemented (404) — files will only appear after manual refresh');
      } else {
        const text = await res.text().catch(() => '');
        console.error('[ocr-document] host notification failed:', res.status, text);
      }
    }
  } catch (e) {
    console.error('[ocr-document] host notification network error:', e.message);
  }
}

export function uploadToExternalLibrary(srcPath, displayName) {
  if (!existsSync(EXTERNAL_REPORTS_DIR)) {
    mkdirSync(EXTERNAL_REPORTS_DIR, { recursive: true });
  }
  const safe = safeFileName(displayName);
  const id = randomId();
  const destName = `upload_${id}_${safe}`;
  const destPath = join(EXTERNAL_REPORTS_DIR, destName);
  const buf = readFileSync(srcPath);
  writeFileSync(destPath, buf);
  
  // Notify host via webhook
  notifyHostNewFile('reports', destName).catch((e) => {
    console.warn('[ocr-document] host notification failed:', e.message);
  });
  
  return { libraryPath: destPath, libraryFileName: destName, libraryBase: 'reports' };
}

// Full pipeline: batch OCR → format → temp file → external library copy.
export async function batchOcrToDocument({ rootDir, photoIds, format, title }) {
  const items = await processBatchOcr(rootDir, photoIds);
  const stamp = nowStamp();
  const baseTitle = safeFileName(title || `OCR_${stamp}`);

  const tmpDir = join(tmpdir(), 'mycrew-ocr-docs');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const fmt = String(format || 'pdf').toLowerCase();
  let outPath, mimeType, ext;
  const finalName = `${baseTitle}_${stamp}`;

  if (fmt === 'pdf') {
    outPath = join(tmpDir, `${finalName}.pdf`);
    await generatePdf(items, title || baseTitle, outPath);
    mimeType = 'application/pdf';
    ext = 'pdf';
  } else if (fmt === 'md' || fmt === 'markdown') {
    outPath = join(tmpDir, `${finalName}.md`);
    writeFileSync(outPath, generateMarkdown(items, title || baseTitle), 'utf-8');
    mimeType = 'text/markdown';
    ext = 'md';
  } else if (fmt === 'xlsx' || fmt === 'excel') {
    outPath = join(tmpDir, `${finalName}.xlsx`);
    await generateXlsx(items, title || baseTitle, outPath);
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    ext = 'xlsx';
  } else {
    outPath = join(tmpDir, `${finalName}.txt`);
    writeFileSync(outPath, generateTxt(items, title || baseTitle), 'utf-8');
    mimeType = 'text/plain';
    ext = 'txt';
  }

  const downloadFileName = `${finalName}.${ext}`;
  let libraryResult = null;
  try {
    libraryResult = uploadToExternalLibrary(outPath, downloadFileName);
  } catch (e) {
    console.warn('[ocr-document] external library copy failed:', e.message);
    libraryResult = { error: e.message };
  }

  return {
    tempPath: outPath,
    downloadFileName,
    mimeType,
    itemsCount: items.length,
    failedCount: items.filter((i) => i.error).length,
    library: libraryResult,
  };
}

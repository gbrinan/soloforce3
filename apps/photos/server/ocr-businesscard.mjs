// Business card OCR module — extracts contact info from PaddleOCR (PP-OCRv4) text.
// Engine swap: tesseract.js -> @gutenye/ocr-node (onnxruntime-node, no Python).
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { originalStreamPath } from './library.mjs';
import { upsertBusinessCard, setAssetCategory, getAsset, markBusinessCardSynced, getDb } from './db.mjs';
import { paddleRecognize } from './ocr-paddle.mjs';

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

// Decode HEIC/HEIF buffer to JPEG buffer so tesseract can ingest it.
export async function decodeHeicToJpegBuffer(filePath) {
  const heicConvert = (await import('heic-convert')).default;
  const input = readFileSync(filePath);
  const output = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.92 });
  return Buffer.from(output);
}



// Regex patterns for Korean business cards
const PHONE_REGEX = /(?:\+?82[- ]?|0)1[0-9][- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const COMPANY_REGEX = /주식회사|㈜|㈲|Inc\.|Co\.,?\s*Ltd|Corporation|Corp\.|LLC/;
const POSITION_REGEX = /대표|이사|팀장|부장|과장|차장|매니저|CEO|CTO|CMO|CFO|COO|Director|Manager/;
const DEPARTMENT_REGEX = /개발|마케팅|영업|기획|디자인|R&D|Sales|Engineering|인사|총무|재무|법무/;

export function parseBusinessCardText(rawText) {
  const text = rawText || '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  // Extract phones
  const phones = [];
  const phoneMatches = text.matchAll(PHONE_REGEX);
  for (const match of phoneMatches) {
    const normalized = match[0].replace(/[- ]/g, '');
    if (!phones.includes(normalized)) phones.push(normalized);
  }
  
  // Extract emails
  const emails = [];
  const emailMatches = text.matchAll(EMAIL_REGEX);
  for (const match of emailMatches) {
    const lower = match[0].toLowerCase();
    if (!emails.includes(lower)) emails.push(lower);
  }
  
  // Extract company
  let company = null;
  for (const line of lines) {
    if (COMPANY_REGEX.test(line)) {
      company = line;
      break;
    }
  }
  
  // Extract position
  let position = null;
  for (const line of lines) {
    if (POSITION_REGEX.test(line)) {
      const match = line.match(POSITION_REGEX);
      if (match) {
        position = match[0];
        break;
      }
    }
  }
  
  // Extract department
  let department = null;
  for (const line of lines) {
    if (DEPARTMENT_REGEX.test(line)) {
      const match = line.match(DEPARTMENT_REGEX);
      if (match) {
        department = match[0];
        break;
      }
    }
  }
  
  // Extract name (heuristic: first 2-4 char Korean or 2-10 char English, excluding company/phone/email lines)
  let name = null;
  // Collect both normalized values AND original matched strings to prevent false name extraction
  const phoneOriginals = [];
  const phoneMatchesForExcl = text.matchAll(PHONE_REGEX);
  for (const match of phoneMatchesForExcl) {
    phoneOriginals.push(match[0]); // original "010-1234-5678"
  }
  const emailOriginals = [];
  const emailMatchesForExcl = text.matchAll(EMAIL_REGEX);
  for (const match of emailMatchesForExcl) {
    emailOriginals.push(match[0]);
  }
  
  const nameLineExclusions = [
    ...phones,           // normalized: "01012345678"
    ...phoneOriginals,   // original: "010-1234-5678"
    ...emails,
    ...emailOriginals,
    company || '',
    position || '',
    department || '',
  ].filter(Boolean);
  // Normalized exclusions (whitespace + hyphen stripped) to catch OCR variants
  // like "010 - 1234 - 5678" where neither raw nor normalized phone literally
  // appears in the line via String.includes.
  const normalizeForCompare = (s) => String(s).replace(/[\s-]/g, '');
  const nameLineExclusionsNorm = nameLineExclusions.map(normalizeForCompare).filter(Boolean);

  for (const line of lines) {
    if (nameLineExclusions.some(excl => line.includes(excl))) continue;
    const lineNorm = normalizeForCompare(line);
    if (lineNorm && nameLineExclusionsNorm.some(excl => lineNorm.includes(excl))) continue;
    if (PHONE_REGEX.test(line) || EMAIL_REGEX.test(line)) continue;
    
    // Korean name: 2-4 chars
    const korMatch = line.match(/^([가-힣]{2,4})$/);
    if (korMatch) {
      name = korMatch[1];
      break;
    }
    
    // English name: 2-10 chars
    const engMatch = line.match(/^([a-zA-Z]{2,10})$/);
    if (engMatch) {
      name = engMatch[1];
      break;
    }
  }
  
  return {
    name,
    phones,
    emails,
    company,
    department,
    position,
  };
}

export function isBusinessCardCandidate(text) {
  const phones = text.match(PHONE_REGEX) || [];
  const emails = text.match(EMAIL_REGEX) || [];
  const hasCompany = COMPANY_REGEX.test(text);
  const hasPosition = POSITION_REGEX.test(text);
  const hasDepartment = DEPARTMENT_REGEX.test(text);
  
  const matches = [
    phones.length > 0,
    emails.length > 0,
    hasCompany,
    hasPosition,
    hasDepartment,
  ].filter(Boolean).length;
  
  return matches >= 2;
}

export async function runBusinessCardOcr(rootDir, sha, filepath = null) {
  const path = filepath || originalStreamPath(rootDir, sha);
  if (!path || !existsSync(path)) {
    throw new Error('Photo file not found');
  }
  
  const asset = getAsset(sha);
  // PaddleOCR needs a file path on disk; if input is HEIC, decode to a temp JPEG first.
  let recognizePath = path;
  let tmpJpeg = null;
  if (asset && HEIC_MIMES.has(asset.mime)) {
    const jpegBuf = await decodeHeicToJpegBuffer(path);
    tmpJpeg = join(tmpdir(), `bc-ocr-${Date.now()}-${String(sha).slice(0, 8)}.jpg`);
    writeFileSync(tmpJpeg, jpegBuf);
    recognizePath = tmpJpeg;
  }

  let rawText, confidence;
  try {
    const result = await paddleRecognize(recognizePath);
    rawText = result.text.trim();
    confidence = result.confidence;
  } finally {
    if (tmpJpeg) { try { unlinkSync(tmpJpeg); } catch {} }
  }
  
  const parsed = parseBusinessCardText(rawText);
  parsed.rawText = rawText;
  parsed.confidence = confidence;
  
  upsertBusinessCard(sha, parsed);
  setAssetCategory(sha, 'businesscard');
  
  return { sha, parsed };
}

export async function syncToHost(sha) {
  const bc = getDb().prepare('SELECT * FROM business_cards WHERE sha = ?').get(sha);
  if (!bc) throw new Error('Business card not found');
  
  const webhookToken = process.env.MYCREW_PHOTOS_WEBHOOK_TOKEN || '';
  if (!webhookToken) {
    // Explicit failure-visibility log so background callers in ocr.mjs
    // (which only .catch() rejections) still surface the skipped-sync state.
    console.warn('[bc-ocr] sync skipped: MYCREW_PHOTOS_WEBHOOK_TOKEN not set (sha=' + String(sha).slice(0, 8) + ')');
    return { ok: false, reason: 'no-token', message: 'MYCREW_PHOTOS_WEBHOOK_TOKEN environment variable not set' };
  }
  
  const phones = bc.phones ? JSON.parse(bc.phones) : [];
  const emails = bc.emails ? JSON.parse(bc.emails) : [];
  
  const body = {
    name: bc.name || '',
    phone: phones[0] || '',
    email: emails[0] || '',
    company: bc.company || '',
    department: bc.department || '',
    position: bc.position || '',
    sourcePhotoSha: sha,
    ocrConfidence: bc.confidence || 0,
    memo: `OCR 자동 추출 (명함) - ${new Date().toISOString()}`,
  };
  
  try {
    const HOST_URL = process.env.MYCREW_HOST_URL || 'http://127.0.0.1:3456';
    const res = await fetch(`${HOST_URL}/api/contacts/from-businesscard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Photos-Token': webhookToken,
      },
      body: JSON.stringify(body),
    });
    
    if (res.ok) {
      markBusinessCardSynced(sha);
      return { ok: true };
    } else {
      const text = await res.text().catch(() => '');
      if (res.status === 404) {
        console.error('[bc-ocr] sync failed: host endpoint /api/contacts/from-businesscard not implemented (404) — contact cards will not sync to host');
      } else {
        console.error('[bc-ocr] sync failed:', res.status, text);
      }
      return { ok: false, reason: 'http-error', status: res.status };
    }
  } catch (e) {
    console.error('[bc-ocr] sync failed:', e.message);
    return { ok: false, reason: 'network-error', error: e.message };
  }
}



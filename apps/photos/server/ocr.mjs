// OCR module — PaddleOCR (onnxruntime-node) for document text; tesseract.js retained for Korean license plates.
import { createWorker } from 'tesseract.js';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { originalStreamPath } from './library.mjs';
import { insertOcrResult, getOcrResult, getDb, setAssetCategory, getAsset } from './db.mjs';
import { isBusinessCardCandidate, runBusinessCardOcr, syncToHost, decodeHeicToJpegBuffer } from './ocr-businesscard.mjs';
import { paddleRecognize } from './ocr-paddle.mjs';

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

let plateWorker = null;
let busRef = null;

// Inject bus instance for category-change broadcasts. Called once at server boot.
export function setOcrBus(bus) { busRef = bus; }

// Plate recognition still uses tesseract because PP-OCRv4 ch model can't read Hangul.
async function initPlateWorker() {
  if (plateWorker) return plateWorker;
  plateWorker = await createWorker('eng+kor', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        console.log(`[ocr] plate ${m.status}: ${Math.round(m.progress * 100)}%`);
      }
    },
  });
  return plateWorker;
}

export async function processOcr(rootDir, photoId) {
  const path = originalStreamPath(rootDir, photoId);
  if (!path || !existsSync(path)) {
    throw new Error('Photo file not found');
  }

  // HEIC/HEIF: decode to JPEG file before feeding paddle (sharp/onnx can't read HEIC).
  const asset = getAsset(photoId);
  let recognizePath = path;
  let tmpJpeg = null;
  if (asset && HEIC_MIMES.has(asset.mime)) {
    const jpegBuf = await decodeHeicToJpegBuffer(path);
    tmpJpeg = join(tmpdir(), `ocr-${Date.now()}-${String(photoId).slice(0, 8)}.jpg`);
    writeFileSync(tmpJpeg, jpegBuf);
    recognizePath = tmpJpeg;
  }

  let text, confidence;
  try {
    const result = await paddleRecognize(recognizePath);
    text = result.text.trim();
    confidence = result.confidence;
  } finally {
    if (tmpJpeg) { try { unlinkSync(tmpJpeg); } catch {} }
  }
  const language = 'paddle-ocrv4-ch';

  insertOcrResult(photoId, text, confidence, language);

  // Phase 8: Check if this is a business card candidate
  if (isBusinessCardCandidate(text)) {
    // Trigger business card OCR in background (don't await — fire and forget)
    runBusinessCardOcr(rootDir, photoId)
      .then(result => {
        console.log(`[ocr] business card detected: ${photoId.slice(0, 8)}`);
        // Check autoAdd setting
        const settingsPath = join(rootDir, 'data', 'businesscard-settings.json');
        let autoAdd = true;
        try {
          if (existsSync(settingsPath)) {
            const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
            autoAdd = settings.autoAdd !== false;
          }
        } catch {}
        
        if (autoAdd) {
          syncToHost(photoId).catch(e => {
            console.error(`[ocr] business card sync failed: ${photoId.slice(0, 8)}`, e.message);
          });
        }
      })
      .catch(e => {
        console.error(`[ocr] business card OCR failed: ${photoId.slice(0, 8)}`, e.message);
      });
  }

  return { text, confidence, language, processedAt: Date.now() };
}

// Auto-classify a photo as 'document' when OCR yields enough confident text.
// Idempotent: reuses cached photo_ocr row if present; skips non-image / non-photo assets.
// Threshold tuned to avoid false positives from product labels / signs in regular photos.
// Confidence floor 0.30 fits Korean tesseract realistic range (text length is the primary gate).
const DOC_TEXT_THRESHOLD = 80;     // non-whitespace chars
const DOC_MIN_CONFIDENCE = 0.30;
const SUPPORTED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export async function runOcrAndClassify(rootDir, photoId) {
  const asset = getAsset(photoId);
  if (!asset) return { skipped: 'not-found' };
  if (asset.media_type && asset.media_type !== 'image') return { skipped: 'not-image' };
  if (!SUPPORTED_MIMES.has(asset.mime)) return { skipped: 'unsupported-mime' };
  if (asset.category && asset.category !== 'photo') return { skipped: 'already-classified' };

  let text, confidence;
  const cached = getOcrResult(photoId);
  if (cached) {
    text = cached.text || '';
    confidence = cached.confidence ?? 0;
  } else {
    try {
      const r = await processOcr(rootDir, photoId);
      text = r.text || '';
      confidence = r.confidence ?? 0;
    } catch (e) {
      return { skipped: 'ocr-failed', error: e.message };
    }
  }

  const trimmedLen = String(text).replace(/\s+/g, '').length;
  if (trimmedLen < DOC_TEXT_THRESHOLD || confidence < DOC_MIN_CONFIDENCE) {
    return { classified: false, textLen: trimmedLen, confidence };
  }
  const updated = setAssetCategory(photoId, 'document');
  if (updated && busRef && typeof busRef.broadcast === 'function') {
    try {
      busRef.broadcast({ type: 'library.updated', payload: { sha: photoId, field: 'category', value: 'document' } });
    } catch {}
  }
  return { classified: true, textLen: trimmedLen, confidence };
}

export function getOcr(photoId) {
  const result = getOcrResult(photoId);
  if (!result) return null;
  return {
    text: result.text,
    confidence: result.confidence,
    language: result.language,
    processedAt: result.processed_at,
  };
}

// Phase 5C: Korean license plate OCR
const PLATE_REGEX = /(\d{2,3})([가-힣])(\d{4})/;

export async function processPlateOcr(rootDir, photoId) {
  const path = originalStreamPath(rootDir, photoId);
  if (!path || !existsSync(path)) {
    throw new Error('Photo file not found');
  }

  const w = await initPlateWorker();
  const { data } = await w.recognize(path);

  const text = data.text.trim();
  const match = text.match(PLATE_REGEX);

  if (!match) {
    throw new Error('No Korean license plate detected');
  }

  const plateNumber = match[0]; // e.g., "12가3456"
  const confidence = data.confidence / 100;
  const language = 'kor';

  // Insert with kind='plate'
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO photo_ocr (photo_id, text, confidence, language, kind, processed_at)
    VALUES (?, ?, ?, ?, 'plate', ?)
  `).run(photoId, plateNumber, confidence, language, now);

  return { plateNumber, confidence, processedAt: now };
}

export function getPlates(photoId) {
  const result = getDb().prepare(`
    SELECT * FROM photo_ocr
    WHERE photo_id = ? AND kind = 'plate'
    ORDER BY processed_at DESC LIMIT 1
  `).get(photoId);
  
  if (!result) return null;
  return {
    plateNumber: result.text,
    confidence: result.confidence,
    processedAt: result.processed_at,
  };
}

process.on('exit', async () => {
  if (plateWorker) await plateWorker.terminate();
});

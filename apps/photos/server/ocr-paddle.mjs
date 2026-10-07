// PaddleOCR (PP-OCRv4) recognition via @gutenye/ocr-node (onnxruntime-node, no Python).
// Replaces the previous tesseract.js worker on OCR call-sites. HEIC handling is
// kept by the callers (decodeHeicToJpegBuffer) — this helper only takes a path
// to an image already in a format sharp/onnx can decode (jpg/png/webp).
import Ocr from '@gutenye/ocr-node';

let ocr = null;
let ocrInit = null;

async function getOcr() {
  if (ocr) return ocr;
  if (!ocrInit) {
    ocrInit = Ocr.create().then((o) => { ocr = o; return o; }).finally(() => { ocrInit = null; });
  }
  return ocrInit;
}

// Shape mirrors tesseract.recognize() result we relied on:
//   { text: string, confidence: number (0..1), lines: [{ text, score }] }
export async function paddleRecognize(path) {
  const o = await getOcr();
  const lines = await o.detect(path);
  const text = lines.map((l) => l.text).join('\n');
  const scores = lines.map((l) => l.score).filter((s) => typeof s === 'number' && Number.isFinite(s));
  const confidence = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.85;
  return { text, confidence, lines };
}

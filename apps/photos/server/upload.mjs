// Multipart upload handler — saves each file to a tmp path, then delegates to library.ingestFile.
import { mkdirSync, createWriteStream, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { importUpload } from './library.mjs';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB per request

function tmpFor(name) {
  const dir = join(tmpdir(), 'mycrew-photos-upload');
  mkdirSync(dir, { recursive: true });
  const rand = randomBytes(8).toString('hex');
  return join(dir, `${Date.now()}-${rand}-${name}`);
}

// Hono parseBody returns object — for multiple files Hono uses key + '[]'
// or single key holds File[]. We support both shapes.
export async function handleUpload(c, rootDir) {
  const body = await c.req.parseBody({ all: true });
  const collected = [];
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      for (const v of value) collected.push({ key, file: v });
    } else {
      collected.push({ key, file: value });
    }
  }

  const results = [];
  const errors = [];
  let totalBytes = 0;

  for (const { file } of collected) {
    if (!file || typeof file === 'string') continue;
    if (!(file instanceof File || typeof file.arrayBuffer === 'function')) continue;
    const name = file.name || 'upload.bin';
    const size = file.size || 0;
    if (size > MAX_FILE_BYTES) {
      errors.push({ filename: name, error: `file exceeds ${MAX_FILE_BYTES} bytes` });
      continue;
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      errors.push({ filename: name, error: 'request exceeds 500MB total' });
      break;
    }
    const tmpPath = tmpFor(name);
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      await new Promise((resolveP, rejectP) => {
        const ws = createWriteStream(tmpPath);
        ws.on('finish', resolveP);
        ws.on('error', rejectP);
        ws.end(buf);
      });
      const r = await importUpload(rootDir, { tmpPath, filename: name });
      results.push(r);
    } catch (e) {
      errors.push({ filename: name, error: e.message });
    } finally {
      try { unlinkSync(tmpPath); } catch {}
    }
  }

  return { imported: results, errors };
}

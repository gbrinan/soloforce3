// Library scanner — folder walk, EXIF extract, thumbnail generation, dedupe.
// All operations are local; zero external API calls.
import { promises as fsp, createReadStream, mkdirSync, statSync, existsSync, linkSync, copyFileSync } from 'node:fs';
import { join, extname, basename, resolve, sep, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { insertAsset, findBySha, getAsset } from './db.mjs';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);
const MEDIA_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT]);
const HEIC_EXT = new Set(['.heic', '.heif']);
const THUMB_SIZE = 320;

function mimeFromExt(ext) {
  const e = ext.toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  if (e === '.heic') return 'image/heic';
  if (e === '.heif') return 'image/heif';
  if (e === '.avif') return 'image/avif';
  if (e === '.mp4' || e === '.m4v') return 'video/mp4';
  if (e === '.mov') return 'video/quicktime';
  if (e === '.avi') return 'video/x-msvideo';
  if (e === '.mkv') return 'video/x-matroska';
  if (e === '.webm') return 'video/webm';
  return 'application/octet-stream';
}

function mediaTypeFromExt(ext) {
  const e = ext.toLowerCase();
  return VIDEO_EXT.has(e) ? 'video' : 'image';
}

// Expand ~ and ensure path is under user home (anti-traversal).
export function safeResolvePath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('path must be a non-empty string');
  }
  let p = input.trim();
  if (p.startsWith('~/') || p === '~') p = join(homedir(), p.slice(1) || '');
  p = resolve(normalize(p));
  const home = resolve(homedir());
  const allowedRoots = [home, '/Users', '/Volumes'];
  if (!allowedRoots.some((root) => p === root || p.startsWith(root + sep))) {
    throw new Error(`path not allowed (must be under home or /Users or /Volumes): ${p}`);
  }
  // Block obvious system areas
  const blocked = ['/System', '/Library/Caches', '/private/var'];
  if (blocked.some((b) => p.startsWith(b + sep) || p === b)) {
    throw new Error(`path is in a blocked system area: ${p}`);
  }
  return p;
}

async function sha256File(filePath) {
  return new Promise((resolveP, rejectP) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', rejectP);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveP(hash.digest('hex')));
  });
}

async function* walkFiles(rootDir, recursive) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue; // skip dotfiles
    const full = join(rootDir, ent.name);
    if (ent.isSymbolicLink()) continue; // dereference disabled
    if (ent.isDirectory()) {
      if (recursive) yield* walkFiles(full, true);
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = extname(ent.name).toLowerCase();
    if (!MEDIA_EXT.has(ext)) continue;
    yield full;
  }
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function originalsPathFor(rootDir, sha, ext) {
  return join(rootDir, 'data', 'originals', sha.slice(0, 2), sha + ext);
}

function thumbPathFor(rootDir, sha) {
  return join(rootDir, 'data', 'thumbs', sha + '.webp');
}

// Hard-link with copy fallback (cross-device or unsupported FS).
function linkOrCopy(src, dst) {
  ensureDir(join(dst, '..'));
  try {
    linkSync(src, dst);
    return 'link';
  } catch (e) {
    if (e.code === 'EEXIST') return 'exists';
    try {
      copyFileSync(src, dst);
      return 'copy';
    } catch (e2) {
      throw e2;
    }
  }
}

async function extractExif(filePath) {
  try {
    const exifr = (await import('exifr')).default;
    const data = await exifr.parse(filePath, {
      tiff: true, exif: true, gps: true,
      iptc: false, xmp: false, icc: false,
    });
    if (!data) return null;
    const takenAt = data.DateTimeOriginal || data.CreateDate || data.ModifyDate || null;
    return {
      takenAt: takenAt ? new Date(takenAt).getTime() : null,
      gpsLat: typeof data.latitude === 'number' ? data.latitude : null,
      gpsLng: typeof data.longitude === 'number' ? data.longitude : null,
      make: data.Make || null,
      camera: [data.Make, data.Model].filter(Boolean).join(' ') || null,
    };
  } catch {
    return null;
  }
}

// Phase 7: classify an asset as 'photo' | 'screenshot' | 'document'
// Filename hints take priority; otherwise fall back to mime + EXIF Make + aspect-ratio.
function classifyCategory({ filename, mime, exif, width, height }) {
  const name = String(filename || '');
  if (/^(Screen ?[Ss]hot|screencapture|스크린샷|Capture)/.test(name)) return 'screenshot';
  if (/^(Scan|Document|Doc_|Receipt|문서|영수증)/i.test(name) || /_receipt|_scan/i.test(name)) return 'document';
  const hasCamera = !!(exif && exif.make);
  // PNG without EXIF camera Make → likely a phone/desktop screen capture.
  if (mime === 'image/png' && !hasCamera) return 'screenshot';
  // Aspect-ratio heuristic for camera-less captures at modest resolution
  // (catches IMG_*.jpeg-style mobile screenshots that PNG filter misses).
  if (!hasCamera && Number.isFinite(width) && Number.isFinite(height) && height > 0 && width < 1920) {
    const ar = width / height;
    if (ar < 0.56 || ar > 1.85) return 'screenshot';
  }
  return 'photo';
}

async function extractVideoMetadata(filePath) {
  try {
    const ffmpeg = (await import('fluent-ffmpeg')).default;
    
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        
        const videoStream = metadata.streams?.find(s => s.codec_type === 'video');
        if (!videoStream) return resolve({ width: null, height: null, duration: null, codec: null });
        
        resolve({
          width: videoStream.width || null,
          height: videoStream.height || null,
          duration: metadata.format?.duration || null,
          codec: videoStream.codec_name || null,
        });
      });
    });
  } catch (e) {
    return { width: null, height: null, duration: null, codec: null, error: e.message };
  }
}

async function generateVideoThumbnail(filePath, thumbPath) {
  try {
    const ffmpeg = (await import('fluent-ffmpeg')).default;
    ensureDir(join(thumbPath, '..'));
    
    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .screenshots({
          timestamps: ['00:00:01.000'],
          filename: 'temp.jpg',
          folder: join(thumbPath, '..'),
          size: `${THUMB_SIZE}x?`
        })
        .on('end', async () => {
          try {
            const tempJpg = join(thumbPath, '..', 'temp.jpg');
            const sharpMod = await import('sharp');
            const sharp = sharpMod.default;
            await sharp(tempJpg)
              .resize({ width: THUMB_SIZE, withoutEnlargement: true })
              .webp({ quality: 78 })
              .toFile(thumbPath);
            await fsp.unlink(tempJpg);
            resolve(true);
          } catch (e) {
            reject(e);
          }
        })
        .on('error', reject);
    });
  } catch (e) {
    return false;
  }
}

async function extractDimsAndThumb(filePath, thumbPath, ext) {
  let sourceBuffer = null;

  // HEIC/HEIF → JPEG 변환
  if (HEIC_EXT.has(ext)) {
    try {
      const heicConvert = (await import('heic-convert')).default;
      const inputBuffer = await fsp.readFile(filePath);
      const outputBuffer = await heicConvert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.92
      });
      sourceBuffer = Buffer.from(outputBuffer);
    } catch (e) {
      return { width: null, height: null, thumbGenerated: false, error: `HEIC decode failed: ${e.message}` };
    }
  }

  try {
    const sharpMod = await import('sharp');
    const sharp = sharpMod.default;
    const img = sourceBuffer ? sharp(sourceBuffer, { failOn: 'none' }) : sharp(filePath, { failOn: 'none' });
    const meta = await img.metadata();
    ensureDir(join(thumbPath, '..'));
    await img.rotate().resize({ width: THUMB_SIZE, withoutEnlargement: true })
      .webp({ quality: 78 }).toFile(thumbPath);
    return {
      width: meta.width || null,
      height: meta.height || null,
      thumbGenerated: true,
    };
  } catch (e) {
    return { width: null, height: null, thumbGenerated: false, error: e.message };
  }
}

// Process a single file → DB row + originals link + thumb.
// Returns { status: 'imported'|'skipped'|'error', sha?, error? }
export async function ingestFile(rootDir, filePath, { source, sourceRoot }) {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return { status: 'skipped', reason: 'not a file' };
    const ext = extname(filePath).toLowerCase();
    if (!MEDIA_EXT.has(ext)) return { status: 'skipped', reason: 'unsupported ext' };
    const sha = await sha256File(filePath);
    if (findBySha(sha)) return { status: 'skipped', sha, reason: 'duplicate' };

    const origDst = originalsPathFor(rootDir, sha, ext);
    if (!existsSync(origDst)) linkOrCopy(filePath, origDst);
    
    const mediaType = mediaTypeFromExt(ext);
    let width = null, height = null, duration = null, codec = null;
    const thumbDst = thumbPathFor(rootDir, sha);
    let thumbGenerated = false;
    
    if (mediaType === 'video') {
      // Video processing
      const videoMeta = await extractVideoMetadata(filePath);
      width = videoMeta.width;
      height = videoMeta.height;
      duration = videoMeta.duration;
      codec = videoMeta.codec;
      
      thumbGenerated = await generateVideoThumbnail(filePath, thumbDst);
    } else {
      // Image processing (existing logic)
      const result = await extractDimsAndThumb(filePath, thumbDst, ext);
      width = result.width;
      height = result.height;
      thumbGenerated = result.thumbGenerated;
    }
    
    const exif = mediaType === 'image' ? await extractExif(filePath) : null;
    const takenAt = (exif && exif.takenAt) || st.mtimeMs || Date.now();
    const fname = basename(filePath);
    const mime = mimeFromExt(ext);
    const category = mediaType === 'image'
      ? classifyCategory({ filename: fname, mime, exif, width, height })
      : 'photo';

    insertAsset({
      sha256: sha,
      original_path: filePath,
      filename: fname,
      mime,
      size: st.size,
      width,
      height,
      taken_at: Math.floor(takenAt),
      imported_at: Date.now(),
      source,
      source_root: sourceRoot || null,
      gps_lat: exif?.gpsLat ?? null,
      gps_lng: exif?.gpsLng ?? null,
      camera: exif?.camera ?? null,
      media_type: mediaType,
      duration_sec: duration,
      video_codec: codec,
      category,
    });
    // Auto-OCR for photos classified as 'photo' (camera-taken documents, etc.).
    // Fire-and-forget — tesseract worker is a singleton and serializes naturally.
    if (
      category === 'photo'
      && mediaType === 'image'
      && (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp'
          || mime === 'image/heic' || mime === 'image/heif')
    ) {
      setImmediate(() => {
        import('./ocr.mjs')
          .then((m) => m.runOcrAndClassify(rootDir, sha))
          .catch((e) => console.error('[ocr-auto]', sha.slice(0, 8), e?.message || e));
      });
    }
    // Auto CLIP embedding for semantic search (Phase 5A) — fire-and-forget,
    // same pattern as auto-OCR. Model is a lazy singleton in semantic.mjs.
    if (mediaType === 'image') {
      setImmediate(() => {
        import('./semantic.mjs')
          .then((m) => m.embedPhoto(sha))
          .catch((e) => console.error('[embed-auto]', sha.slice(0, 8), e?.message || e));
      });
    }
    return { status: 'imported', sha, thumbGenerated };
  } catch (e) {
    return { status: 'error', error: e.message, file: filePath };
  }
}

// Walk a folder and ingest. Returns aggregate counts + sample errors.
export async function importFolder(rootDir, { path, recursive }) {
  const folder = safeResolvePath(path);
  const st = statSync(folder);
  if (!st.isDirectory()) throw new Error(`not a directory: ${folder}`);
  let imported = 0;
  let skipped = 0;
  const errors = [];
  for await (const file of walkFiles(folder, recursive !== false)) {
    const r = await ingestFile(rootDir, file, { source: 'folder', sourceRoot: folder });
    if (r.status === 'imported') imported += 1;
    else if (r.status === 'skipped') skipped += 1;
    else errors.push({ file: r.file || file, error: r.error });
  }
  return { folder, imported, skipped, errors: errors.slice(0, 20), errorCount: errors.length };
}

export async function importUpload(rootDir, { tmpPath, filename }) {
  return ingestFile(rootDir, tmpPath, {
    source: 'upload',
    sourceRoot: null,
  }).then((r) => ({ ...r, filename }));
}

export function thumbStreamPath(rootDir, sha) {
  return thumbPathFor(rootDir, sha);
}

export function originalStreamPath(rootDir, sha) {
  const a = getAsset(sha);
  if (!a) return null;
  const ext = extname(a.original_path).toLowerCase();
  return originalsPathFor(rootDir, sha, ext);
}

// Phase 3B: full EXIF data export
export async function getExifData(filePath) {
  try {
    const exifr = (await import('exifr')).default;
    const data = await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: false,
      icc: false,
    });
    
    if (!data) return {};
    
    // Convert to camelCase
    const camelCase = {};
    for (const [key, value] of Object.entries(data)) {
      const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
      camelCase[camelKey] = value;
    }
    
    return camelCase;
  } catch (e) {
    throw new Error(`EXIF parse failed: ${e.message}`);
  }
}

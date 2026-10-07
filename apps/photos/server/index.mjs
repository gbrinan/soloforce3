// MyCrew photos app server — independent module (zero host import).
// HTTP: 127.0.0.1:13201 | WebSocket: path=/bus (paired with host)
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from './bus.mjs';
import { openDb, getDb, listTimeline, stats, getAsset, searchAssets, toggleFavorite, toggleArchive, trashAsset, restoreAsset, deleteAssetPermanently, listAssetsByFilter, getCounts, getMemoriesToday, getPhotosWithGeo, createAlbum, listAlbums, getAlbum, updateAlbum, deleteAlbum, addPhotosToAlbum, removePhotosFromAlbum, listWatchedFolders, addWatchedFolder, removeWatchedFolder, toggleWatchedFolder, getPhotoTags, addPhotoTag, removePhotoTag, getAllTags, updatePhotoRating, createShareLink, getShareLink, deleteShareLink, listShareLinks, reclassifyExistingAssets, setAssetCategory, listBusinessCards, getBusinessCard, upsertBusinessCard } from './db.mjs';
import { importFolder, thumbStreamPath, originalStreamPath, getExifData } from './library.mjs';
import { handleUpload } from './upload.mjs';
import { processOcr, getOcr, processPlateOcr, getPlates, runOcrAndClassify, setOcrBus } from './ocr.mjs';
import { batchOcrToDocument } from './ocr-document.mjs';
import { tmpdir } from 'node:os';
import { startWatchers, stopWatcher } from './watcher.mjs';
import { unlinkSync, writeFileSync } from 'node:fs';
import bcrypt from 'bcrypt';
import { runBusinessCardOcr, syncToHost as bcSyncToHost, parseBusinessCardText, decodeHeicToJpegBuffer } from './ocr-businesscard.mjs';
import { paddleRecognize } from './ocr-paddle.mjs';
// Step 2: 6 new modules for Phase 5A/5B/RAW/LivePhoto/Transcode/OCR-FTS
import { detectFaces, clusterFaces, renamePerson, mergePeople, getPersonPhotos, deletePerson } from './face.mjs';
import { embedPhoto, embedText, search as semanticSearch, batchEmbed } from './semantic.mjs';
import { detectRawVariant, decodeRaw, getRawPreview, batchDecodeRaw } from './raw.mjs';
import { findPairs as findLivePhotoPairs, linkPair, getPair as getLivePhotoPair, unlinkPair } from './livephoto.mjs';
import { enqueueTranscode, processQueue as processTranscodeQueue, getProxyPath, retryFailed } from './transcode.mjs';
import { searchOcrFts, autoOcrOnImport, getPhotoOcr, rebuildFtsIndex } from './ocr-fts.mjs';
import { toClipQuery, extractDateRange } from './query-bridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const CLIENT_DIR = join(ROOT, 'client');
const PORT = Number(process.env.MYCREW_PHOTOS_PORT || 13201);
const HOST_ORIGIN = process.env.MYCREW_HOST_ORIGIN || 'http://127.0.0.1:3456';
// 추가 허용 origin: 콤마 구분. 운영 슬림 셸/서브도메인을 정확 매칭 화이트리스트.
const EXTRA_ORIGINS = (process.env.MYCREW_EXTRA_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// 개발: localhost/127.0.0.1 모든 포트 허용. 운영: EXTRA_ORIGINS 정확 매칭.
const LOOPBACK_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === HOST_ORIGIN) return true;
  if (LOOPBACK_RE.test(origin)) return true;
  return EXTRA_ORIGINS.includes(origin);
}

openDb(ROOT);
// Phase 7: backfill category for existing assets (idempotent, deterministic).
try { reclassifyExistingAssets(); } catch (e) { console.error('reclassify on startup failed:', e?.message || e); }

const app = new Hono();
const bus = new Bus();
setOcrBus(bus);

// Background OCR backfill — auto-process legacy 'photo' assets with no photo_ocr row.
// Runs after server boot, throttled to 1 photo every 3s. Stops on SIGTERM/SIGINT.
// Fixes the "「문서」 menu empty" case where assets pre-date the auto-OCR hook.
let backfillStop = false;
async function runDocBackfill() {
  await new Promise((r) => setTimeout(r, 8000)); // let server settle
  const db = getDb();
  let totalScanned = 0, totalClassified = 0;
  while (!backfillStop) {
    const next = db.prepare(`
      SELECT a.sha256 FROM assets a
      WHERE a.is_trashed = 0
        AND a.category = 'photo'
        AND a.media_type = 'image'
        AND a.mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
        AND NOT EXISTS (SELECT 1 FROM photo_ocr p WHERE p.photo_id = a.sha256)
      ORDER BY a.imported_at DESC
      LIMIT 1
    `).get();
    if (!next) break;
    try {
      const r = await runOcrAndClassify(ROOT, next.sha256);
      totalScanned += 1;
      if (r && r.classified) totalClassified += 1;
      if (totalScanned % 10 === 0) {
        console.log(`[ocr-backfill] scanned=${totalScanned} classified=${totalClassified}`);
      }
    } catch (e) {
      console.error('[ocr-backfill]', next.sha256.slice(0, 8), e?.message || e);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (totalScanned > 0) {
    console.log(`[ocr-backfill] done: scanned=${totalScanned} classified=${totalClassified}`);
    if (totalClassified > 0) bus.broadcast({ type: 'library.imported', payload: { count: 0, source: 'backfill' } });
  }
}
runDocBackfill().catch((e) => console.error('[ocr-backfill] fatal', e?.message || e));

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  c.header('Vary', 'Origin');
  if (isAllowedOrigin(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    // Allow credentials so host (mycrew-system) cross-origin fetch with credentials passes CORS.
    // origin echo + ACAC=true is spec-compliant (wildcard ACAO + credentials is not).
    c.header('Access-Control-Allow-Credentials', 'true');
  }
  // Permit cross-origin embedding/fetch of media assets by allow-listed hosts (Chrome 100+ CORP guard).
  c.header('Cross-Origin-Resource-Policy', 'cross-origin');
  // 매칭 실패 시 ACAO 미설정 → 브라우저 차단 (보안: 폴백으로 잘못된 origin 반환 금지)
  c.header('Access-Control-Allow-Headers', 'authorization,content-type');
  c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/health', (c) =>
  c.json({ ok: true, app: 'photos', version: '0.4.0', clients: bus.clientCount() }),
);

app.get('/manifest', (c) => {
  const p = join(ROOT, 'manifest.json');
  if (!existsSync(p)) return c.json({ error: 'manifest missing' }, 404);
  return c.json(JSON.parse(readFileSync(p, 'utf-8')));
});

// ----- Library API -----

app.post('/api/library/import/folder', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || typeof body.path !== 'string') {
    return c.json({ error: 'path required' }, 400);
  }
  try {
    const result = await importFolder(ROOT, { path: body.path, recursive: body.recursive !== false });
    bus.broadcast({ type: 'library.imported', payload: { count: result.imported, source: 'folder' } });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

app.post('/api/library/upload', async (c) => {
  try {
    const result = await handleUpload(c, ROOT);
    const imported = result.imported.filter((r) => r.status === 'imported').length;
    if (imported > 0) bus.broadcast({ type: 'library.imported', payload: { count: imported, source: 'upload' } });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/library/timeline', (c) => {
  const cursor = c.req.query('cursor') || undefined;
  const limit = Number(c.req.query('limit')) || 100;
  const data = listTimeline({ cursor, limit });
  // Add thumbnail/original URLs
  const items = data.items.map((row) => ({
    sha256: row.sha256,
    filename: row.filename,
    mime: row.mime,
    mediaType: row.media_type || 'image',
    size: row.size,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    importedAt: row.imported_at,
    source: row.source,
    sourceRoot: row.source_root,
    gpsLat: row.gps_lat,
    gpsLng: row.gps_lng,
    camera: row.camera,
    thumbnailUrl: `/api/library/asset/${row.sha256}/thumbnail`,
    originalUrl: `/api/library/asset/${row.sha256}/original`,
  }));
  return c.json({ items, nextCursor: data.nextCursor });
});

app.get('/api/library/stats', (c) => c.json(stats()));

// Phase 3A: search, favorites, archive, trash
app.get('/api/library/search', (c) => {
  const q = c.req.query('q') || '';
  if (!q.trim()) return c.json({ items: [] });
  const dateStart = c.req.query('dateStart') || undefined;
  const dateEnd = c.req.query('dateEnd') || undefined;
  let startMs = null, endMs = null;
  if (dateStart && /^\d{4}-\d{2}-\d{2}$/.test(dateStart)) {
    const ms = Date.parse(dateStart + 'T00:00:00');
    if (Number.isFinite(ms)) startMs = ms;
  }
  if (dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
    const ms = Date.parse(dateEnd + 'T23:59:59.999');
    if (Number.isFinite(ms)) endMs = ms;
  }
  const rows = searchAssets(q).filter((row) => {
    const ts = row.taken_at ?? row.imported_at;
    if (startMs !== null && !(ts != null && ts >= startMs)) return false;
    if (endMs !== null && !(ts != null && ts <= endMs)) return false;
    return true;
  });
  const items = rows.map((row) => ({
    sha256: row.sha256,
    filename: row.filename,
    mime: row.mime,
    mediaType: row.media_type || 'image',
    takenAt: row.taken_at,
    isFavorite: row.is_favorite,
    isArchived: row.is_archived,
    thumbnailUrl: `/api/library/asset/${row.sha256}/thumbnail`,
    originalUrl: `/api/library/asset/${row.sha256}/original`,
  }));
  return c.json({ items });
});

app.get('/api/library/photos', (c) => {
  const filter = c.req.query('filter') || 'library';
  const cursor = c.req.query('cursor') || undefined;
  const limit = Number(c.req.query('limit')) || 100;
  const ratingMin = c.req.query('rating_min') ? Number(c.req.query('rating_min')) : undefined;
  const dateStart = c.req.query('dateStart') || undefined;
  const dateEnd = c.req.query('dateEnd') || undefined;

  const data = listAssetsByFilter(filter, { cursor, limit, ratingMin, dateStart, dateEnd });
  const items = data.items.map((row) => ({
    sha256: row.sha256,
    filename: row.filename,
    mime: row.mime,
    mediaType: row.media_type || 'image',
    size: row.size,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    importedAt: row.imported_at,
    isFavorite: row.is_favorite,
    isArchived: row.is_archived,
    isTrashed: row.is_trashed,
    trashedAt: row.trashed_at,
    rating: row.rating || 0,
    category: row.category || 'photo',
    thumbnailUrl: `/api/library/asset/${row.sha256}/thumbnail`,
    originalUrl: `/api/library/asset/${row.sha256}/original`,
  }));
  return c.json({ items, nextCursor: data.nextCursor });
});

app.get('/api/library/counts', (c) => c.json(getCounts()));

app.post('/api/library/:sha/favorite', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = toggleFavorite(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  bus.broadcast({ type: 'library.updated', payload: { sha, field: 'favorite', value: asset.is_favorite } });
  return c.json({ sha256: sha, isFavorite: asset.is_favorite });
});

app.post('/api/library/:sha/archive', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = toggleArchive(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  bus.broadcast({ type: 'library.updated', payload: { sha, field: 'archive', value: asset.is_archived } });
  return c.json({ sha256: sha, isArchived: asset.is_archived });
});

app.post('/api/library/:sha/trash', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = trashAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  bus.broadcast({ type: 'library.updated', payload: { sha, field: 'trash', value: 1 } });
  return c.json({ sha256: sha, isTrashed: 1, trashedAt: asset.trashed_at });
});

app.patch('/api/library/:sha/category', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || typeof body.category !== 'string') {
    return c.json({ error: 'category required' }, 400);
  }
  try {
    const asset = setAssetCategory(sha, body.category);
    if (!asset) return c.json({ error: 'not found' }, 404);
    bus.broadcast({ type: 'library.updated', payload: { sha, field: 'category', value: asset.category } });
    return c.json({ sha256: sha, category: asset.category });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

app.post('/api/library/:sha/restore', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = restoreAsset(sha);
  if (!asset) return c.json({ error: 'not found or not trashed' }, 404);
  bus.broadcast({ type: 'library.updated', payload: { sha, field: 'trash', value: 0 } });
  return c.json({ sha256: sha, isTrashed: 0 });
});

app.delete('/api/library/:sha', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  
  let asset;
  try {
    asset = deleteAssetPermanently(sha);
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
  
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  // SAFETY: never touch user's import source folder. Only delete files inside
  // ROOT/data/originals/** (catalog-managed copies/hardlinks) and ROOT/data/thumbs/**.
  // originalStreamPath() returns originalsPathFor(rootDir,...) = ROOT/data/originals/{2}/{sha}{ext}
  // so anything outside that prefix is rejected with a hard assertion below.
  const safeOriginalsRoot = resolve(ROOT, 'data', 'originals') + '/';
  const safeThumbsRoot = resolve(ROOT, 'data', 'thumbs') + '/';
  try {
    const origPath = originalStreamPath(ROOT, sha);
    const thumbPath = thumbStreamPath(ROOT, sha);
    if (origPath) {
      const abs = resolve(origPath);
      if (!abs.startsWith(safeOriginalsRoot)) {
        throw new Error('refused: original path outside catalog originals dir: ' + abs);
      }
      if (existsSync(abs)) unlinkSync(abs);
    }
    if (thumbPath) {
      const abs = resolve(thumbPath);
      if (!abs.startsWith(safeThumbsRoot)) {
        throw new Error('refused: thumb path outside catalog thumbs dir: ' + abs);
      }
      if (existsSync(abs)) unlinkSync(abs);
    }
  } catch (e) {
    console.error('[photos] file deletion failed:', e.message);
  }
  
  bus.broadcast({ type: 'library.deleted', payload: { sha } });
  return c.json({ sha256: sha, deleted: true });
});

// Phase 3B: memories, map, exif
app.get('/api/library/memories/today', (c) => {
  const rows = getMemoriesToday();
  const memories = rows.map((row) => ({
    sha256: row.sha256,
    thumbUrl: `/api/library/asset/${row.sha256}/thumbnail`,
    takenAt: row.taken_at,
    yearsAgo: row.years_ago,
  }));
  return c.json({ memories: memories.length >= 5 ? memories : [] });
});

app.get('/api/library/photos/geo', (c) => {
  const rows = getPhotosWithGeo();
  const photos = rows.map((row) => ({
    sha256: row.sha256,
    lat: row.gps_lat,
    lng: row.gps_lng,
    thumbUrl: `/api/library/asset/${row.sha256}/thumbnail`,
  }));
  return c.json({ photos });
});

app.get('/api/library/photos/:sha/exif', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = getAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  try {
    const exif = await getExifData(asset.original_path);
    return c.json({ exif });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Phase 3D: Albums
app.post('/api/library/albums', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !body.name || !body.name.trim()) {
    return c.json({ error: 'name required' }, 400);
  }
  try {
    const album = createAlbum(body.name);
    return c.json({
      id: album.id,
      name: album.name,
      coverSha256: album.cover_sha256,
      createdAt: album.created_at,
      updatedAt: album.updated_at,
    });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

app.get('/api/library/albums', (c) => {
  const albums = listAlbums();
  return c.json({
    albums: albums.map(a => ({
      id: a.id,
      name: a.name,
      coverSha256: a.cover_sha256,
      coverThumbUrl: a.coverThumbUrl,
      photoCount: a.photoCount,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    })),
  });
});

app.get('/api/library/albums/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid album id' }, 400);
  const data = getAlbum(id);
  if (!data) return c.json({ error: 'album not found' }, 404);
  
  return c.json({
    album: {
      id: data.album.id,
      name: data.album.name,
      coverSha256: data.album.cover_sha256,
      createdAt: data.album.created_at,
      updatedAt: data.album.updated_at,
    },
    photos: data.photos.map(p => ({
      sha256: p.sha256,
      filename: p.filename,
      mime: p.mime,
      mediaType: p.media_type || 'image',
      width: p.width,
      height: p.height,
      takenAt: p.taken_at,
      thumbUrl: `/api/library/asset/${p.sha256}/thumbnail`,
      originalUrl: `/api/library/asset/${p.sha256}/original`,
    })),
  });
});

app.patch('/api/library/albums/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid album id' }, 400);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  
  try {
    const album = updateAlbum(id, { name: body.name, coverSha256: body.coverSha256 });
    if (!album) return c.json({ error: 'album not found' }, 404);
    
    return c.json({
      id: album.id,
      name: album.name,
      coverSha256: album.cover_sha256,
      updatedAt: album.updated_at,
    });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

app.delete('/api/library/albums/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid album id' }, 400);
  
  const album = deleteAlbum(id);
  if (!album) return c.json({ error: 'album not found' }, 404);
  
  return c.json({ id, deleted: true });
});

app.post('/api/library/albums/:id/photos', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid album id' }, 400);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !Array.isArray(body.photoIds)) {
    return c.json({ error: 'photoIds array required' }, 400);
  }
  
  try {
    const result = addPhotosToAlbum(id, body.photoIds);
    return c.json({ added: result.added });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

app.delete('/api/library/albums/:id/photos', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid album id' }, 400);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !Array.isArray(body.photoIds)) {
    return c.json({ error: 'photoIds array required' }, 400);
  }
  
  try {
    const result = removePhotosFromAlbum(id, body.photoIds);
    return c.json({ removed: result.removed });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// Phase 4: OCR (receipt text recognition)
app.post('/api/photos/:id/ocr', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = getAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  try {
    const result = await processOcr(ROOT, sha);
    return c.json({
      sha256: sha,
      text: result.text,
      confidence: result.confidence,
      language: result.language,
      processedAt: result.processedAt,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/photos/:id/ocr', (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const result = getOcr(sha);
  if (!result) return c.json({ error: 'OCR not processed yet' }, 404);
  return c.json({
    sha256: sha,
    text: result.text,
    confidence: result.confidence,
    language: result.language,
    processedAt: result.processedAt,
  });
});

// Phase 4b: Batch OCR → document (PDF/MD/TXT) + external library copy.
// Reuses photo_ocr cache; runs tesseract only for misses.
app.post('/api/ocr/batch-document', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { photoIds, format, title } = body || {};
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    return c.json({ error: 'photoIds[] required' }, 400);
  }
  if (photoIds.length > 100) {
    return c.json({ error: 'too many (max 100)' }, 400);
  }
  for (const sha of photoIds) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
      return c.json({ error: 'invalid sha: ' + sha }, 400);
    }
  }
  const fmt = String(format || 'pdf').toLowerCase();
  if (!['pdf', 'md', 'markdown', 'txt', 'xlsx', 'excel'].includes(fmt)) {
    return c.json({ error: 'format must be pdf|md|txt|xlsx' }, 400);
  }
  try {
    const result = await batchOcrToDocument({ rootDir: ROOT, photoIds, format: fmt, title });
    return c.json({
      ok: true,
      downloadUrl: `/api/ocr/document/${encodeURIComponent(result.downloadFileName)}`,
      downloadFileName: result.downloadFileName,
      mimeType: result.mimeType,
      itemsCount: result.itemsCount,
      failedCount: result.failedCount,
      library: result.library,
    });
  } catch (e) {
    console.error('[ocr/batch-document] failed:', e);
    return c.json({ error: e.message }, 500);
  }
});

// Reclassify existing photos by running OCR on a bounded batch.
// Targets: category='photo' AND mime IN (jpeg,png,webp) AND no prior photo_ocr row.
// Returns counts; intended to be triggered from UI ("기존 사진 일괄 분석").
app.post('/api/library/reclassify/run-ocr', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const requested = Number((body && body.limit) || 50);
  const limit = Math.max(1, Math.min(200, requested));
  const db = getDb();
  const candidates = db.prepare(`
    SELECT a.sha256 FROM assets a
    WHERE a.is_trashed = 0
      AND a.category = 'photo'
      AND a.media_type = 'image'
      AND a.mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
      AND NOT EXISTS (SELECT 1 FROM photo_ocr p WHERE p.photo_id = a.sha256)
    ORDER BY a.imported_at DESC
    LIMIT ?
  `).all(limit);
  const startedAt = Date.now();
  let scanned = 0, classified = 0, failed = 0;
  for (const row of candidates) {
    scanned++;
    try {
      const r = await runOcrAndClassify(ROOT, row.sha256);
      if (r && r.classified) classified++;
    } catch (e) {
      failed++;
      console.error('[reclassify] failed', row.sha256.slice(0, 8), e?.message || e);
    }
  }
  if (classified > 0) bus.broadcast({ type: 'library.imported', payload: { count: 0, source: 'reclassify' } });
  return c.json({
    scanned,
    classifiedAsDocument: classified,
    failed,
    elapsedMs: Date.now() - startedAt,
    remaining: Math.max(0, candidates.length === limit ? -1 : 0), // -1 = likely more
  });
});

// Serve generated OCR documents from tmpdir. Strict name allowlist + path-jail.
app.get('/api/ocr/document/:name', (c) => {
  const name = c.req.param('name');
  if (!/^[A-Za-z0-9가-힣._-]+$/.test(name)) {
    return c.json({ error: 'invalid name' }, 400);
  }
  const tmpDir = join(tmpdir(), 'mycrew-ocr-docs');
  const filePath = join(tmpDir, name);
  if (!filePath.startsWith(tmpDir + '/') && filePath !== tmpDir) {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (!existsSync(filePath)) return c.json({ error: 'not found' }, 404);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mime = ext === 'pdf'
    ? 'application/pdf'
    : ext === 'md'
      ? 'text/markdown; charset=utf-8'
      : 'text/plain; charset=utf-8';
  const buf = readFileSync(filePath);
  c.header('Content-Type', mime);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  return c.body(buf);
});

// Phase 5C: License plate OCR
app.post('/api/photos/:id/plates', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = getAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  try {
    const result = await processPlateOcr(ROOT, sha);
    return c.json({
      sha256: sha,
      plateNumber: result.plateNumber,
      confidence: result.confidence,
      processedAt: result.processedAt,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/photos/:id/plates', (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const result = getPlates(sha);
  if (!result) return c.json({ error: 'No plate OCR processed yet' }, 404);
  return c.json({
    sha256: sha,
    plateNumber: result.plateNumber,
    confidence: result.confidence,
    processedAt: result.processedAt,
  });
});

// Phase 8: Business card OCR (5 routes)
app.get('/api/photos/:sha/businesscard', (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const bc = getBusinessCard(sha);
  if (!bc) return c.json({ businesscard: null });
  
  return c.json({
    businesscard: {
      sha256: sha,
      name: bc.name,
      phones: bc.phones ? JSON.parse(bc.phones) : [],
      emails: bc.emails ? JSON.parse(bc.emails) : [],
      company: bc.company,
      department: bc.department,
      position: bc.position,
      rawText: bc.raw_text,
      confidence: bc.confidence,
      createdAt: bc.created_at,
      syncedToHostAt: bc.synced_to_host_at,
    }
  });
});

app.post('/api/photos/:sha/businesscard-ocr', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const asset = getAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  try {
    const result = await runBusinessCardOcr(ROOT, sha);
    
    // Check autoAdd setting
    const settingsPath = join(ROOT, 'data', 'businesscard-settings.json');
    let autoAdd = true;
    try {
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        autoAdd = settings.autoAdd !== false;
      }
    } catch {}
    
    let synced = null;
    let syncStatus = 'skipped';
    let syncReason = autoAdd ? null : 'autoAdd-disabled';
    if (autoAdd) {
      const syncResult = await bcSyncToHost(sha);
      synced = syncResult.ok;
      syncStatus = syncResult.ok ? 'ok' : 'failed';
      syncReason = syncResult.ok ? null : (syncResult.reason || 'unknown');
    }

    return c.json({
      sha256: sha,
      contact: result.parsed,
      synced,
      syncStatus,
      syncReason,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/photos/:sha/businesscard-sync', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const bc = getBusinessCard(sha);
  if (!bc) return c.json({ error: 'business card not found' }, 404);
  
  try {
    const result = await bcSyncToHost(sha);
    return c.json(result);
  } catch (e) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});

app.post('/api/photos/businesscard-ocr-blob', async (c) => {
  // Multipart image upload → temp save → OCR → return parsed data (no DB save)
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: 'invalid form data' }, 400);
  
  const file = formData.get('image');
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'image file required' }, 400);
  }
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const tmpPath = join(tmpdir(), `bc-ocr-${Date.now()}.${ext}`);
  
  try {
    writeFileSync(tmpPath, buffer);

    // HEIC/HEIF: onnxruntime/sharp cannot decode HEIC; convert to JPEG first.
    // Detect by ISO BMFF ftyp brand, then fall back to filename / mime hint.
    let recognizePath = tmpPath;
    let heicTmpJpeg = null;
    const ftypBrand = buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp'
      ? buffer.slice(8, 12).toString('ascii')
      : '';
    const isHeic = ['heic', 'heix', 'mif1', 'heim', 'heis', 'msf1'].includes(ftypBrand)
      || /\.(heic|heif)$/i.test(file.name || '')
      || ['image/heic', 'image/heif'].includes(file.type || '');
    if (isHeic) {
      const jpegBuf = await decodeHeicToJpegBuffer(tmpPath);
      heicTmpJpeg = join(tmpdir(), `bc-ocr-${Date.now()}-heic.jpg`);
      writeFileSync(heicTmpJpeg, jpegBuf);
      recognizePath = heicTmpJpeg;
    }

    // Run PaddleOCR (PP-OCRv4) via onnxruntime-node
    let rawText, confidence;
    try {
      const result = await paddleRecognize(recognizePath);
      rawText = result.text.trim();
      confidence = result.confidence;
    } finally {
      if (heicTmpJpeg) { try { unlinkSync(heicTmpJpeg); } catch {} }
    }
    const parsed = parseBusinessCardText(rawText);
    
    return c.json({
      ok: true,
      contact: {
        name: parsed.name || '',
        phone: parsed.phones[0] || '',
        email: parsed.emails[0] || '',
        company: parsed.company || '',
        department: parsed.department || '',
        position: parsed.position || '',
        ocrConfidence: confidence,
      },
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
});

app.get('/api/library/businesscards', (c) => {
  try {
    const cards = listBusinessCards();
    return c.json({ items: cards });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/library/businesscards', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !body.sha256 || !/^[0-9a-f]{64}$/.test(body.sha256)) {
    return c.json({ error: 'sha256 required' }, 400);
  }
  const asset = getAsset(body.sha256);
  if (!asset) return c.json({ error: 'photo not found' }, 404);
  try {
    const parsed = {
      name: body.name || null, phones: body.phones || [], emails: body.emails || [],
      company: body.company || null, department: body.department || null,
      position: body.position || null, rawText: body.rawText || null,
      confidence: body.confidence || 0,
    };
    const card = upsertBusinessCard(body.sha256, parsed);
    return c.json({ ok: true, businesscard: card });
  } catch (e) { return c.json({ error: e.message }, 500); }
});

app.post('/api/businesscard-settings', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (typeof body.autoAdd !== 'boolean') {
    return c.json({ error: 'autoAdd (boolean) required' }, 400);
  }
  
  const settingsPath = join(ROOT, 'data', 'businesscard-settings.json');
  const settings = { autoAdd: body.autoAdd };
  
  try {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return c.json({ ok: true, settings });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Phase 6: Watched folders (auto-import)
app.get('/api/watched-folders', (c) => {
  const folders = listWatchedFolders();
  return c.json({
    folders: folders.map(f => ({
      id: f.id,
      path: f.path,
      enabled: f.enabled === 1,
      addedAt: f.added_at,
    })),
  });
});

app.post('/api/watched-folders', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !body.path || typeof body.path !== 'string') {
    return c.json({ error: 'path required' }, 400);
  }
  
  try {
    const folder = addWatchedFolder(body.path);
    // Start watcher immediately
    startWatchers(ROOT, bus);
    return c.json({
      id: folder.id,
      path: folder.path,
      enabled: folder.enabled === 1,
      addedAt: folder.added_at,
    });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

app.delete('/api/watched-folders/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid id' }, 400);
  
  const folder = removeWatchedFolder(id);
  if (!folder) return c.json({ error: 'not found' }, 404);
  
  // Stop watcher if active
  stopWatcher(folder.path);
  
  return c.json({ id, deleted: true });
});

app.patch('/api/watched-folders/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid id' }, 400);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled (boolean) required' }, 400);
  }
  
  const folder = toggleWatchedFolder(id, body.enabled);
  if (!folder) return c.json({ error: 'not found' }, 404);
  
  // Restart watchers to apply change
  if (body.enabled) {
    startWatchers(ROOT, bus);
  } else {
    stopWatcher(folder.path);
  }
  
  return c.json({
    id: folder.id,
    path: folder.path,
    enabled: folder.enabled === 1,
  });
});

// Phase 6: Tags
app.get('/api/photos/:id/tags', (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const tags = getPhotoTags(sha);
  return c.json({ sha256: sha, tags });
});

app.post('/api/photos/:id/tags', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !body.tag || typeof body.tag !== 'string') {
    return c.json({ error: 'tag required' }, 400);
  }
  
  const asset = getAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  try {
    const result = addPhotoTag(sha, body.tag);
    return c.json({ sha256: sha, tag: result.tag, createdAt: result.createdAt });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

app.delete('/api/photos/:id/tags/:tag', (c) => {
  const sha = c.req.param('id');
  const tag = decodeURIComponent(c.req.param('tag'));
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  
  const removed = removePhotoTag(sha, tag);
  if (!removed) return c.json({ error: 'tag not found' }, 404);
  
  return c.json({ sha256: sha, tag, deleted: true });
});

app.get('/api/tags', (c) => {
  const tags = getAllTags();
  return c.json({ tags: tags.map(t => ({ tag: t.tag, count: t.count })) });
});

// Phase 6: Rating
app.patch('/api/photos/:id', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  
  const asset = getAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  // Only rating supported for now
  if (typeof body.rating !== 'number') {
    return c.json({ error: 'rating (number 0-5) required' }, 400);
  }
  
  try {
    const updated = updatePhotoRating(sha, body.rating);
    return c.json({ sha256: sha, rating: updated.rating });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// Phase 6: Share links
app.post('/api/photos/:id/share', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  
  const asset = getAsset(sha);
  if (!asset) return c.json({ error: 'not found' }, 404);
  
  let body = {};
  try { body = await c.req.json(); } catch {}
  
  const expiresIn = body.expiresIn ? Number(body.expiresIn) : null; // milliseconds
  let passwordHash = null;
  if (body.password && typeof body.password === 'string' && body.password.trim()) {
    passwordHash = await bcrypt.hash(body.password, 10);
  }
  
  const link = createShareLink(sha, expiresIn, passwordHash);
  
  return c.json({
    token: link.token,
    url: `/shared/${link.token}`,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
  });
});

app.get('/shared/:token', async (c) => {
  const token = c.req.param('token');
  const link = getShareLink(token);
  
  if (!link) return c.json({ error: 'link not found or expired' }, 404);
  
  // Password verification
  if (link.password_hash) {
    const providedPassword = c.req.query('password') || '';
    if (!providedPassword) {
      return c.json({ error: 'password required' }, 401);
    }
    const passwordValid = await bcrypt.compare(providedPassword, link.password_hash);
    if (!passwordValid) {
      return c.json({ error: 'invalid password' }, 403);
    }
  }
  
  // Increment view_count
  const db = getDb();
  db.prepare('UPDATE share_links SET view_count = view_count + 1 WHERE token = ?').run(token);
  
  const asset = getAsset(link.photo_id);
  if (!asset) return c.json({ error: 'photo not found' }, 404);
  
  return c.json({
    sha256: asset.sha256,
    filename: asset.filename,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    takenAt: asset.taken_at,
    thumbnailUrl: `/api/library/asset/${asset.sha256}/thumbnail`,
    originalUrl: `/api/library/asset/${asset.sha256}/original`,
    expiresAt: link.expires_at,
  });
});

app.delete('/api/share/:token', (c) => {
  const token = c.req.param('token');
  const link = deleteShareLink(token);
  
  if (!link) return c.json({ error: 'not found' }, 404);
  
  return c.json({ token, deleted: true });
});

app.get('/api/photos/:id/shares', (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  
  const links = listShareLinks(sha);
  return c.json({
    shares: links.map(l => ({
      token: l.token,
      url: `/shared/${l.token}`,
      expiresAt: l.expires_at,
      createdAt: l.created_at,
    })),
  });
});

// Phase 3C: video streaming with Range header support
app.get('/api/library/photos/:sha/stream', (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.text('invalid sha', 400);
  const asset = getAsset(sha);
  if (!asset) return c.text('not found', 404);
  if (asset.media_type !== 'video') return c.text('not a video', 400);
  
  const p = originalStreamPath(ROOT, sha);
  if (!p || !existsSync(p)) return c.text('video file missing', 404);
  
  const stat = statSync(p);
  const fileSize = stat.size;
  const rangeHeader = c.req.header('range');
  
  if (!rangeHeader) {
    // No Range header — return full file (200)
    return new Response(createReadStream(p), {
      headers: {
        'content-type': asset.mime,
        'content-length': String(fileSize),
        'accept-ranges': 'bytes',
      },
    });
  }
  
  // Parse Range header (e.g., "bytes=0-1023")
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) return c.text('invalid range', 416);
  
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
  
  if (start >= fileSize || end >= fileSize || start > end) {
    return c.text('range not satisfiable', 416);
  }
  
  const chunkSize = end - start + 1;
  const stream = createReadStream(p, { start, end });
  
  return new Response(stream, {
    status: 206,
    headers: {
      'content-type': asset.mime,
      'content-length': String(chunkSize),
      'content-range': `bytes ${start}-${end}/${fileSize}`,
      'accept-ranges': 'bytes',
    },
  });
});

app.get('/api/library/asset/:sha/thumbnail', (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.text('invalid sha', 400);
  const p = thumbStreamPath(ROOT, sha);
  if (!existsSync(p) || !statSync(p).isFile()) {
    // No thumb (e.g., HEIC) — fall back to 404 with hint
    return c.text('thumbnail not available', 404);
  }
  return new Response(createReadStream(p), {
    headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000' },
  });
});

app.get('/api/library/asset/:sha/original', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.text('invalid sha', 400);
  const a = getAsset(sha);
  if (!a) return c.text('not found', 404);
  const p = originalStreamPath(ROOT, sha);
  if (!p || !existsSync(p)) return c.text('original missing', 404);
  
  // Phase 3C: format parameter for HEIC conversion
  const format = c.req.query('format');
  const isHeic = a.mime === 'image/heic' || a.mime === 'image/heif';
  
  if (format === 'jpg' && isHeic) {
    // Convert HEIC to JPEG on-the-fly
    try {
      const heicConvert = (await import('heic-convert')).default;
      const buffer = readFileSync(p);
      const jpegBuffer = await heicConvert({ buffer, format: 'JPEG', quality: 0.92 });
      return new Response(jpegBuffer, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000' },
      });
    } catch (e) {
      console.error('[photos] HEIC conversion failed:', e.message);
      return c.text('HEIC conversion failed', 500);
    }
  }
  
  // Default: return original file
  return new Response(createReadStream(p), {
    headers: { 'content-type': a.mime, 'cache-control': 'public, max-age=31536000' },
  });
});

// ----- Step 2: New routes for Phase 5A/5B/RAW/LivePhoto/Transcode/OCR-FTS -----

// Phase 5B: Face recognition (8 routes)
app.post('/api/photos/:id/faces/detect', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  try {
    const faces = await detectFaces(sha);
    return c.json({ sha256: sha, faces: faces.length, detected: faces });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/photos/:id/faces', (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  try {
    const db = getDb();
    const faces = db.prepare('SELECT id, person_id, bbox_x, bbox_y, bbox_w, bbox_h FROM photo_faces WHERE photo_id = ?').all(sha);
    return c.json({ sha256: sha, faces });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/people', (c) => {
  try {
    const db = getDb();
    const people = db.prepare(`
      SELECT p.id, p.name, p.cover_photo_id, p.created_at, p.updated_at,
             COUNT(pf.id) as photo_count
      FROM people p
      LEFT JOIN photo_faces pf ON pf.person_id = p.id
      GROUP BY p.id
      ORDER BY photo_count DESC
    `).all();
    return c.json({ people });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/people/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid id' }, 400);
  try {
    const photos = getPersonPhotos(id, 100, 0);
    const db = getDb();
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
    if (!person) return c.json({ error: 'not found' }, 404);
    return c.json({ person, photos });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.patch('/api/people/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid id' }, 400);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !body.name) return c.json({ error: 'name required' }, 400);
  try {
    const person = renamePerson(id, body.name);
    return c.json({ person });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/people/merge', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || !body.srcId || !body.dstId) {
    return c.json({ error: 'srcId and dstId required' }, 400);
  }
  try {
    const result = mergePeople(body.srcId, body.dstId);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/people/cluster', async (c) => {
  try {
    const result = await clusterFaces();
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.delete('/api/people/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!id || id < 1) return c.json({ error: 'invalid id' }, 400);
  try {
    const person = deletePerson(id);
    if (!person) return c.json({ error: 'not found' }, 404);
    return c.json({ id, deleted: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Phase 5A: CLIP semantic search (3 routes)
app.post('/api/library/photos/:id/embed', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  try {
    const embedding = await embedPhoto(sha);
    return c.json({ sha256: sha, embedded: true, dims: embedding.length });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/library/embed/batch', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch {}
  const limit = body.limit ? Number(body.limit) : 100;
  try {
    const result = await batchEmbed(limit);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/library/search/semantic', async (c) => {
  const rawQ = (c.req.query('q') || '').trim();
  if (!rawQ) return c.json({ items: [] });
  const topK = c.req.query('topK') ? Number(c.req.query('topK')) : 50;
  const minScore = c.req.query('minScore') !== undefined
    ? Number(c.req.query('minScore')) : 0.2;
  try {
    // 1) Date words ("작년", "지난달", "2024년" …) → taken_at range filter.
    const { query: visualQ, startMs: qStartMs, endMs: qEndMs } = extractDateRange(rawQ);
    // 2) Korean/non-English → short English CLIP phrase (fallback: original).
    const { text: clipQuery, translated } = await toClipQuery(visualQ || rawQ);
    // 3) Explicit dateStart/dateEnd params (UI date inputs) intersect with query dates.
    let startMs = qStartMs, endMs = qEndMs;
    const dateStart = c.req.query('dateStart');
    const dateEnd = c.req.query('dateEnd');
    if (dateStart && /^\d{4}-\d{2}-\d{2}$/.test(dateStart)) {
      const ms = Date.parse(dateStart + 'T00:00:00');
      if (Number.isFinite(ms)) startMs = startMs === null ? ms : Math.max(startMs, ms);
    }
    if (dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
      const ms = Date.parse(dateEnd + 'T23:59:59.999');
      if (Number.isFinite(ms)) endMs = endMs === null ? ms : Math.min(endMs, ms);
    }

    let photos = await semanticSearch(clipQuery, topK);
    if (Number.isFinite(minScore)) {
      photos = photos.filter((p) => p.similarity_score >= minScore);
    }
    photos = photos.filter((row) => {
      const ts = row.taken_at ?? row.imported_at;
      if (startMs !== null && !(ts != null && ts >= startMs)) return false;
      if (endMs !== null && !(ts != null && ts <= endMs)) return false;
      return true;
    });

    const items = photos.map((row) => ({
      sha256: row.sha256,
      filename: row.filename,
      mime: row.mime,
      mediaType: row.media_type || 'image',
      takenAt: row.taken_at,
      isFavorite: row.is_favorite,
      isArchived: row.is_archived,
      similarityScore: row.similarity_score,
      thumbnailUrl: `/api/library/asset/${row.sha256}/thumbnail`,
      originalUrl: `/api/library/asset/${row.sha256}/original`,
    }));
    return c.json({ items, clipQuery, translated, dateStartMs: startMs, dateEndMs: endMs });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// RAW format support (1 route)
app.get('/api/library/asset/:sha/raw-preview', async (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.text('invalid sha', 400);
  try {
    const previewPath = await getRawPreview(sha);
    if (!previewPath) return c.text('not a RAW file or decoding failed', 404);
    if (!existsSync(previewPath)) return c.text('preview missing', 404);
    return new Response(createReadStream(previewPath), {
      headers: { 'content-type': 'image/tiff', 'cache-control': 'public, max-age=31536000' },
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// LivePhoto pairing (2 routes)
app.post('/api/library/livephotos/scan', async (c) => {
  try {
    const result = await findLivePhotoPairs();
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/library/photos/:sha/livephoto', (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  try {
    const pair = getLivePhotoPair(sha);
    if (!pair) return c.json({ error: 'no LivePhoto pair' }, 404);
    return c.json({ sha256: sha, pair });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Video transcoding (2 routes)
app.post('/api/library/photos/:id/transcode', async (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  try {
    enqueueTranscode(sha);
    return c.json({ sha256: sha, status: 'queued' });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/library/photos/:id/proxy', (c) => {
  const sha = c.req.param('id');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  try {
    const proxyPath = getProxyPath(sha);
    const db = getDb();
    const asset = db.prepare('SELECT proxy_status, proxy_codec FROM assets WHERE sha256 = ?').get(sha);
    if (!asset) return c.json({ error: 'not found' }, 404);
    return c.json({
      sha256: sha,
      status: asset.proxy_status,
      codec: asset.proxy_codec,
      proxyUrl: proxyPath ? `/api/library/asset/${sha}/proxy-stream` : null,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// OCR FTS5 search (1 route)
app.get('/api/library/search/ocr', (c) => {
  const q = c.req.query('q') || '';
  if (!q.trim()) return c.json({ items: [] });
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 100;
  try {
    const results = searchOcrFts(q, limit);
    return c.json({ items: results });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// ----- End of Step 2 routes -----

// Single-asset metadata (used by lightbox rating fetch). Registered AFTER specific
// /api/library/photos/:sha/* routes so they take precedence in LinearRouter order.
app.get('/api/library/photos/:sha', (c) => {
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: 'invalid sha' }, 400);
  const row = getAsset(sha);
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({
    sha256: row.sha256,
    filename: row.filename,
    mime: row.mime,
    mediaType: row.media_type || 'image',
    size: row.size,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    importedAt: row.imported_at,
    isFavorite: row.is_favorite,
    isArchived: row.is_archived,
    isTrashed: row.is_trashed,
    rating: row.rating || 0,
    category: row.category || 'photo',
  });
});

// Back-compat: old endpoint now returns library timeline
app.get('/api/photos/timeline', (c) => {
  const data = listTimeline({ cursor: undefined, limit: 100 });
  const items = data.items.map((row) => ({
    sha256: row.sha256,
    filename: row.filename,
    takenAt: row.taken_at,
    thumbnailUrl: `/api/library/asset/${row.sha256}/thumbnail`,
  }));
  return c.json({ items, deprecated: 'use /api/library/timeline' });
});

// ----- Static client -----

app.get('*', (c) => {
  const url = new URL(c.req.url);
  let p = url.pathname;
  if (p === '/' || p === '') p = '/index.html';
  const file = join(CLIENT_DIR, p);
  if (!existsSync(file) || !statSync(file).isFile()) return c.text('Not Found', 404);
  const ext = (p.split('.').pop() || '').toLowerCase();
  const mime = ext === 'html' ? 'text/html'
    : ext === 'js' ? 'application/javascript'
    : ext === 'css' ? 'text/css'
    : 'text/plain';
  const headers = { 'content-type': mime + '; charset=utf-8' };
  if (ext === 'html') headers['cache-control'] = 'no-cache, must-revalidate';
  return new Response(readFileSync(file), { headers });
});

const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log('[photos] http://127.0.0.1:' + PORT);
  console.log('[photos] host origin:', HOST_ORIGIN);
  
  // Phase 6: start folder watchers
  startWatchers(ROOT, bus);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, sock, head) => {
  const u = new URL(req.url || '', 'http://127.0.0.1');
  if (u.pathname !== '/bus') { sock.destroy(); return; }
  const token = u.searchParams.get('token') || '';
  wss.handleUpgrade(req, sock, head, (ws) => bus.attach(ws, token));
});

process.on('SIGTERM', () => { backfillStop = true; server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { backfillStop = true; server.close(() => process.exit(0)); });

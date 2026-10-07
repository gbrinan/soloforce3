// SQLite library — single 'assets' table + indexes.
// Stored at ROOT/data/library.db. better-sqlite3 sync API.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

let db = null;

export function openDb(rootDir) {
  if (db) return db;
  const dataDir = join(rootDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'library.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      sha256        TEXT PRIMARY KEY,
      original_path TEXT NOT NULL,
      filename      TEXT NOT NULL,
      mime          TEXT NOT NULL,
      size          INTEGER NOT NULL,
      width         INTEGER,
      height        INTEGER,
      taken_at      INTEGER,
      imported_at   INTEGER NOT NULL,
      source        TEXT NOT NULL,
      source_root   TEXT,
      gps_lat       REAL,
      gps_lng       REAL,
      camera        TEXT
    );
  `);

  // Phase 3A migration: add columns to existing tables (idempotent)
  try { db.exec('ALTER TABLE assets ADD COLUMN is_favorite INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN is_archived INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN is_trashed INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN trashed_at INTEGER'); } catch {}

  // Phase 3C migration: video support
  try { db.exec("ALTER TABLE assets ADD COLUMN media_type TEXT DEFAULT 'image'"); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN duration_sec REAL'); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN video_codec TEXT'); } catch {}

  // Phase 7 migration: category (photo | screenshot | document) for sidebar filters
  try { db.exec("ALTER TABLE assets ADD COLUMN category TEXT DEFAULT 'photo'"); } catch {}

  // Create indexes after columns are added (idempotent)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_taken_at ON assets(taken_at DESC)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_source_root ON assets(source_root)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_is_favorite ON assets(is_favorite)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_is_archived ON assets(is_archived)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_is_trashed ON assets(is_trashed)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_trashed_at ON assets(trashed_at)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category)'); } catch {}

  // Phase 3D migration: albums
  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cover_sha256 TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (cover_sha256) REFERENCES assets(sha256) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS album_assets (
      album_id INTEGER NOT NULL,
      asset_sha256 TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (album_id, asset_sha256),
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_sha256) REFERENCES assets(sha256) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_album_assets_album_id ON album_assets(album_id);
    CREATE INDEX IF NOT EXISTS idx_album_assets_asset_sha256 ON album_assets(asset_sha256);
  `);

  // Phase 4 migration: OCR (receipt text recognition)
  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_ocr (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL,
      language TEXT,
      processed_at INTEGER NOT NULL,
      FOREIGN KEY (photo_id) REFERENCES assets(sha256) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_photo_ocr_photo_id ON photo_ocr(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_ocr_text ON photo_ocr(text);
  `);

  // Phase 5C migration: add kind column for plate OCR
  try { db.exec("ALTER TABLE photo_ocr ADD COLUMN kind TEXT DEFAULT 'receipt'"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_photo_ocr_kind ON photo_ocr(kind)"); } catch {}

  // Phase 8 migration: business cards
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_cards (
      sha TEXT PRIMARY KEY,
      name TEXT,
      phones TEXT,
      emails TEXT,
      company TEXT,
      department TEXT,
      position TEXT,
      raw_text TEXT,
      confidence REAL,
      created_at TEXT NOT NULL,
      synced_to_host_at TEXT,
      FOREIGN KEY (sha) REFERENCES assets(sha256) ON DELETE CASCADE
    );
  `);

  // Phase 6 migration: watched folders
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 1,
      added_at INTEGER NOT NULL
    );
  `);

  // Phase 6 migration: tags, rating, share links
  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (photo_id) REFERENCES assets(sha256) ON DELETE CASCADE,
      UNIQUE (photo_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_photo_tags_photo_id ON photo_tags(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag);

    CREATE TABLE IF NOT EXISTS share_links (
      token TEXT PRIMARY KEY,
      photo_id TEXT NOT NULL,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (photo_id) REFERENCES assets(sha256) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_share_links_photo_id ON share_links(photo_id);
  `);

  // Phase 6: add rating column
  try { db.exec('ALTER TABLE assets ADD COLUMN rating INTEGER DEFAULT 0'); } catch {}

  // Step 0 migration: Immich gap features (5B Face, 5A CLIP, RAW, LivePhoto, Transcode, Share+, OCR-FTS)
  
  // 1. Phase 5B: Face recognition
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      cover_photo_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (cover_photo_id) REFERENCES assets(sha256) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS photo_faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id TEXT NOT NULL,
      person_id INTEGER,
      bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
      embedding BLOB NOT NULL,
      detected_at INTEGER NOT NULL,
      FOREIGN KEY (photo_id) REFERENCES assets(sha256) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photo_faces_photo_id ON photo_faces(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_faces_person_id ON photo_faces(person_id);
  `);

  // 2. Phase 5A: CLIP semantic embeddings
  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_embeddings (
      photo_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (photo_id) REFERENCES assets(sha256) ON DELETE CASCADE
    );
  `);

  // 3. RAW format support
  try { db.exec('ALTER TABLE assets ADD COLUMN raw_variant TEXT'); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN raw_decoded_path TEXT'); } catch {}

  // 4. LivePhoto / MotionPhoto pairing
  try { db.exec('ALTER TABLE assets ADD COLUMN livephoto_pair_sha TEXT'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_livephoto_pair ON assets(livephoto_pair_sha)'); } catch {}

  // 5. Video transcoding
  try { db.exec("ALTER TABLE assets ADD COLUMN proxy_status TEXT DEFAULT 'none'"); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN proxy_path TEXT'); } catch {}
  try { db.exec('ALTER TABLE assets ADD COLUMN proxy_codec TEXT'); } catch {}

  // 6. Share links enhancement
  try { db.exec('ALTER TABLE share_links ADD COLUMN password_hash TEXT'); } catch {}
  try { db.exec('ALTER TABLE share_links ADD COLUMN view_count INTEGER DEFAULT 0'); } catch {}

  // 7. OCR FTS5 full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS photo_ocr_fts USING fts5(
      text,
      content='photo_ocr',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );
  `);

  // FTS5 sync triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS photo_ocr_ai AFTER INSERT ON photo_ocr BEGIN
      INSERT INTO photo_ocr_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS photo_ocr_ad AFTER DELETE ON photo_ocr BEGIN
      INSERT INTO photo_ocr_fts(photo_ocr_fts, rowid, text) VALUES('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS photo_ocr_au AFTER UPDATE ON photo_ocr BEGIN
      INSERT INTO photo_ocr_fts(photo_ocr_fts, rowid, text) VALUES('delete', old.id, old.text);
      INSERT INTO photo_ocr_fts(rowid, text) VALUES (new.id, new.text);
    END;
  `);

  // Backfill existing OCR data into FTS5 (idempotent: INSERT OR IGNORE)
  try {
    const existingOcrCount = db.prepare('SELECT COUNT(*) AS n FROM photo_ocr').get().n;
    if (existingOcrCount > 0) {
      db.exec('INSERT OR IGNORE INTO photo_ocr_fts(rowid, text) SELECT id, text FROM photo_ocr');
    }
  } catch {}

  return db;
}

export function getDb() {
  if (!db) throw new Error('db not initialized — call openDb(root) first');
  return db;
}

export function findBySha(sha) {
  return getDb().prepare('SELECT sha256 FROM assets WHERE sha256 = ?').get(sha);
}

export function insertAsset(asset) {
  const row = { category: 'photo', ...asset };
  return getDb().prepare(`
    INSERT OR IGNORE INTO assets
    (sha256, original_path, filename, mime, size, width, height,
     taken_at, imported_at, source, source_root, gps_lat, gps_lng, camera, category)
    VALUES (@sha256, @original_path, @filename, @mime, @size, @width, @height,
            @taken_at, @imported_at, @source, @source_root, @gps_lat, @gps_lng, @camera, @category)
  `).run(row);
}

export function listTimeline({ cursor, limit }) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  let rows;
  if (cursor) {
    const [tsStr, sha] = String(cursor).split('_');
    const ts = Number(tsStr) || 0;
    rows = getDb().prepare(`
      SELECT * FROM assets
      WHERE (taken_at < @ts) OR (taken_at = @ts AND sha256 > @sha)
      ORDER BY taken_at DESC, sha256 ASC
      LIMIT @lim
    `).all({ ts, sha, lim });
  } else {
    rows = getDb().prepare(`
      SELECT * FROM assets ORDER BY taken_at DESC, sha256 ASC LIMIT @lim
    `).all({ lim });
  }
  let nextCursor = null;
  if (rows.length === lim) {
    const last = rows[rows.length - 1];
    nextCursor = `${last.taken_at || 0}_${last.sha256}`;
  }
  return { items: rows, nextCursor };
}

export function stats() {
  const total = getDb().prepare('SELECT COUNT(*) AS n FROM assets').get().n;
  const byMonth = getDb().prepare(`
    SELECT strftime('%Y-%m', taken_at/1000, 'unixepoch') AS ym, COUNT(*) AS n
    FROM assets WHERE taken_at IS NOT NULL
    GROUP BY ym ORDER BY ym DESC LIMIT 36
  `).all();
  const roots = getDb().prepare(`
    SELECT source_root AS root, COUNT(*) AS n
    FROM assets WHERE source_root IS NOT NULL
    GROUP BY source_root ORDER BY n DESC
  `).all();
  return { total, byMonth, roots };
}

export function getAsset(sha) {
  return getDb().prepare('SELECT * FROM assets WHERE sha256 = ?').get(sha);
}

// Phase 3A: search, favorite, archive, trash, restore, delete
// Phase 4: integrated with OCR text search
// Phase 6: integrated with tag search
export function searchAssets(query) {
  const q = `%${query}%`;
  
  // Search in assets (filename, camera)
  const assetResults = getDb().prepare(`
    SELECT DISTINCT a.* FROM assets a
    WHERE a.is_trashed = 0
      AND (a.filename LIKE @q OR a.camera LIKE @q)
    ORDER BY a.taken_at DESC
    LIMIT 100
  `).all({ q });
  
  // Search in OCR text
  const ocrResults = getDb().prepare(`
    SELECT DISTINCT a.* FROM assets a
    JOIN photo_ocr ocr ON a.sha256 = ocr.photo_id
    WHERE a.is_trashed = 0
      AND ocr.text LIKE @q
    ORDER BY a.taken_at DESC
    LIMIT 100
  `).all({ q });
  
  // Search in tags
  const tagResults = getDb().prepare(`
    SELECT DISTINCT a.* FROM assets a
    JOIN photo_tags t ON a.sha256 = t.photo_id
    WHERE a.is_trashed = 0
      AND t.tag LIKE @q
    ORDER BY a.taken_at DESC
    LIMIT 100
  `).all({ q });
  
  // Merge results (deduplicate by sha256)
  const seen = new Set();
  const merged = [];
  
  [...assetResults, ...ocrResults, ...tagResults].forEach(row => {
    if (!seen.has(row.sha256)) {
      seen.add(row.sha256);
      merged.push(row);
    }
  });
  
  return merged.slice(0, 100);
}

export function toggleFavorite(sha) {
  const asset = getAsset(sha);
  if (!asset) return null;
  const newVal = asset.is_favorite ? 0 : 1;
  getDb().prepare('UPDATE assets SET is_favorite = ? WHERE sha256 = ?').run(newVal, sha);
  return { ...asset, is_favorite: newVal };
}

export function toggleArchive(sha) {
  const asset = getAsset(sha);
  if (!asset) return null;
  const newVal = asset.is_archived ? 0 : 1;
  getDb().prepare('UPDATE assets SET is_archived = ? WHERE sha256 = ?').run(newVal, sha);
  return { ...asset, is_archived: newVal };
}

export function trashAsset(sha) {
  const asset = getAsset(sha);
  if (!asset) return null;
  getDb().prepare('UPDATE assets SET is_trashed = 1, trashed_at = ? WHERE sha256 = ?')
    .run(Date.now(), sha);
  return { ...asset, is_trashed: 1, trashed_at: Date.now() };
}

export function restoreAsset(sha) {
  const asset = getAsset(sha);
  if (!asset || !asset.is_trashed) return null;
  getDb().prepare('UPDATE assets SET is_trashed = 0, trashed_at = NULL WHERE sha256 = ?').run(sha);
  return { ...asset, is_trashed: 0, trashed_at: null };
}

export function deleteAssetPermanently(sha) {
  const asset = getAsset(sha);
  if (!asset) return null;
  if (!asset.is_trashed) throw new Error('Cannot permanently delete non-trashed asset');
  getDb().prepare('DELETE FROM assets WHERE sha256 = ?').run(sha);
  return asset;
}

export function listAssetsByFilter(filter, { cursor, limit, ratingMin, dateStart, dateEnd }) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  let whereClause = 'is_trashed = 0'; // default: library (not trashed, not archived)
  
  if (filter === 'favorites') {
    whereClause = 'is_favorite = 1 AND is_trashed = 0';
  } else if (filter === 'archive') {
    whereClause = 'is_archived = 1 AND is_trashed = 0';
  } else if (filter === 'trash') {
    whereClause = 'is_trashed = 1';
  } else if (filter === 'documents') {
    whereClause = "category = 'document' AND is_archived = 0 AND is_trashed = 0";
  } else if (filter === 'screenshots') {
    whereClause = "category = 'screenshot' AND is_archived = 0 AND is_trashed = 0";
  } else if (filter === 'businesscards') {
    whereClause = "category = 'businesscard' AND is_archived = 0 AND is_trashed = 0";
  } else if (filter === 'all') {
    whereClause = '1=1';
  } else {
    // default library: not archived and not trashed
    whereClause = 'is_archived = 0 AND is_trashed = 0';
  }
  
  // Phase 6: rating filter
  if (ratingMin !== undefined && ratingMin > 0) {
    whereClause += ` AND rating >= ${Number(ratingMin)}`;
  }

  // Date range filter (YYYY-MM-DD inclusive). Fallback to imported_at when taken_at is NULL.
  if (dateStart && /^\d{4}-\d{2}-\d{2}$/.test(dateStart)) {
    const startMs = Date.parse(dateStart + 'T00:00:00');
    if (Number.isFinite(startMs)) whereClause += ` AND COALESCE(taken_at, imported_at) >= ${startMs}`;
  }
  if (dateEnd && /^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
    const endMs = Date.parse(dateEnd + 'T23:59:59.999');
    if (Number.isFinite(endMs)) whereClause += ` AND COALESCE(taken_at, imported_at) <= ${endMs}`;
  }
  
  let rows;
  if (cursor) {
    const [tsStr, sha] = String(cursor).split('_');
    const ts = Number(tsStr) || 0;
    rows = getDb().prepare(`
      SELECT * FROM assets
      WHERE ${whereClause}
        AND ((taken_at < @ts) OR (taken_at = @ts AND sha256 > @sha))
      ORDER BY taken_at DESC, sha256 ASC
      LIMIT @lim
    `).all({ ts, sha, lim });
  } else {
    rows = getDb().prepare(`
      SELECT * FROM assets WHERE ${whereClause}
      ORDER BY taken_at DESC, sha256 ASC
      LIMIT @lim
    `).all({ lim });
  }
  
  let nextCursor = null;
  if (rows.length === lim) {
    const last = rows[rows.length - 1];
    nextCursor = `${last.taken_at || 0}_${last.sha256}`;
  }
  return { items: rows, nextCursor };
}

export function getCounts() {
  const db = getDb();
  const library = db.prepare('SELECT COUNT(*) AS n FROM assets WHERE is_archived = 0 AND is_trashed = 0').get().n;
  const favorites = db.prepare('SELECT COUNT(*) AS n FROM assets WHERE is_favorite = 1 AND is_trashed = 0').get().n;
  const archive = db.prepare('SELECT COUNT(*) AS n FROM assets WHERE is_archived = 1 AND is_trashed = 0').get().n;
  const trash = db.prepare('SELECT COUNT(*) AS n FROM assets WHERE is_trashed = 1').get().n;
  const documents = db.prepare("SELECT COUNT(*) AS n FROM assets WHERE category = 'document' AND is_archived = 0 AND is_trashed = 0").get().n;
  const screenshots = db.prepare("SELECT COUNT(*) AS n FROM assets WHERE category = 'screenshot' AND is_archived = 0 AND is_trashed = 0").get().n;
  const businesscards = db.prepare("SELECT COUNT(*) AS n FROM assets WHERE category = 'businesscard' AND is_archived = 0 AND is_trashed = 0").get().n;
  return { library, favorites, archive, trash, documents, screenshots, businesscards };
}

// Phase 7: re-classify existing assets using filename + mime + camera + aspect ratio heuristics.
// Idempotent: heuristics are deterministic and only flip 'photo'→'document'/'screenshot'.
export function reclassifyExistingAssets() {
  const db = getDb();
  // Screenshot: filename hint
  db.prepare(`
    UPDATE assets SET category = 'screenshot'
    WHERE category = 'photo'
      AND (filename LIKE 'Screenshot%' OR filename LIKE 'Screen Shot%'
           OR filename LIKE 'screencapture%' OR filename LIKE '스크린샷%'
           OR filename LIKE 'Capture%')
  `).run();
  // Screenshot: PNG with no EXIF camera (most likely a phone/desktop screen capture)
  db.prepare(`
    UPDATE assets SET category = 'screenshot'
    WHERE category = 'photo'
      AND mime = 'image/png'
      AND camera IS NULL
      AND media_type = 'image'
  `).run();
  // Screenshot: aspect-ratio heuristic — camera unknown + modest resolution + extreme aspect.
  // Catches IMG_*.jpeg-style mobile captures (e.g. 1290x2796 ar=0.46) that PNG filter misses.
  db.prepare(`
    UPDATE assets SET category = 'screenshot'
    WHERE category = 'photo'
      AND media_type = 'image'
      AND camera IS NULL
      AND width IS NOT NULL AND height IS NOT NULL
      AND height > 0 AND width < 1920
      AND (
        (CAST(width AS REAL) / height < 0.56)
        OR (CAST(width AS REAL) / height > 1.85)
      )
  `).run();
  // Document: filename hint
  db.prepare(`
    UPDATE assets SET category = 'document'
    WHERE category = 'photo'
      AND (filename LIKE 'Scan%' OR filename LIKE 'Document%' OR filename LIKE 'Doc_%'
           OR filename LIKE 'Receipt%' OR filename LIKE '문서%' OR filename LIKE '영수증%'
           OR filename LIKE '%_receipt%' OR filename LIKE '%_scan%')
  `).run();
  // Document: OCR text length ≥ 80 non-whitespace chars (catches camera-shot documents).
  // Uses cached photo_ocr rows; new uploads auto-populate via library.mjs setImmediate hook.
  db.prepare(`
    UPDATE assets SET category = 'document'
    WHERE category = 'photo'
      AND sha256 IN (
        SELECT photo_id FROM photo_ocr
        WHERE LENGTH(REPLACE(REPLACE(REPLACE(text, ' ', ''), CHAR(10), ''), CHAR(9), '')) >= 80
          AND (kind IS NULL OR kind = 'receipt')
      )
  `).run();
}

// Manual category override (user-driven correction from UI / API).
export function setAssetCategory(sha, category) {
  const allowed = new Set(['photo', 'screenshot', 'document', 'businesscard']);
  if (!allowed.has(category)) throw new Error('invalid category');
  const result = getDb().prepare('UPDATE assets SET category = ? WHERE sha256 = ?').run(category, sha);
  if (result.changes === 0) return null;
  return getAsset(sha);
}

// Phase 3B: memories, map, exif
export function getMemoriesToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();
  
  // Calculate date range: same month/day ±3 days, at least 1 year ago
  const startDate = new Date(year - 1, month, day - 3);
  const endDate = new Date(year - 1, month, day + 3);
  
  // Convert to timestamps (milliseconds)
  const startTs = startDate.getTime();
  const endTs = endDate.getTime();
  
  // Also check 2+ years ago
  const maxYearsBack = 10;
  const memories = [];
  
  for (let yearsAgo = 1; yearsAgo <= maxYearsBack; yearsAgo++) {
    const yearStartDate = new Date(year - yearsAgo, month, day - 3);
    const yearEndDate = new Date(year - yearsAgo, month, day + 3);
    const yearStartTs = yearStartDate.getTime();
    const yearEndTs = yearEndDate.getTime();
    
    const rows = getDb().prepare(`
      SELECT sha256, filename, taken_at, gps_lat, gps_lng
      FROM assets
      WHERE is_trashed = 0
        AND taken_at IS NOT NULL
        AND taken_at >= @start
        AND taken_at <= @end
      ORDER BY taken_at DESC
      LIMIT 10
    `).all({ start: yearStartTs, end: yearEndTs });
    
    rows.forEach(row => {
      memories.push({ ...row, years_ago: yearsAgo });
    });
  }
  
  return memories;
}

export function getPhotosWithGeo() {
  return getDb().prepare(`
    SELECT sha256, filename, taken_at, gps_lat, gps_lng
    FROM assets
    WHERE is_trashed = 0
      AND gps_lat IS NOT NULL
      AND gps_lng IS NOT NULL
    ORDER BY taken_at DESC
    LIMIT 1000
  `).all();
}

// Phase 3D: Albums
export function createAlbum(name) {
  if (!name || !name.trim()) throw new Error('Album name required');
  const now = Date.now();
  const result = getDb().prepare(`
    INSERT INTO albums (name, created_at, updated_at)
    VALUES (?, ?, ?)
  `).run(name.trim(), now, now);
  return getDb().prepare('SELECT * FROM albums WHERE id = ?').get(result.lastInsertRowid);
}

export function listAlbums() {
  const db = getDb();
  const albums = db.prepare('SELECT * FROM albums ORDER BY updated_at DESC').all();
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM album_assets WHERE album_id = ?');
  // Fallback cover: most-recent photo in the album when no explicit cover_sha256 is set.
  const latestStmt = db.prepare(`
    SELECT a.sha256 FROM assets a
    JOIN album_assets aa ON a.sha256 = aa.asset_sha256
    WHERE aa.album_id = ? AND a.is_trashed = 0
    ORDER BY COALESCE(a.taken_at, aa.added_at) DESC
    LIMIT 1
  `);
  return albums.map(album => {
    const photoCount = countStmt.get(album.id).n;
    let coverSha = album.cover_sha256;
    if (!coverSha && photoCount > 0) {
      const row = latestStmt.get(album.id);
      if (row && row.sha256) coverSha = row.sha256;
    }
    const coverThumbUrl = coverSha
      ? `/api/library/asset/${coverSha}/thumbnail`
      : null;
    return { ...album, photoCount, coverThumbUrl };
  });
}

export function getAlbum(id) {
  const album = getDb().prepare('SELECT * FROM albums WHERE id = ?').get(id);
  if (!album) return null;
  
  const photos = getDb().prepare(`
    SELECT a.*
    FROM assets a
    JOIN album_assets aa ON a.sha256 = aa.asset_sha256
    WHERE aa.album_id = ? AND a.is_trashed = 0
    ORDER BY aa.added_at DESC
  `).all(id);
  
  return { album, photos };
}

export function updateAlbum(id, { name, coverSha256 }) {
  const album = getDb().prepare('SELECT * FROM albums WHERE id = ?').get(id);
  if (!album) return null;
  
  const updates = [];
  const params = [];
  
  if (name !== undefined && name.trim()) {
    updates.push('name = ?');
    params.push(name.trim());
  }
  
  if (coverSha256 !== undefined) {
    updates.push('cover_sha256 = ?');
    params.push(coverSha256);
  }
  
  if (updates.length === 0) return album;
  
  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);
  
  getDb().prepare(`UPDATE albums SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getDb().prepare('SELECT * FROM albums WHERE id = ?').get(id);
}

export function deleteAlbum(id) {
  const album = getDb().prepare('SELECT * FROM albums WHERE id = ?').get(id);
  if (!album) return null;
  getDb().prepare('DELETE FROM albums WHERE id = ?').run(id);
  return album;
}

export function addPhotosToAlbum(albumId, photoIds) {
  const album = getDb().prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) throw new Error('Album not found');
  
  const now = Date.now();
  let added = 0;
  
  photoIds.forEach(sha => {
    try {
      getDb().prepare(`
        INSERT OR IGNORE INTO album_assets (album_id, asset_sha256, added_at)
        VALUES (?, ?, ?)
      `).run(albumId, sha, now);
      added++;
    } catch (e) {
      // Skip invalid sha256
    }
  });
  
  getDb().prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now, albumId);
  return { added };
}

export function removePhotosFromAlbum(albumId, photoIds) {
  const album = getDb().prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) throw new Error('Album not found');
  
  let removed = 0;
  photoIds.forEach(sha => {
    const result = getDb().prepare(
      'DELETE FROM album_assets WHERE album_id = ? AND asset_sha256 = ?'
    ).run(albumId, sha);
    removed += result.changes;
  });
  
  getDb().prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(Date.now(), albumId);
  return { removed };
}

// Phase 4: OCR
export function getOcrResult(photoId) {
  return getDb().prepare('SELECT * FROM photo_ocr WHERE photo_id = ? ORDER BY processed_at DESC LIMIT 1').get(photoId);
}

export function insertOcrResult(photoId, text, confidence, language) {
  const now = Date.now();
  return getDb().prepare(`
    INSERT INTO photo_ocr (photo_id, text, confidence, language, processed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(photoId, text, confidence, language, now);
}

export function deleteOcrResult(photoId) {
  return getDb().prepare('DELETE FROM photo_ocr WHERE photo_id = ?').run(photoId);
}

// Phase 6: Watched folders
export function listWatchedFolders() {
  return getDb().prepare('SELECT * FROM watched_folders ORDER BY added_at DESC').all();
}

export function addWatchedFolder(path) {
  const now = Date.now();
  try {
    const result = getDb().prepare(`
      INSERT INTO watched_folders (path, enabled, added_at)
      VALUES (?, 1, ?)
    `).run(path, now);
    return getDb().prepare('SELECT * FROM watched_folders WHERE id = ?').get(result.lastInsertRowid);
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      throw new Error('Folder already watched');
    }
    throw e;
  }
}

export function removeWatchedFolder(id) {
  const folder = getDb().prepare('SELECT * FROM watched_folders WHERE id = ?').get(id);
  if (!folder) return null;
  getDb().prepare('DELETE FROM watched_folders WHERE id = ?').run(id);
  return folder;
}

export function toggleWatchedFolder(id, enabled) {
  const folder = getDb().prepare('SELECT * FROM watched_folders WHERE id = ?').get(id);
  if (!folder) return null;
  getDb().prepare('UPDATE watched_folders SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return { ...folder, enabled: enabled ? 1 : 0 };
}

// Phase 6: Tags
export function getPhotoTags(photoId) {
  return getDb().prepare('SELECT tag FROM photo_tags WHERE photo_id = ? ORDER BY created_at DESC')
    .all(photoId)
    .map(row => row.tag);
}

export function addPhotoTag(photoId, tag) {
  const now = Date.now();
  try {
    getDb().prepare('INSERT INTO photo_tags (photo_id, tag, created_at) VALUES (?, ?, ?)')
      .run(photoId, tag.trim(), now);
    return { tag: tag.trim(), createdAt: now };
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      throw new Error('Tag already exists');
    }
    throw e;
  }
}

export function removePhotoTag(photoId, tag) {
  const result = getDb().prepare('DELETE FROM photo_tags WHERE photo_id = ? AND tag = ?')
    .run(photoId, tag);
  return result.changes > 0;
}

export function getAllTags() {
  return getDb().prepare(`
    SELECT tag, COUNT(*) AS count
    FROM photo_tags
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `).all();
}

// Phase 6: Rating
export function updatePhotoRating(photoId, rating) {
  if (rating < 0 || rating > 5) throw new Error('Rating must be 0-5');
  getDb().prepare('UPDATE assets SET rating = ? WHERE sha256 = ?').run(rating, photoId);
  return getAsset(photoId);
}

// Phase 6: Share links
export function createShareLink(photoId, expiresIn = null, passwordHash = null) {
  const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const now = Date.now();
  const expiresAt = expiresIn ? now + expiresIn : null;
  
  getDb().prepare('INSERT INTO share_links (token, photo_id, expires_at, created_at, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(token, photoId, expiresAt, now, passwordHash);
  
  return { token, photoId, expiresAt, createdAt: now };
}

export function getShareLink(token) {
  const link = getDb().prepare('SELECT * FROM share_links WHERE token = ?').get(token);
  if (!link) return null;
  
  // Check expiration
  if (link.expires_at && Date.now() > link.expires_at) {
    return null; // expired
  }
  
  return link;
}

export function deleteShareLink(token) {
  const link = getDb().prepare('SELECT * FROM share_links WHERE token = ?').get(token);
  if (!link) return null;
  getDb().prepare('DELETE FROM share_links WHERE token = ?').run(token);
  return link;
}

export function listShareLinks(photoId) {
  return getDb().prepare('SELECT * FROM share_links WHERE photo_id = ? ORDER BY created_at DESC')
    .all(photoId);
}

// Phase 8: Business cards
export function upsertBusinessCard(sha, parsed) {
  const db = getDb();
  const now = new Date().toISOString();
  const phones = parsed.phones ? JSON.stringify(parsed.phones) : null;
  const emails = parsed.emails ? JSON.stringify(parsed.emails) : null;
  
  db.prepare(`
    INSERT INTO business_cards (sha, name, phones, emails, company, department, position, raw_text, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sha) DO UPDATE SET
      name = excluded.name,
      phones = excluded.phones,
      emails = excluded.emails,
      company = excluded.company,
      department = excluded.department,
      position = excluded.position,
      raw_text = excluded.raw_text,
      confidence = excluded.confidence
  `).run(
    sha,
    parsed.name || null,
    phones,
    emails,
    parsed.company || null,
    parsed.department || null,
    parsed.position || null,
    parsed.rawText || null,
    parsed.confidence || 0,
    now
  );
  
  return getBusinessCard(sha);
}

export function getBusinessCard(sha) {
  const row = getDb().prepare('SELECT * FROM business_cards WHERE sha = ?').get(sha);
  if (!row) return null;
  
  return {
    sha: row.sha,
    name: row.name,
    phones: row.phones ? JSON.parse(row.phones) : [],
    emails: row.emails ? JSON.parse(row.emails) : [],
    company: row.company,
    department: row.department,
    position: row.position,
    rawText: row.raw_text,
    confidence: row.confidence,
    createdAt: row.created_at,
    syncedToHostAt: row.synced_to_host_at,
  };
}

export function listBusinessCards() {
  const rows = getDb().prepare(`
    SELECT bc.*, a.filename, a.taken_at, a.imported_at
    FROM business_cards bc
    JOIN assets a ON bc.sha = a.sha256
    WHERE a.is_trashed = 0
    ORDER BY bc.created_at DESC
  `).all();
  
  return rows.map(row => ({
    sha: row.sha,
    name: row.name,
    phones: row.phones ? JSON.parse(row.phones) : [],
    emails: row.emails ? JSON.parse(row.emails) : [],
    company: row.company,
    department: row.department,
    position: row.position,
    confidence: row.confidence,
    filename: row.filename,
    takenAt: row.taken_at,
    importedAt: row.imported_at,
    createdAt: row.created_at,
    syncedToHostAt: row.synced_to_host_at,
    thumbnailUrl: `/api/library/asset/${row.sha}/thumbnail`,
  }));
}

export function markBusinessCardSynced(sha) {
  const now = new Date().toISOString();
  getDb().prepare('UPDATE business_cards SET synced_to_host_at = ? WHERE sha = ?').run(now, sha);
}

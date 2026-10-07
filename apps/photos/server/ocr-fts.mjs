// OCR text search using FTS5 full-text index
import { getDb } from './db.mjs';

/**
 * Search photos by OCR text using FTS5 MATCH
 * @param {string} query - search query
 * @param {number} limit - max results (default 100)
 * @returns {Array} photos with OCR text
 */
export function searchOcrFts(query, limit = 100) {
  const db = getDb();
  
  if (!query || query.trim() === '') return [];
  
  // Sanitize query for FTS5 MATCH syntax
  // Split by whitespace, quote each term, join with AND
  const terms = query.trim().split(/\s+/).map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
  
  try {
    // FTS5 MATCH query (no alias for FTS5 table in MATCH clause)
    const results = db.prepare(`
      SELECT 
        po.photo_id,
        po.text,
        po.confidence,
        po.language,
        po.kind,
        a.*
      FROM photo_ocr_fts
      JOIN photo_ocr po ON photo_ocr_fts.rowid = po.id
      JOIN assets a ON po.photo_id = a.sha256
      WHERE photo_ocr_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(terms, limit);
    
    return results;
  } catch (e) {
    // Fallback to LIKE if FTS query fails
    console.error('FTS5 query failed, falling back to LIKE:', e.message);
    
    return db.prepare(`
      SELECT 
        po.photo_id,
        po.text,
        po.confidence,
        po.language,
        po.kind,
        a.*
      FROM photo_ocr po
      JOIN assets a ON po.photo_id = a.sha256
      WHERE po.text LIKE ?
      LIMIT ?
    `).all(`%${query}%`, limit);
  }
}

/**
 * Trigger OCR on import (to be called from library.mjs)
 * @param {string} photoId - sha256
 * @returns {Promise<void>}
 */
export async function autoOcrOnImport(photoId) {
  // This would trigger the OCR module (ocr.mjs)
  // For now, just a placeholder — actual implementation would:
  // 1. Check if photo is suitable for OCR (mime type, size)
  // 2. Call ocr.processOcr(photoId) asynchronously
  // 3. OCR module will insert into photo_ocr, which auto-triggers FTS sync
  
  // Implementation deferred to avoid circular dependency with ocr.mjs
  console.log(`[ocr-fts] Auto-OCR queued for ${photoId}`);
}

/**
 * Get OCR results for a photo
 * @param {string} photoId - sha256
 * @returns {Array} OCR results
 */
export function getPhotoOcr(photoId) {
  const db = getDb();
  
  return db.prepare(`
    SELECT text, confidence, language, kind, created_at
    FROM photo_ocr
    WHERE photo_id = ?
    ORDER BY created_at DESC
  `).all(photoId);
}

/**
 * Rebuild FTS5 index from scratch (maintenance command)
 * @returns {number} number of rows indexed
 */
export function rebuildFtsIndex() {
  const db = getDb();
  
  // Delete all FTS rows
  db.prepare(`DELETE FROM photo_ocr_fts`).run();
  
  // Re-insert all photo_ocr rows
  const result = db.prepare(`
    INSERT INTO photo_ocr_fts(rowid, text)
    SELECT id, text FROM photo_ocr
  `).run();
  
  return result.changes;
}

// LivePhoto / MotionPhoto pairing — match HEIC + MOV pairs
import { getDb } from './db.mjs';
import { basename, dirname, extname } from 'node:path';

/**
 * Find and link LivePhoto pairs (HEIC + MOV with same basename)
 * iOS Live Photos: same directory, same basename, .HEIC and .MOV
 * Taken within ±2 seconds
 * @returns {Promise<{paired: number}>}
 */
export async function findPairs() {
  const db = getDb();
  
  // Get all HEIC photos without a pair
  const heics = db.prepare(`
    SELECT sha256, original_path, taken_at 
    FROM assets 
    WHERE (mime = 'image/heic' OR mime = 'image/heif')
    AND (livephoto_pair_sha IS NULL OR livephoto_pair_sha = '')
  `).all();
  
  let paired = 0;
  
  for (const heic of heics) {
    const dir = dirname(heic.original_path);
    const base = basename(heic.original_path, extname(heic.original_path));
    
    // Look for matching MOV in same directory
    const mov = db.prepare(`
      SELECT sha256, taken_at 
      FROM assets 
      WHERE mime = 'video/quicktime'
      AND original_path LIKE ?
      AND (livephoto_pair_sha IS NULL OR livephoto_pair_sha = '')
    `).get(`${dir}/${base}.%`);
    
    if (!mov) continue;
    
    // Check if taken within ±2 seconds
    const timeDiff = Math.abs(heic.taken_at - mov.taken_at);
    if (timeDiff > 2000) continue; // More than 2 seconds apart
    
    // Link pair (bidirectional)
    linkPair(heic.sha256, mov.sha256);
    paired++;
  }
  
  return { paired };
}

/**
 * Link two photos as LivePhoto pair (bidirectional)
 * @param {string} shaA - first photo sha256
 * @param {string} shaB - second photo sha256
 */
export function linkPair(shaA, shaB) {
  const db = getDb();
  
  db.transaction(() => {
    db.prepare('UPDATE assets SET livephoto_pair_sha = ? WHERE sha256 = ?').run(shaB, shaA);
    db.prepare('UPDATE assets SET livephoto_pair_sha = ? WHERE sha256 = ?').run(shaA, shaB);
  })();
}

/**
 * Get LivePhoto pair info for a photo
 * @param {string} sha - photo sha256
 * @returns {object|null} pair info (motion video URL if exists)
 */
export function getPair(sha) {
  const db = getDb();
  
  const asset = db.prepare('SELECT livephoto_pair_sha FROM assets WHERE sha256 = ?').get(sha);
  if (!asset || !asset.livephoto_pair_sha) return null;
  
  const pair = db.prepare('SELECT * FROM assets WHERE sha256 = ?').get(asset.livephoto_pair_sha);
  if (!pair) return null;
  
  return {
    pair_sha: pair.sha256,
    pair_mime: pair.mime,
    stream_url: `/api/library/stream/${pair.sha256}`,
  };
}

/**
 * Unlink a LivePhoto pair
 * @param {string} sha - either photo in the pair
 */
export function unlinkPair(sha) {
  const db = getDb();
  
  const asset = db.prepare('SELECT livephoto_pair_sha FROM assets WHERE sha256 = ?').get(sha);
  if (!asset || !asset.livephoto_pair_sha) return;
  
  const pairSha = asset.livephoto_pair_sha;
  
  db.transaction(() => {
    db.prepare('UPDATE assets SET livephoto_pair_sha = NULL WHERE sha256 = ?').run(sha);
    db.prepare('UPDATE assets SET livephoto_pair_sha = NULL WHERE sha256 = ?').run(pairSha);
  })();
}

// RAW format support — decode ARW, CR2, NEF, RAF, DNG to JPEG/TIFF
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { getDb } from './db.mjs';
import { getAsset } from './db.mjs';

const RAW_EXTENSIONS = {
  '.arw': 'arw',  // Sony
  '.cr2': 'cr2',  // Canon
  '.cr3': 'cr3',  // Canon (newer)
  '.nef': 'nef',  // Nikon
  '.raf': 'raf',  // Fuji
  '.dng': 'dng',  // Adobe
  '.rw2': 'rw2',  // Panasonic
  '.orf': 'orf',  // Olympus
};

/**
 * Detect RAW variant from filename
 * @param {string} filename
 * @returns {string|null} variant name or null
 */
export function detectRawVariant(filename) {
  const ext = extname(filename).toLowerCase();
  return RAW_EXTENSIONS[ext] || null;
}

/**
 * Decode RAW file to JPEG using dcraw
 * @param {string} srcPath - path to RAW file
 * @param {string} outPath - output JPEG path
 * @returns {Promise<string>} output path
 */
export async function decodeRaw(srcPath, outPath) {
  return new Promise((resolve, reject) => {
    // dcraw -c -w -T <input> > <output>
    // -c: write to stdout
    // -w: use camera white balance
    // -T: output TIFF (can be converted to JPEG later)
    const dcraw = spawn('dcraw', ['-c', '-w', '-T', srcPath]);
    
    // Register error handler synchronously to prevent unhandled 'error' event
    dcraw.on('error', (err) => {
      reject(new Error(`dcraw not found or failed: ${err.message}`));
    });
    
    const outStream = createWriteStream(outPath);
    dcraw.stdout.pipe(outStream);
    
    dcraw.stderr.on('data', (data) => {
      console.error(`dcraw stderr: ${data}`);
    });
    
    dcraw.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`dcraw exited with code ${code}`));
      } else {
        resolve(outPath);
      }
    });
  });
}

/**
 * Get or create decoded preview for RAW photo
 * @param {string} photoId - sha256
 * @returns {Promise<string|null>} decoded path or null if not RAW
 */
export async function getRawPreview(photoId) {
  const db = getDb();
  const asset = getAsset(photoId);
  
  if (!asset) throw new Error('Photo not found');
  if (!asset.raw_variant) return null; // Not a RAW file
  
  // Check if already decoded
  if (asset.raw_decoded_path) {
    return asset.raw_decoded_path;
  }
  
  // Decode now
  const decodedDir = join(process.cwd(), 'data', 'raw-decoded');
  const decodedFilename = `${photoId.slice(0, 2)}/${photoId}.tiff`;
  const decodedPath = join(decodedDir, decodedFilename);
  
  // Ensure directory exists
  mkdirSync(dirname(decodedPath), { recursive: true });
  
  try {
    await decodeRaw(asset.original_path, decodedPath);
    
    // Update DB
    db.prepare(`
      UPDATE assets SET raw_decoded_path = ? WHERE sha256 = ?
    `).run(decodedPath, photoId);
    
    return decodedPath;
  } catch (e) {
    console.error(`Failed to decode RAW ${photoId}:`, e.message);
    
    // Mark as error by setting raw_decoded_path to empty string
    db.prepare(`
      UPDATE assets SET raw_decoded_path = '' WHERE sha256 = ?
    `).run(photoId);
    
    return null;
  }
}

/**
 * Batch process RAW files that haven't been decoded
 * @param {number} limit - max number to process
 * @returns {Promise<{processed: number, failed: number}>}
 */
export async function batchDecodeRaw(limit = 50) {
  const db = getDb();
  
  const undecoded = db.prepare(`
    SELECT sha256 FROM assets 
    WHERE raw_variant IS NOT NULL 
    AND (raw_decoded_path IS NULL OR raw_decoded_path = '')
    LIMIT ?
  `).all(limit);
  
  let processed = 0;
  let failed = 0;
  
  for (const row of undecoded) {
    try {
      await getRawPreview(row.sha256);
      processed++;
    } catch (e) {
      failed++;
    }
  }
  
  return { processed, failed };
}

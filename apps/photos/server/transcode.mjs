// Video transcoding — create h264 mp4 proxies for compatibility
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getDb } from './db.mjs';
import { getAsset } from './db.mjs';

let isProcessing = false;

/**
 * Add a video to the transcode queue
 * @param {string} photoId - sha256 of video
 */
export function enqueueTranscode(photoId) {
  const db = getDb();
  
  db.prepare(`
    UPDATE assets 
    SET proxy_status = 'pending' 
    WHERE sha256 = ? AND mime LIKE 'video/%'
  `).run(photoId);
}

/**
 * Transcode a single video to h264 mp4 proxy
 * @param {string} photoId - sha256
 * @returns {Promise<string>} proxy path
 */
async function transcodeVideo(photoId) {
  const db = getDb();
  const asset = getAsset(photoId);
  
  if (!asset) throw new Error('Video not found');
  if (!asset.mime.startsWith('video/')) throw new Error('Not a video');
  
  // Output path: data/proxies/<sha[0:2]>/<sha>.mp4
  const proxyDir = join(process.cwd(), 'data', 'proxies', photoId.slice(0, 2));
  mkdirSync(proxyDir, { recursive: true });
  const proxyPath = join(proxyDir, `${photoId}.mp4`);
  
  return new Promise((resolve, reject) => {
    // ffmpeg -i <input> -vf scale=1920:-2 -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k <output>
    const ffmpeg = spawn('ffmpeg', [
      '-i', asset.original_path,
      '-vf', 'scale=1920:-2', // Max 1080p width, keep aspect ratio
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart', // Web streaming optimization
      '-y', // Overwrite
      proxyPath,
    ]);
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('error', (err) => {
      reject(new Error(`ffmpeg not found: ${err.message}`));
    });
    
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      } else {
        // Update DB
        db.prepare(`
          UPDATE assets 
          SET proxy_status = 'done', 
              proxy_path = ?,
              proxy_codec = 'h264'
          WHERE sha256 = ?
        `).run(proxyPath, photoId);
        
        resolve(proxyPath);
      }
    });
  });
}

/**
 * Process transcode queue (single worker, runs one at a time)
 * @returns {Promise<{processed: number, failed: number}>}
 */
export async function processQueue() {
  if (isProcessing) {
    return { processed: 0, failed: 0, skipped: 'already running' };
  }
  
  isProcessing = true;
  
  const db = getDb();
  let processed = 0;
  let failed = 0;
  
  try {
    while (true) {
      // Get next pending video
      const next = db.prepare(`
        SELECT sha256 FROM assets 
        WHERE proxy_status = 'pending'
        LIMIT 1
      `).get();
      
      if (!next) break; // Queue empty
      
      try {
        await transcodeVideo(next.sha256);
        processed++;
      } catch (e) {
        console.error(`Transcode failed for ${next.sha256}:`, e.message);
        
        // Mark as error
        db.prepare(`
          UPDATE assets 
          SET proxy_status = 'error' 
          WHERE sha256 = ?
        `).run(next.sha256);
        
        failed++;
      }
    }
  } finally {
    isProcessing = false;
  }
  
  return { processed, failed };
}

/**
 * Get proxy path for a video (or null if not ready)
 * @param {string} photoId - sha256
 * @returns {string|null} proxy path or null
 */
export function getProxyPath(photoId) {
  const db = getDb();
  
  const asset = db.prepare(`
    SELECT proxy_status, proxy_path 
    FROM assets 
    WHERE sha256 = ?
  `).get(photoId);
  
  if (!asset || asset.proxy_status !== 'done') return null;
  
  return asset.proxy_path;
}

/**
 * Retry failed transcodes
 * @returns {number} number of videos re-queued
 */
export function retryFailed() {
  const db = getDb();
  
  const result = db.prepare(`
    UPDATE assets 
    SET proxy_status = 'pending' 
    WHERE proxy_status = 'error'
  `).run();
  
  return result.changes;
}

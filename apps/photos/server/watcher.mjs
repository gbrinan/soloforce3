// Folder watcher — auto-import new photos via chokidar.
import chokidar from 'chokidar';
import { existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { listWatchedFolders } from './db.mjs';
import { importFolder } from './library.mjs';

const watchers = new Map(); // path -> FSWatcher
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp'];
const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

export function startWatchers(rootDir, bus) {
  const folders = listWatchedFolders().filter(f => f.enabled);
  
  folders.forEach(folder => {
    if (watchers.has(folder.path)) return; // already watching
    
    if (!existsSync(folder.path)) {
      console.warn(`[watcher] path not found: ${folder.path}`);
      return;
    }
    
    const stat = statSync(folder.path);
    if (!stat.isDirectory()) {
      console.warn(`[watcher] not a directory: ${folder.path}`);
      return;
    }
    
    console.log(`[watcher] start watching: ${folder.path}`);
    
    const watcher = chokidar.watch(folder.path, {
      persistent: true,
      ignoreInitial: true, // don't import existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 2000, // wait 2s after last change
        pollInterval: 100,
      },
    });
    
    watcher.on('add', async (filePath) => {
      const ext = extname(filePath).toLowerCase();
      if (!IMAGE_EXTS.includes(ext) && !VIDEO_EXTS.includes(ext)) {
        return; // skip non-media files
      }
      
      console.log(`[watcher] new file detected: ${filePath}`);
      
      try {
        // Import single file by importing its parent folder (non-recursive)
        const result = await importFolder(rootDir, {
          path: folder.path,
          recursive: false,
        });
        
        if (result.imported > 0) {
          console.log(`[watcher] imported ${result.imported} file(s) from ${folder.path}`);
          bus.broadcast({
            type: 'library.imported',
            payload: { count: result.imported, source: 'watcher', path: filePath },
          });
        }
      } catch (e) {
        console.error(`[watcher] import failed for ${filePath}:`, e.message);
      }
    });
    
    watcher.on('error', (err) => {
      console.error(`[watcher] error for ${folder.path}:`, err.message);
    });
    
    watchers.set(folder.path, watcher);
  });
}

export function stopWatcher(path) {
  const watcher = watchers.get(path);
  if (!watcher) return false;
  
  watcher.close();
  watchers.delete(path);
  console.log(`[watcher] stopped watching: ${path}`);
  return true;
}

export function stopAllWatchers() {
  watchers.forEach((watcher, path) => {
    watcher.close();
    console.log(`[watcher] stopped: ${path}`);
  });
  watchers.clear();
}

export function getActiveWatchers() {
  return Array.from(watchers.keys());
}

process.on('SIGTERM', stopAllWatchers);
process.on('SIGINT', stopAllWatchers);

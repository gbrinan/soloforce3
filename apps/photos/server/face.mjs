// Phase 5B: Face recognition — detect, cluster, manage people
// [지연 로딩] face-api/tfjs-node는 네이티브 ML 런타임 의존이라 이 환경(Node v24, VS 미설치)에서
// 로드에 실패할 수 있다. 최상위 정적 import는 서버 기동 자체를 막으므로, 실제 얼굴검색 호출
// 시점에만 동적 import한다. 실패 시 해당 기능만 비활성되고 나머지 사진 앱은 정상 동작한다.
let faceapi = null;
import { getDb } from './db.mjs';
import { getAsset } from './db.mjs';
import { createCanvas, loadImage } from 'canvas';
import { join } from 'node:path';

let modelsLoaded = false;

/**
 * Lazy load face-api models (128d descriptor)
 * Models should be in models/ directory at project root
 */
async function ensureFaceApi() {
  if (faceapi) return faceapi;
  try {
    faceapi = await import('@vladmandic/face-api');
  } catch (e) {
    throw new Error(`얼굴검색 비활성: face-api/tfjs 런타임을 로드할 수 없습니다(이 환경에 네이티브 TensorFlow 미설치). ${e.message}`);
  }
  return faceapi;
}

async function ensureModelsLoaded() {
  if (modelsLoaded) return;
  await ensureFaceApi();
  try {
    const modelPath = join(process.cwd(), 'models');
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
    modelsLoaded = true;
  } catch (e) {
    throw new Error(`Face-api models not found. Download models to ./models/ directory. Error: ${e.message}`);
  }
}

/**
 * Detect faces in a photo and store embeddings + bboxes
 * @param {string} photoId - sha256 of photo
 * @returns {Promise<Array>} detected faces with bboxes and embeddings
 */
export async function detectFaces(photoId) {
  await ensureModelsLoaded();
  
  const asset = getAsset(photoId);
  if (!asset) throw new Error('Photo not found');
  
  // Load image from original_path
  const img = await loadImage(asset.original_path);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  // Detect faces with landmarks and descriptors (128d)
  const detections = await faceapi
    .detectAllFaces(canvas)
    .withFaceLandmarks()
    .withFaceDescriptors();
  
  if (!detections || detections.length === 0) {
    return [];
  }
  
  const db = getDb();
  const now = Date.now();
  const faces = [];
  
  for (const detection of detections) {
    const box = detection.detection.box;
    const descriptor = detection.descriptor; // Float32Array(128)
    
    // Normalize bbox to 0-1 range
    const bbox_x = box.x / img.width;
    const bbox_y = box.y / img.height;
    const bbox_w = box.width / img.width;
    const bbox_h = box.height / img.height;
    
    // Serialize Float32Array to Buffer
    const embeddingBuffer = Buffer.from(descriptor.buffer);
    
    // Insert into photo_faces
    const result = db.prepare(`
      INSERT INTO photo_faces (photo_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, embedding, detected_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(photoId, bbox_x, bbox_y, bbox_w, bbox_h, embeddingBuffer, now);
    
    faces.push({
      id: result.lastInsertRowid,
      bbox: { x: bbox_x, y: bbox_y, w: bbox_w, h: bbox_h },
      embedding: descriptor,
    });
  }
  
  return faces;
}

/**
 * DBSCAN clustering for face embeddings
 * @param {Array<{id, embedding}>} faces
 * @param {number} eps - distance threshold (default 0.6)
 * @param {number} minPts - minimum points per cluster (default 3)
 * @returns {Array<Array<number>>} clusters of face IDs
 */
function dbscan(faces, eps = 0.6, minPts = 3) {
  const n = faces.length;
  const visited = new Array(n).fill(false);
  const clusters = [];
  
  // Euclidean distance between two embeddings
  function distance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
  
  // Get neighbors within eps
  function getNeighbors(idx) {
    const neighbors = [];
    for (let i = 0; i < n; i++) {
      if (i !== idx && distance(faces[idx].embedding, faces[i].embedding) <= eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  }
  
  // Expand cluster
  function expandCluster(idx, neighbors, cluster) {
    cluster.push(idx);
    visited[idx] = true;
    
    for (let i = 0; i < neighbors.length; i++) {
      const neighborIdx = neighbors[i];
      if (!visited[neighborIdx]) {
        visited[neighborIdx] = true;
        const neighborNeighbors = getNeighbors(neighborIdx);
        if (neighborNeighbors.length >= minPts) {
          neighbors.push(...neighborNeighbors);
        }
      }
      
      if (!cluster.includes(neighborIdx)) {
        cluster.push(neighborIdx);
      }
    }
  }
  
  // Main DBSCAN loop
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    
    const neighbors = getNeighbors(i);
    if (neighbors.length < minPts) {
      visited[i] = true; // Mark as noise
      continue;
    }
    
    const cluster = [];
    expandCluster(i, neighbors, cluster);
    clusters.push(cluster.map(idx => faces[idx].id));
  }
  
  return clusters;
}

/**
 * Cluster all unassigned faces into people
 * Uses DBSCAN with eps=0.6, minPts=3
 * @returns {Promise<{clustered: number, people: number}>}
 */
export async function clusterFaces() {
  const db = getDb();
  
  // Get all faces without person_id
  const unassigned = db.prepare(`
    SELECT id, embedding FROM photo_faces WHERE person_id IS NULL
  `).all();
  
  if (unassigned.length === 0) {
    return { clustered: 0, people: 0 };
  }
  
  // Deserialize embeddings
  const faces = unassigned.map(face => ({
    id: face.id,
    embedding: new Float32Array(face.embedding.buffer, face.embedding.byteOffset, 128),
  }));
  
  // Run DBSCAN
  const clusters = dbscan(faces, 0.6, 3);
  
  // Create people for each cluster
  const now = Date.now();
  let peopleCreated = 0;
  let facesAssigned = 0;
  
  for (const cluster of clusters) {
    // Create person
    const personResult = db.prepare(`
      INSERT INTO people (name, cover_photo_id, created_at, updated_at)
      VALUES (NULL, NULL, ?, ?)
    `).run(now, now);
    
    const personId = personResult.lastInsertRowid;
    peopleCreated++;
    
    // Assign faces to person
    for (const faceId of cluster) {
      db.prepare('UPDATE photo_faces SET person_id = ? WHERE id = ?').run(personId, faceId);
      facesAssigned++;
    }
    
    // Set cover photo (first face in cluster)
    const firstFace = db.prepare('SELECT photo_id FROM photo_faces WHERE id = ?').get(cluster[0]);
    if (firstFace) {
      db.prepare('UPDATE people SET cover_photo_id = ? WHERE id = ?').run(firstFace.photo_id, personId);
    }
  }
  
  return { clustered: facesAssigned, people: peopleCreated };
}

/**
 * Rename a person
 * @param {number} personId
 * @param {string} name
 * @returns {object} updated person
 */
export function renamePerson(personId, name) {
  const db = getDb();
  const now = Date.now();
  
  db.prepare('UPDATE people SET name = ?, updated_at = ? WHERE id = ?').run(name, now, personId);
  
  return db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
}

/**
 * Merge two people (move all faces from src to dst, delete src)
 * @param {number} srcId - source person ID (will be deleted)
 * @param {number} dstId - destination person ID
 * @returns {object} result
 */
export function mergePeople(srcId, dstId) {
  const db = getDb();
  
  // Transaction: move faces + delete src
  db.transaction(() => {
    db.prepare('UPDATE photo_faces SET person_id = ? WHERE person_id = ?').run(dstId, srcId);
    db.prepare('DELETE FROM people WHERE id = ?').run(srcId);
    db.prepare('UPDATE people SET updated_at = ? WHERE id = ?').run(Date.now(), dstId);
  })();
  
  return { merged: true, from: srcId, to: dstId };
}

/**
 * Get photos of a person (JOIN photo_faces + assets)
 * @param {number} personId
 * @param {number} limit
 * @param {number} offset
 * @returns {Array} photos with face bboxes
 */
export function getPersonPhotos(personId, limit = 50, offset = 0) {
  const db = getDb();
  
  const photos = db.prepare(`
    SELECT 
      a.*,
      pf.id AS face_id,
      pf.bbox_x,
      pf.bbox_y,
      pf.bbox_w,
      pf.bbox_h
    FROM assets a
    JOIN photo_faces pf ON a.sha256 = pf.photo_id
    WHERE pf.person_id = ?
    ORDER BY a.taken_at DESC
    LIMIT ? OFFSET ?
  `).all(personId, limit, offset);
  
  return photos;
}

/**
 * Delete a person (faces become unassigned, ON DELETE SET NULL)
 * @param {number} personId
 * @returns {object} deleted person
 */
export function deletePerson(personId) {
  const db = getDb();
  
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!person) return null;
  
  db.prepare('DELETE FROM people WHERE id = ?').run(personId);
  
  return person;
}

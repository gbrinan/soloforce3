// Phase 5A: CLIP semantic search — text-to-image similarity.
// Direct model + tokenizer/processor: the `feature-extraction` pipeline on a
// CLIP repo defaults to the vision encoder (model.onnx) and rejects text-only
// input with "Missing the following inputs: pixel_values". Use the dedicated
// CLIPTextModelWithProjection / CLIPVisionModelWithProjection classes so text
// and image paths load independent ONNX graphs (text_model.onnx / vision_model.onnx).
import {
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@xenova/transformers';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.mjs';
import { getAsset } from './db.mjs';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Uploads keep a tmp original_path that is unlinked after ingest — fall back
// to the content-addressed copy under data/originals/<sha[0:2]>/<sha><ext>.
function resolveImagePath(asset) {
  if (asset.original_path && existsSync(asset.original_path)) return asset.original_path;
  const ext = extname(asset.original_path || '').toLowerCase();
  const managed = join(ROOT, 'data', 'originals', asset.sha256.slice(0, 2), asset.sha256 + ext);
  if (existsSync(managed)) return managed;
  throw new Error(`Original file missing for ${asset.sha256.slice(0, 12)}`);
}

let visionModel = null;
let visionProcessor = null;
let textModel = null;
let textTokenizer = null;

async function ensureImagePipe() {
  if (visionModel && visionProcessor) return { model: visionModel, processor: visionProcessor };
  try {
    visionProcessor = await AutoProcessor.from_pretrained(MODEL_ID);
    visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
    return { model: visionModel, processor: visionProcessor };
  } catch (e) {
    throw new Error(`Failed to load CLIP image encoder: ${e.message}`);
  }
}

async function ensureTextPipe() {
  if (textModel && textTokenizer) return { model: textModel, tokenizer: textTokenizer };
  try {
    textTokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
    return { model: textModel, tokenizer: textTokenizer };
  } catch (e) {
    throw new Error(`Failed to load CLIP text encoder: ${e.message}`);
  }
}

function l2NormalizeInPlace(arr) {
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < arr.length; i++) arr[i] /= norm;
  }
  return arr;
}

/**
 * Embed a photo using CLIP image encoder.
 * @param {string} photoId - sha256 of photo
 * @returns {Promise<Float32Array>} 512-dim L2-normalized embedding
 */
export async function embedPhoto(photoId) {
  const { model, processor } = await ensureImagePipe();
  const db = getDb();

  const asset = getAsset(photoId);
  if (!asset) throw new Error('Photo not found');

  const image = await RawImage.read(resolveImagePath(asset));
  const imageInputs = await processor(image);
  const { image_embeds } = await model(imageInputs);

  const embeddingArray = l2NormalizeInPlace(new Float32Array(image_embeds.data));
  const embeddingBuffer = Buffer.from(embeddingArray.buffer);
  const now = Date.now();

  db.prepare(`
    INSERT INTO photo_embeddings (photo_id, embedding, model, created_at)
    VALUES (?, ?, 'clip-vit-base-patch32', ?)
    ON CONFLICT(photo_id) DO UPDATE SET
      embedding = excluded.embedding,
      created_at = excluded.created_at
  `).run(photoId, embeddingBuffer, now);

  return embeddingArray;
}

/**
 * Embed text query using CLIP text encoder.
 * @param {string} query - natural language query
 * @returns {Promise<Float32Array>} 512-dim L2-normalized embedding
 */
export async function embedText(query) {
  const { model, tokenizer } = await ensureTextPipe();

  const textInputs = tokenizer([query], { padding: true, truncation: true });
  const { text_embeds } = await model(textInputs);

  return l2NormalizeInPlace(new Float32Array(text_embeds.data));
}

/**
 * Cosine similarity between two embeddings (assumes both L2-normalized).
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} similarity score (-1..1)
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Search photos by semantic similarity to text query.
 * @param {string} query - natural language query
 * @param {number} topK - number of results (default 50)
 * @returns {Promise<Array>} photos sorted by similarity score
 */
export async function search(query, topK = 50) {
  const db = getDb();

  const queryEmbedding = await embedText(query);

  const embeddings = db.prepare(`
    SELECT photo_id, embedding FROM photo_embeddings
  `).all();

  if (embeddings.length === 0) {
    return [];
  }

  const scores = embeddings.map((row) => {
    const photoEmbedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, 512);
    const score = cosineSimilarity(queryEmbedding, photoEmbedding);
    return { photo_id: row.photo_id, score };
  });

  scores.sort((a, b) => b.score - a.score);
  const topResults = scores.slice(0, topK);

  const photoIds = topResults.map((r) => r.photo_id);
  const placeholders = photoIds.map(() => '?').join(',');

  const photos = db.prepare(`
    SELECT * FROM assets WHERE sha256 IN (${placeholders})
  `).all(...photoIds);

  const photoMap = new Map(photos.map((p) => [p.sha256, p]));

  return topResults
    .map((r) => ({ ...photoMap.get(r.photo_id), similarity_score: r.score }))
    .filter((p) => p.sha256);
}

/**
 * Batch embed photos that don't have embeddings yet.
 * @param {number} limit - max number of photos to process (default 100)
 * @returns {Promise<{processed: number, failed: number}>}
 */
export async function batchEmbed(limit = 100) {
  const db = getDb();

  const unembed = db.prepare(`
    SELECT sha256 FROM assets
    WHERE sha256 NOT IN (SELECT photo_id FROM photo_embeddings)
    AND mime LIKE 'image/%'
    LIMIT ?
  `).all(limit);

  let processed = 0;
  let failed = 0;

  for (const row of unembed) {
    try {
      await embedPhoto(row.sha256);
      processed++;
    } catch (e) {
      console.error(`Failed to embed photo ${row.sha256}:`, e.message);
      failed++;
    }
  }

  return { processed, failed };
}

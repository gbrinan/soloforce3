import { supabase } from './supabase';
import { getUserId } from './auth';

async function toWebP(file: File, maxPx = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
}

export async function uploadPhoto(file: File, featureId: string): Promise<string | null> {
  if (!supabase) return null;
  const userId = getUserId();
  if (!userId) return null;

  try {
    const webp = await toWebP(file);
    const path = `${userId}/${featureId}.webp`;
    const { error } = await supabase.storage
      .from('mymaps-photos')
      .upload(path, webp, { upsert: true, contentType: 'image/webp' });
    if (error) return null;
    const { data } = supabase.storage.from('mymaps-photos').getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

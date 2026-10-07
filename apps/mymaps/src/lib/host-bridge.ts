export interface PlaceAttachment {
  type: 'place';
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  color?: string;
  featureId?: string;
}

export function postToHost(type: string, payload: unknown): void {
  try {
    window.parent.postMessage({ source: 'mycrew-mymaps', type, payload }, '*');
  } catch { /* cross-origin sandbox — silent */ }
}

export function sendPlaceToChat(place: PlaceAttachment): void {
  postToHost('mymaps:place-attach', { attachment: place });
}

export function onAddPlace(callback: (place: PlaceAttachment) => void): () => void {
  const handler = (e: MessageEvent) => {
    if (!e.data || e.data.source !== 'mycrew-host') return;
    if (e.data.type !== 'mymaps:add-place') return;
    const p = e.data.payload as PlaceAttachment;
    if (p?.name) callback(p);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

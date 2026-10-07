// Client helpers for AI features. Backend: /ai/* endpoints in mymaps-static-server.mjs
// (local Claude CLI, no paid API). Coordinate refinement: free keyless Nominatim.
import { nominatim, SEARCH_LANG } from './search';
import { haversineKm } from './route';
import { t } from '../i18n';

export type AiPlace = { name: string; lat: number; lng: number; note?: string; geocode?: string };

const BASE = (import.meta.env.BASE_URL as string | undefined) ?? '/';
const api = (path: string) => (BASE.endsWith('/') ? BASE : `${BASE}/`) + path;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? t('ai.reqFailStatus', { status: res.status }));
  return data;
}

// Refine an approximate AI coordinate via Nominatim; keep the AI guess when
// geocoding misses or lands implausibly far (>200 km) from it.
async function refineCoords(p: AiPlace): Promise<AiPlace> {
  try {
    const results = await nominatim(p.geocode || p.name);
    const hit = results[0];
    if (!hit) return p;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return { ...p, lat: hit.lat, lng: hit.lng };
    if (haversineKm(p, hit) <= 200) return { ...p, lat: hit.lat, lng: hit.lng };
    return p;
  } catch {
    return p;
  }
}

export async function suggestPlaces(query: string): Promise<AiPlace[]> {
  const { places } = await post<{ places: AiPlace[] }>('ai/places', { query });
  const valid = (Array.isArray(places) ? places : []).filter(
    (p) => p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  // Sequential refinement respects Nominatim's 1 req/s policy (throttled in search.ts)
  const out: AiPlace[] = [];
  for (const p of valid) out.push(await refineCoords(p));
  return out;
}

// Natural language → layer plan. Geocoding happens separately via search.ts
// so the search-language clamp (ko/en/ja) applies uniformly.
export type AiLayerPlan = { layerName: string; region: string; color: string; queries: string[] };

export async function parseLayerRequest(query: string): Promise<AiLayerPlan> {
  const plan = await post<AiLayerPlan>('ai/layer', { query, lang: SEARCH_LANG });
  const queries = (Array.isArray(plan.queries) ? plan.queries : []).filter(
    (q): q is string => typeof q === 'string' && q.trim().length > 0,
  );
  if (!queries.length) throw new Error(t('ai.noQueries'));
  return {
    layerName: typeof plan.layerName === 'string' && plan.layerName.trim() ? plan.layerName.trim() : query,
    region: typeof plan.region === 'string' ? plan.region : '',
    color: typeof plan.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(plan.color) ? plan.color : '#6366F1',
    queries,
  };
}

export async function completeNote(input: { name: string; address?: string; lat?: number; lng?: number }): Promise<string> {
  const { note } = await post<{ note: string }>('ai/note', input);
  return note;
}

export type SearchResult = { name: string; address: string; lat: number; lng: number };

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const NOM = 'https://nominatim.openstreetmap.org/search';
const PHOTON = 'https://photon.komoot.io/api';

const BROWSER_LANG = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en').split('-')[0];
// 검색 언어는 마이크루 지원 언어(ko/en/ja)로 클램프 — 그 외 브라우저 언어는 en.
// Google textQuery 매칭 자체는 언어 무관, languageCode는 결과 표기 언어를 결정한다.
const APP_LANGS = new Set(['ko', 'en', 'ja']);
export const SEARCH_LANG = APP_LANGS.has(BROWSER_LANG) ? BROWSER_LANG : 'en';
const PHOTON_SUPPORTED_LANGS = new Set(['en', 'de', 'fr', 'it']);
const PHOTON_LANG = PHOTON_SUPPORTED_LANGS.has(BROWSER_LANG) ? BROWSER_LANG : 'en';

type GooglePlace = {
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
};

async function googlePlaces(q: string): Promise<SearchResult[]> {
  if (!GOOGLE_KEY) throw new Error('no google key');
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({ textQuery: q, languageCode: SEARCH_LANG, maxResultCount: 8 }),
  });
  if (!res.ok) throw new Error(`google places error: ${res.status} ${await res.text()}`);
  const data: { places?: GooglePlace[] } = await res.json();
  return (data.places ?? []).map((p) => ({
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
  }));
}

let _lastNom = 0;

export async function nominatim(q: string): Promise<SearchResult[]> {
  const wait = 1000 - (Date.now() - _lastNom);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastNom = Date.now();
  const acceptLanguage = SEARCH_LANG === 'en' ? 'en' : `${SEARCH_LANG},en;q=0.7`;
  const res = await fetch(
    `${NOM}?q=${encodeURIComponent(q)}&format=json&limit=8&accept-language=${encodeURIComponent(acceptLanguage)}`,
    { headers: { 'User-Agent': 'mycrew-mymaps/0.1' } },
  );
  if (!res.ok) throw new Error('nominatim error');
  const data: Array<{ name?: string; display_name: string; lat: string; lon: string }> = await res.json();
  return data.map((d) => ({ name: d.name ?? '', address: d.display_name, lat: +d.lat, lng: +d.lon }));
}

async function photon(q: string): Promise<SearchResult[]> {
  const res = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=8&lang=${PHOTON_LANG}`);
  if (!res.ok) throw new Error('photon error');
  const data: { features?: Array<{ properties: Record<string, string>; geometry: { coordinates: [number, number] } }> } =
    await res.json();
  return (data.features ?? []).map((f) => ({
    name: f.properties.name ?? '',
    address: [f.properties.housenumber, f.properties.street, f.properties.city, f.properties.country]
      .filter(Boolean)
      .join(', '),
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function search(query: string): Promise<SearchResult[]> {
  try {
    const results = await googlePlaces(query);
    if (results.length > 0) return results;
  } catch (err) {
    console.warn('[mymaps search] Google Places unavailable, falling back to free providers:', err);
  }

  const [nomRes, photonRes] = await Promise.allSettled([nominatim(query), photon(query)]);
  const nom = nomRes.status === 'fulfilled' ? nomRes.value : [];
  const pho = photonRes.status === 'fulfilled' ? photonRes.value : [];
  return dedupe([...nom, ...pho]).slice(0, 8);
}

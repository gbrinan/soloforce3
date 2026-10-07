export type MapEngine = 'google' | 'maplibre';
export const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

function monthKey(): string {
  const d = new Date();
  return `mm-gl-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthlyLoadCount(): number {
  return Number(localStorage.getItem(monthKey()) ?? 0);
}

export function incrementLoadCount(): void {
  const k = monthKey();
  localStorage.setItem(k, String(Number(localStorage.getItem(k) ?? 0) + 1));
}

export function selectEngine(_offline = false): MapEngine {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    console.info('[mapEngine] navigator.onLine=false → maplibre');
    return 'maplibre';
  }
  if (!GOOGLE_KEY) {
    console.info('[mapEngine] GOOGLE_KEY missing → maplibre');
    return 'maplibre';
  }
  console.info('[mapEngine] → google (count=' + getMonthlyLoadCount() + ')');
  return 'google';
}

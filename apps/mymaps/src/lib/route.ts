// Pure-algorithm route optimizer: nearest-neighbor construction + 2-opt improvement.
// Open path (no return to start); distances are straight-line haversine (km).

export type RoutePoint = { id: string; name: string; lat: number; lng: number };
export type RouteResult = { order: RoutePoint[]; totalKm: number };

const EARTH_R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function pathKm(pts: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1], pts[i]);
  return total;
}

export function optimizeRoute(points: RoutePoint[]): RouteResult {
  if (points.length <= 2) return { order: [...points], totalKm: pathKm(points) };

  // Nearest-neighbor tour starting from the first point
  const remaining = points.slice(1);
  const route: RoutePoint[] = [points[0]];
  while (remaining.length) {
    const last = route[route.length - 1];
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(last, remaining[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    route.push(remaining.splice(best, 1)[0]);
  }

  // 2-opt: reverse segments while it shortens the open path
  const n = route.length;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const before = haversineKm(route[i - 1], route[i]) + (j < n - 1 ? haversineKm(route[j], route[j + 1]) : 0);
        const after = haversineKm(route[i - 1], route[j]) + (j < n - 1 ? haversineKm(route[i], route[j + 1]) : 0);
        if (after + 1e-9 < before) {
          for (let a = i, b = j; a < b; a++, b--) {
            const tmp = route[a];
            route[a] = route[b];
            route[b] = tmp;
          }
          improved = true;
        }
      }
    }
  }
  return { order: route, totalKm: pathKm(route) };
}

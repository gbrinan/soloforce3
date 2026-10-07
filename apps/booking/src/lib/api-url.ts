const BP = (process.env.NEXT_PUBLIC_BASE_PATH || "/api/apps/booking/proxy").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BP}${path}`;
}

export function pageUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BP}${path}`;
}

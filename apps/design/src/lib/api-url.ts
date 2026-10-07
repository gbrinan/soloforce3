// basePath-aware URL helper for client fetch / asset srcs.
// Next.js basePath is applied to <Link>/router but NOT to bare fetch() calls.
// Fallback MUST mirror next.config.ts's basePath fallback: when NEXT_PUBLIC_BASE_PATH
// is unset at build time, next.config still applies "/api/apps/design/proxy", so
// client fetches need the same prefix or they 404 against the portal root.
const BP = (process.env.NEXT_PUBLIC_BASE_PATH || "/api/apps/design/proxy").replace(/\/+$/, "");

/** Returns an absolute URL path with basePath prefix. */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BP}${path}`;
}

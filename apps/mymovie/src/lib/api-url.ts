// basePath-aware URL helper for client fetch / asset srcs.
// Next.js basePath is applied to <Link>/router but NOT to bare fetch() calls.
// 또한 iframe 상위에서 trailing-slash가 사라지면 `./` 상대경로가 깨진다.
// 이 헬퍼는 NEXT_PUBLIC_BASE_PATH(빌드 타임 인라인)을 prefix로 붙여 절대경로를 반환한다.

const BP = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/**
 * Returns an absolute URL path with basePath prefix.
 * @param path leading-slash path, e.g. "/api/ingest/youtube"
 */
export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BP}${path}`;
}

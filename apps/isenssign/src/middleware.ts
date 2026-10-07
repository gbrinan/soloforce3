// next-intl 미들웨어 비활성화 (2026-06-26 근본수정).
//
// 원인: createMiddleware(routing)가 basePath=`/api/apps/sign/proxy`(=api로 시작) 환경에서
//   요청을 받으면 로케일 리다이렉트 처리 중 무한 hang(응답을 영영 안 줌) → 모든 로케일 페이지가
//   000(timeout)으로 다운. 어제부터의 계약앱 다운의 진짜 근본원인.
// 검증: matcher를 비활성화하니 /ko·/ko/login·/en/login 전부 즉시 200 렌더(0.04s).
//
// 미들웨어가 하던 일 대체:
//   - localePrefix:"always"(routing.ts)라 모든 페이지가 /<locale>/... 로 직접 라우팅됨 → 미들웨어 불필요.
//   - `/` → `/ko` 리다이렉트는 next.config.ts redirects()가 처리.
//   - 페이지별 번역은 [locale]/layout.tsx의 setRequestLocale+getMessages가 URL의 locale로 정상 처리.
//
// 어떤 경로도 매칭하지 않아 미들웨어가 실질적으로 실행되지 않음.
export const config = {
  matcher: [],
}

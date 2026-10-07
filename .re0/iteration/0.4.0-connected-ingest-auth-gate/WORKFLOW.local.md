# Connected ingest auth gate workflow

1. 기존 `ssoMiddleware()`의 loopback bypass와 route 등록 순서를 확인한다.
2. production route 없이 authorization matrix를 실제 Hono HTTP server에서 red로 만든다.
3. route-local policy evaluator가 401·403·400과 handler 도달 여부를 일치시키게 한다.
4. 일회성 callback 재사용, 다른 resource/capability, 만료·폐기 grant, 복수 credential을 negative corpus로 유지한다.
5. changed-file typecheck, no-excuse audit, build, 전체 test를 실행한다.
6. user-facing surface가 생기기 전까지 provider·vault·Drive·Notion 구현으로 넓히지 않는다.

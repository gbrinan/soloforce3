# Connected ingest auth gate evidence

## Observed

- Red: `npm run test:connected-ingest-auth` failed with `ERR_MODULE_NOT_FOUND` before the evaluator existed.
- Green: an ephemeral `127.0.0.1` Hono server returned the expected status and safe error code for 20/20 cases.
- Registration transcript begins `sso:next,gate:*`; allowed cases then record `handler`, denied cases never do.
- The same OAuth transaction succeeds once and is rejected as `invalid_oauth_transaction` on reuse.
- No test output contains a real token, cookie, email, OAuth state, or provider account ID; fixtures use descriptive aliases.
- SSO-off owner behavior is closed: loopback without a SoloForce session returns 401.

## Commands

```text
npm run test:connected-ingest-auth
npx tsc --noEmit --target ES2022 --module ES2022 --moduleResolution bundler --strict --esModuleInterop --skipLibCheck scripts/connected-ingest-auth-test.ts src/server/connected-ingest-auth.ts
npm run build
npm test
```

## Final verification

- `npm run build`: exit 0. 기존 Vite large-chunk/plugin-timing 경고만 관찰됐다.
- `npm test`: exit 0. connected-ingest 20/20을 포함한 전체 chain이 통과했다.
- `jobtype-template-test`는 미프로비저닝 checkout에 `history/agents.json`이 없어 기존 설계대로 skip됐다.
- Changed-file strict typecheck: exit 0.
- No-excuse banned-pattern audit: clean.

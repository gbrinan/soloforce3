# Evidence

## Red

- real app test는 `createServerApp`가 없어 module-not-found로 실패했다.
- configured connector test는 stub의 503 때문에 기대한 200 대신 실패했다.
- revoke test는 route 부재로 404를 반환했다.
- 외부 callback + SSO 미설정 test는 same-origin만으로 200을 반환해 실패했다.
- 잘못된 encryption key test는 복호화 예외를 노출하며 500을 반환했다.

## Green

- `npm test`: exit 0. connected-ingest 20/20, reversible ingest, Google connector와 실제 mount 시나리오 통과. 미프로비저닝 `history/agents.json` 관련 기존 SKIP 1건 유지.
- `npm run build`: exit 0. server TypeScript, client typecheck, Vite production build 통과.
- 변경 TypeScript 파일 pure LOC는 모두 200 이하. `src/server/index.ts`는 composition과 bootstrap support 추출 후 334에서 188로 감소.
- no-excuse checker는 프로젝트 TypeScript 5.9가 checker의 TypeScript 7 unstable API를 제공하지 않아 실행 불가했다. 대신 `tsc --noEmit`과 금지 escape-hatch 검색을 통과했다.

## Manual QA

`npm start`와 동일한 `tsx src/index.ts` 실행 경로를 `DRY_RUN=1`, 임시 `MYCREW_HOME`, port 3467로 실행했다.

- `GET /api/health` → 200
- `POST /api/connections/google-drive/oauth/start` → 503 `google_connector_not_configured`
- `GET /api/connections/google-drive/status` → 200 `{ configured: false }`

임시 서버와 생성 파일은 검증 후 삭제했다. 실제 Google OAuth credential이나 개인 계정은 사용하지 않았다.

## Failure record

첫 전체 회귀는 새 E2E가 기본 `history/`를 사용해 승인 캐시 상태를 남긴 탓에 기존 approval-cache 1건이 실패했다. E2E를 임시 `MYCREW_HOME` 동적 import로 격리하고 생성된 세 테스트 파일만 삭제한 뒤 전체 회귀가 통과했다.

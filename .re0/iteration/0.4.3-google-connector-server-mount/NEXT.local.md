# Next cycle contract

## Required operator inputs

- `GOOGLE_DRIVE_CONNECTOR_CLIENT_ID`
- `GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET`
- 정확한 `GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL`
- 기존 프로젝트 상대 경로 `GOOGLE_DRIVE_CONNECTOR_PROJECT_ID`
- 백업된 `SOLOFORCE_CONNECTION_ENCRYPTION_KEY`

## Next observable slice

Google Cloud의 OAuth test user로 실제 브라우저 consent를 1회 수행하고 Drive metadata ingest를 프로젝트 산출물까지 확인한다. 화면에는 연결 계정 표시용 이메일, project, 상태, revoke만 노출하고 token, code, owner principal은 노출하지 않는다.

## Remaining boundary

원격 Claude/Codex agent가 owner browser session 없이 ingest를 호출하려면 project + connection + capability에 한정된 agent grant 발급기가 추가로 필요하다. 현재 auth policy는 grant 형식을 지원하지만 실제 발급·해석은 아직 mount되지 않았다.

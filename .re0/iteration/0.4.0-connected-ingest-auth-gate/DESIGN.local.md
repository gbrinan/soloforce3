# Connected ingest auth gate

## TL;DR

네트워크 origin은 운반 조건이지 권한이 아니다. Google Drive·Notion ingest는 provider 구현 전에 `route + principal + project + connection + capability + credential state` 정책을 통과해야 한다. 이 사이클은 사용자 기능을 노출하지 않고 그 경계만 실제 HTTP로 증명한다.

## Thesis

`/api/connections/*` 전체에 하나의 generic 인증을 붙이지 않는다. 각 route가 owner, AgentGrant, OAuth transaction 중 허용하는 credential과 resource/capability를 선언하고, 나머지는 fail closed 한다.

## Authorization matrix

| Method/path | Owner session | AgentGrant | OAuth transaction | 없음 |
|---|---|---|---|---|
| `POST /oauth/:provider/start` | CSRF + recent auth로 허용 | 거부 | 거부 | 401 |
| `GET /oauth/:provider/callback` | 권한 아님 | 거부 | 일회 허용 | 400 |
| `GET /` | 허용 | 거부 | 거부 | 401 |
| `POST /:connectionId/ingest` | 허용 | exact project/connection + `ingest.run` | 거부 | 401 |
| `GET /:connectionId/status` | 허용 | exact project/connection + `ingest.read_status` | 거부 | 401 |
| `DELETE /:connectionId` | CSRF + recent auth로 허용 | 거부 | 거부 | 401 |
| `POST /grant-requests/:id/approve` | CSRF + recent auth로 허용 | 거부 | 거부 | 401 |

- credential 없음·malformed·expired·revoked는 401이다.
- 유효한 credential이 잘못된 route/resource/capability를 요청하면 403이다.
- callback의 unknown·expired·reused transaction은 400이다.
- 여러 종류의 credential을 동시에 제시하면 `400 ambiguous_credentials`다.

## Scope and decision

- 포함: pure evaluator, route-local Hono middleware, 실제 ephemeral loopback HTTP matrix.
- 제외: provider OAuth, token vault, Drive·Notion API, connection persistence, ingest 산출물.
- F1 결정: v1 owner authority는 기존 SoloForce SSO session만 사용한다. SSO-off의 loopback 요청을 owner로 승격하지 않는다.
- README는 변경하지 않는다. 이번 PR은 user-facing connection surface를 만들지 않는다.

## Counter-rationale

SSO-off 로컬 사용성을 위해 loopback을 owner로 취급하면 초기 연결은 편해진다. 그러나 같은 origin을 쓰는 worker, terminal, self-fetch까지 관리 권한을 얻어 OAuth token과 고객 데이터 경계가 무너진다. 별도 device-bound owner session이 설계되기 전에는 불편함보다 명시적 401이 안전하다.

# 0.4.2 Google read-only connection

## Understood as

SoloForce 소유자 계정과 Google 공급자 계정을 별도 principal로 취급한다. 두 이메일이 같아도 특별 취급하지 않고, 달라도 거부하지 않는다. 명시적 OAuth transaction이 `ownerPrincipalId + projectId`를 Google의 안정적인 `sub`와 project-scoped `connectionId`에 결속한다.

## Official constraints

- Google은 이메일이 변경될 수 있고 고유하지 않을 수 있으므로 사용자 레코드의 기본 키로 쓰지 말고 OIDC `sub`를 쓰라고 명시한다: https://developers.google.com/identity/openid-connect/reference
- OAuth server flow는 state 검증을 권장하고, unattended access에는 `access_type=offline`이 필요하다: https://developers.google.com/identity/protocols/oauth2/web-server
- `drive.metadata.readonly`는 파일 콘텐츠를 읽거나 수정하지 않고 metadata만 읽지만 restricted scope다: https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## Thesis

계정 결속은 이메일 일치가 아니라 소비된 OAuth transaction과 검증된 provider subject의 결합이다. 토큰은 broker 뒤에 남고 연결 레코드와 ingest artifact에는 credential handle만 기록한다.

## In scope

- Google authorization URL 생성과 일회용 state transaction
- verified userinfo의 `sub` 기반 project-scoped 연결
- 동일 이메일/다른 이메일에 동일한 결속 경로
- 최소 scope `openid email https://www.googleapis.com/auth/drive.metadata.readonly`
- refresh/access token을 평문 산출물에서 격리하는 broker contract
- 읽기 전용 Drive metadata를 기존 reversible ingest store에 commit
- provider 실패, revoked connection, OAuth replay 시 current pointer 불변

## Out of scope

- 실제 Google Cloud client credential 등록과 사용자 브라우저 consent
- Google Picker와 파일 콘텐츠 다운로드
- Notion connector
- 외부 Drive 쓰기와 외부 부작용 rollback
- 제품 UI와 기존 거대 routes.ts mount

## State contract

1. start는 owner principal과 project에 결속된 만료 transaction을 만든다.
2. callback은 state를 한 번만 소비하고 Google userinfo의 `sub`를 provider identity로 저장한다.
3. email은 표시용 metadata이며 authorization 비교에 사용하지 않는다.
4. 요구 scope가 하나라도 없거나 email이 검증되지 않으면 연결을 만들지 않는다.
5. ingest는 provider metadata 조회 성공 후에만 reversible store를 prepare/commit한다.
6. 토큰, authorization code, client secret은 connection manifest, journal, ingest revision에 기록하지 않는다.

## Acceptance gates

- owner email과 Google email이 다른 callback이 성공한다.
- 두 email이 같은 callback도 동일한 코드 경로로 성공한다.
- 두 연결 모두 stable `sub`와 서로 다른 connectionId로 식별된다.
- callback state replay는 거부된다.
- scope 누락과 unverified email은 연결·secret을 남기지 않는다.
- provider metadata 실패와 revoked connection은 revision을 만들지 않는다.
- 성공 ingest만 current manifest를 해당 connection으로 전환한다.

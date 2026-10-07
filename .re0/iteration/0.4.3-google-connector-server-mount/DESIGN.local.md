# 0.4.3 Google connector server mount

## TLDR

Google Drive 읽기 전용 connector를 실제 SoloForce Hono 서버에 마운트했다. 미설정 상태는 서버 전체를 중단하지 않고 connector 작업만 503으로 닫는다. 소유자 principal, Google `sub`, 표시 이메일은 분리되며 이메일 일치 여부는 권한 판단에 사용하지 않는다.

## State contract

1. connector OAuth client와 기존 Google SSO client는 별도 환경변수를 사용한다.
2. 선택 프로젝트는 `PROJECTS_DIR` 아래 최대 2단의 기존 디렉터리만 허용한다.
3. 로컬 무인증 owner 예외는 localhost callback에만 적용하고 Origin 일치를 요구한다.
4. 외부 callback은 유효한 SoloForce SSO 세션, Origin, 최근 15분 인증을 모두 요구한다.
5. callback 권한은 요청 헤더가 아니라 저장된 만료 전 일회용 transaction으로 판정한다.
6. 설치 owner principal은 무작위 UUID로 영속되며 provider 이메일과 비교하지 않는다.
7. refresh token은 32-byte key로 암호화한다. 키가 없거나 달라 복호화할 수 없으면 ingest를 403 `credential_unavailable`로 닫는다.
8. revoke는 owner mutation 권한을 다시 검사한 뒤 연결과 로컬 secret 접근을 비활성화한다.

## Counter-rationale

기존 SSO OAuth client를 재사용하면 설정 항목은 줄지만 로그인 scope와 restricted Drive scope가 결합된다. 별도 client는 운영 부담이 조금 늘어도 동의 화면, 검증 범위, credential 회전을 분리한다. 전체 Drive inventory가 불필요하다면 restricted `drive.metadata.readonly` 대신 Picker와 `drive.file`이 더 안전하지만 무인 전체 메타데이터 수집은 할 수 없다.

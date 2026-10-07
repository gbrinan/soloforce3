# Re0 memo

## Preserve

- owner authority는 이메일 문자열이나 loopback 요청 자체가 아니다.
- 같은 이메일과 다른 이메일은 모두 동일한 transaction → Google `sub` 결속 경로를 사용한다.
- connector 설정 누락과 프로젝트 오지정은 앱 부팅 실패가 아니라 connector 503이다.
- 외부 origin에서 SSO가 꺼져 있으면 same-origin 요청도 owner가 될 수 없다.
- 키 분실이나 오입력은 500 crypto 예외 대신 재연결 가능한 `credential_unavailable` 상태가 된다.
- revoke는 외부 Google 파일을 변경하지 않으며 로컬 connection과 secret 접근만 되돌린다.

## Recovery

`SOLOFORCE_CONNECTION_ENCRYPTION_KEY`는 배포 비밀 저장소에 백업한다. 키를 잃었거나 잘못 교체했다면 이전 키를 복구하거나 해당 connection을 revoke한 뒤 OAuth를 다시 연결한다. 기존 token을 새 키로 자동 회전하는 기능은 이번 slice에 포함하지 않는다.

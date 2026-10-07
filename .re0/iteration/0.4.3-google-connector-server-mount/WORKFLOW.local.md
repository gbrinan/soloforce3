# Workflow

1. PR #12를 master에 병합한다.
2. 실제 Hono composition의 fail-closed mount를 red test로 고정한다.
3. 앱 조립부와 bootstrap support를 200 pure LOC 이하 모듈로 분리한다.
4. connector config, project root, owner principal, transaction credential을 결속한다.
5. 외부 무인증, state replay, revoke, 잘못된 key를 실패 시나리오로 고정한다.
6. 전체 test/build와 실제 process HTTP 표면을 검증한다.
7. 비밀·개인정보 없이 commit, push, PR한다.

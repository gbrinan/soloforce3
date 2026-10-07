# Workflow

1. 실제 Hono HTTP surface와 실제 임시 디렉터리를 쓰는 red test를 만든다.
2. Google wire response, transaction, connection 레코드를 Zod로 parse한다.
3. transaction/connection registry와 token broker contract를 구현한다.
4. authorization callback과 metadata ingest를 reversible store에 연결한다.
5. same-email/different-email, replay, scope failure, revoked, provider failure를 검증한다.
6. strict build, full build, full regression, re0 memo, HATE를 수행한다.
7. 한 개의 원자적 커밋으로 push하고 PR을 연다.

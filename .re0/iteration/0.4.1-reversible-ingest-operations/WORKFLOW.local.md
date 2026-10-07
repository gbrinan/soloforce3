# Workflow

1. 실제 임시 디렉터리에서 상태 전이 테스트를 먼저 실패시킨다.
2. Zod 경계 스키마와 typed result를 추가한다.
3. 불변 revision과 manifest 쓰기를 추가한다.
4. current pointer의 원자적 commit과 rollback을 추가한다.
5. 프로세스 재생성, 멱등 재실행, stale commit을 리허설한다.
6. targeted/full 검증 후 회고와 증거를 기록한다.
7. 한 개의 원자적 커밋으로 push하고 PR을 연다.

## Stop condition

실제 파일시스템 rollback 리허설이 통과하고, 검증 증거가 casebook에 남고, 새 PR이 열리면 종료한다.

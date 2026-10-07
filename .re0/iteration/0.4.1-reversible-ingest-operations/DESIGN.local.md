# 0.4.1 Reversible Ingest Operations

## Understood as

SoloForce의 첫 연결형 수집 경계를 외부 계정 종류와 분리하고, 모든 변경을 `prepare -> commit -> rollback` 상태 전이로 기록한다. Google 계정이 AI 로그인 계정과 같거나 달라도 `connectionId`는 별도 식별자로 취급한다.

## Thesis

롤백은 배포 기능이 아니라 프로젝트 상태 계약이다. 한 작업 ID 아래 불변 revision, 불변 manifest, 불변 이벤트 파일로 구성된 append-only journal을 만들고, 현재 상태는 작은 manifest pointer 하나만 원자적으로 전환한다.

## In scope

- 단일 로컬 프로젝트와 읽기 전용 수집 결과
- 작업 ID 기반 prepare, commit, rollback
- 불변 원본 revision과 manifest
- 원자적 current pointer
- 장애 후 재시작, 중복 실행, 이전 상태 복귀의 실제 파일시스템 검증

## Out of scope

- Google OAuth와 토큰 저장
- Google Drive 또는 Notion 쓰기
- 다중 프로세스 잠금과 분산 트랜잭션
- 파일 삭제를 통한 정리

## State contract

1. `prepare`는 현재 manifest를 부모로 삼아 revision과 manifest를 만들지만 current pointer를 바꾸지 않는다.
2. `commit`은 부모 manifest가 여전히 current일 때만 pointer를 원자적으로 바꾼다.
3. `rollback`은 준비 상태에서는 pointer를 유지하고, 커밋 상태에서는 부모 manifest로 pointer를 되돌린다.
4. revision과 manifest는 삭제하거나 덮어쓰지 않는다.
5. 같은 operation ID와 같은 입력은 중복 산출물이나 중복 이벤트 없이 같은 상태를 돌려준다.
6. 같은 operation ID와 다른 입력, 또는 바뀐 기준선에 대한 commit은 명시적 conflict다.

## HATE root and first nail

- Root risk: 파일만 복구되고 포인터·권한·외부 부작용이 남는 거짓 롤백.
- First nail: 외부 쓰기를 열기 전에 로컬 상태 전이와 불변 증거를 실제 장애 리허설로 증명한다.

## Acceptance gates

- prepare 직후 재시작해도 current가 바뀌지 않는다.
- committed operation rollback 후 이전 manifest가 current다.
- rollback 후 revision과 manifest 증거가 그대로 남는다.
- 동일 operation 재실행은 멱등이다.
- stale prepare commit은 current를 덮지 않는다.
- targeted test, strict typecheck, build, full test가 모두 통과한다.

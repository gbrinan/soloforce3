# my-crew — 에이전트 작업 규약 (paperthin 기반)

이 문서는 이 리포에서 작업하는 에이전트·기여자의 표준 지침이다. 사용자 대면 안내는 README 4종(역할 헤더 참조)에 있으며, 메커니즘·규칙은 여기에만 둔다.

## 원칙 (paperthin 5축)

1. **아티팩트를 신뢰, 작성자를 신뢰하지 않기** — 산출물 완성 직후 자기 세션 판단 대신 콜드리드(zero-context 검토)나 현재 진실로부터의 재도출로 검증한다.
2. **SSOT** — 사실은 한 곳에만 산다. 정본: 프로젝트명·버전·Node 요구는 `package.json`(engines 포함), 환경변수는 `.env.example`, 앱 로스터는 `src/server/app-registry.ts`. 다른 표면은 참조만 한다.
3. **절제** — 개선이 증명되지 않으면 바꾸지 않는다. 적은 slop(노이즈·중복·패딩)이지 추가가 아니다.
4. **재귀 검증** — 변경 후 문서는 clean v0로 읽혀야 한다: "무엇이 바뀌었나"가 아니라 "지금 무엇이 참인가".
5. **negatives-as-corpus** — 코드·앱·문서를 지우지 말고 아카이브로 옮기고 사유(cause of death)를 기록한다.

## 사이클 규약

- 개시: `docs/<기능명>/`에 spec → plan → tasks → findings → progress 문서를 연다 (`templates/` 참조). 폴더는 생성 순간부터 비어 있지 않아야 한다.
- 변이 전: 읽기 전용 감사 → 계획 보고 → 승인 → 실행 순서를 지킨다.
- edit-safety: 타깃 존재 확인(없으면 MISS 보고), 발생 위치별 치환(일괄 스윕 금지), 대규모 구조 이동은 스크립트로.
- 마감 전: 관련 README/CLAUDE.md 반영 게이트 — 메커니즘은 CLAUDE.md, 사용자 대면은 README. 레지스터 혼입 금지.

## 계획 파일 검사

`node scripts/plan-check.cjs docs/<기능명>`이 아래 규칙을 검사한다(`--all`은 `docs/*/` 전체, `--run`은 hard 게이트 명령까지 실행). tasks.md에 `## Gates`가 있는 폴더만 대상이고, 그 이전 규약의 폴더는 SKIP 사유를 출력한다.

- P1 `## Goal`이 비어 있지 않다.
- P2 `## Understood As`에 요청을 자기 말로 다시 쓴 한 줄이 있다 — 되뇌기는 이해의 증거가 아니다.
- P3 `## Gates`의 모든 게이트에 확인 수단이 있다. `hard`는 종료 코드로 판정되는 백틱 명령, `real-surface`·`manual`은 근거 문장.
- P4 단계 항목의 `(gate: Gn)`은 모두 `## Gates`에 있다.
- P5 게이트를 단 `- [x]` 항목은 progress.md `## Gate Evidence`에 그 게이트의 PASS가 있다. ✅ 단계에는 미완 항목이 없다 — 완료는 검증된 완료다.
- P6 증거 표의 게이트는 모두 `## Gates`에 있다 — 설계가 요구하지 않은 증거를 만들지 않는다.
- P7 tasks.md `## Descoped`와 progress.md `## Error Log`가 있다(비어 있어도 된다).
- P8 progress.md 세션 날짜가 오름차순이다.
- P9 progress.md 재진입 5문항에 답이 다섯 개 있다.
- P10 findings.md `## Negative Corpus`가 있다.

## 요구사항을 코드로 쓰는 규칙

요구사항은 «규칙 → 강제하는 코드 → 그 코드를 지키는 테스트» 세 칸을 채워야 요구사항이다. 세 번째 칸이 비면 희망이다.

- 측정·판정의 기대값은 우리 코드가 계산한 값이 아니라 외부 정답(CLI 보고값, 실측 원장 행, 사람 라벨)에서 가져온다. 설계자가 기대값을 정하면 검증자가 곧 설계자다.
- 원장·이력은 고치지 않는다. 읽는 쪽이 등급을 붙여 해석한다(예: `src/server/cost-ledger.ts`).
- 단가·티어·경로 같은 값은 모듈 하나에만 둔다(단가 정본: `src/server/invocation-cost.ts`). 사본은 만들지 않고 가져다 쓴다.
- 스키마와 설정에는 티어 이름을 쓰고, 모델 ID는 티어 표 한 곳에서만 해석한다.
- 도구에는 등급(`read`·`write`·`external`)을 붙이고, 읽기 전용 단계의 도구 묶음에 쓰기 등급이 없음을 테스트로 고정한다. `external`은 사람이 발급한 승인 없이 실행되지 않는다.
- 대상이 없으면 조용히 넘어가지 않고 MISS로 보고하고 0이 아닌 종료 코드를 낸다.

## 앱 규약

- 앱 추가·제거는 `src/server/app-registry.ts` 등록이 정본이다. 레지스트리에 없는 apps/ 폴더는 아카이브 대상 후보다.

## 이력 규약

- 이 리포(soloforce3)는 soloforce2의 clean v0 재시작이다. 시작 트리는 gbrinan/soloforce2 `c39c310`(PR #9: 라이브 역싱크 + Stage 0)과 같다. 그 이전 이력·negative corpus는 gbrinan/soloforce2와 gbrinan/soloforce에 보존되어 있으며, 과거 결정의 출처가 필요하면 그쪽을 참조한다.

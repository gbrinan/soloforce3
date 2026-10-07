# Progress Log

> **각 단계를 완료하거나 문제가 발생하면 업데이트하세요.**

## Session 2026-10-07

### Stage 0: 계기판 ✅

**작업 내역**:

1. 리뷰: paperthin 28스킬·Firecrawl 2026 트렌드 관점으로 soloforce2 구조 검토, 라이브 읽기 전용 실측(위임 59건, 훅 부재, 원장 대조).
2. 역싱크: 라이브 `872d219` 번들 → 브랜치 `cycle4/cost-ledger-live`, 오버레이 패치 38개를 배포 스크립트와 같은 순서로 커밋, 기록 없던 라이브 직접 수정 1커밋. 블롭 해시 1,847/1,847 일치.
3. 단가: 라이브 cli 행으로 재현 테스트 작성 → 3건 실패 확인 → 공시 단가·1시간 캐시 생성으로 수정 → 통과. `cost-extractor.ts` 단가 사본 제거.
4. 원장 해석기 `cost-ledger.ts`(테스트 먼저), 리포트 CLI `cost-report.ts`, 구독제 `unpriced` 표기.
5. 계획 규약: `templates/` 3파일에 Understood As·Gates·Descoped·Gate Evidence·Negative Corpus 추가, `scripts/plan-check.cjs` + 테스트, 규칙 정본을 CLAUDE.md에 기록.

**생성/수정 파일**:

- `src/server/cost-ledger.ts`, `scripts/cost-report.ts` (새로 생성)
- `scripts/cost-price-calibration-test.ts`, `scripts/cost-ledger-test.ts`, `scripts/plan-check.cjs`, `scripts/plan-check-test.cjs` (새로 생성)
- `src/server/invocation-cost.ts`, `src/server/cost-extractor.ts`, `src/adapters/codex-cli.ts`, `src/adapters/antigravity-cli.ts`, `src/types.ts` (수정)
- `scripts/genie-notice-test.ts`, `package.json`, `CLAUDE.md`, `templates/tasks.md`·`progress.md`·`findings.md` (수정)
- `docs/tool-use-redesign/` (새로 생성)

## Session 2026-10-08

### Stage 1: 반증 실험 🔄

**작업 내역**:

1. 잡 단위 파일럿 10건($2.83): 7건이 환경 부재로 멈춤 — 잡 request가 genie 위임 지시문이라 비교 단위가 틀렸음. 카드 미생성(findings).
2. 채팅 원문 단위로 재설계, 사전 등록 커밋 `6f5416e`(07:49 KST) 후 실행.
3. 채팅 파일럿 10건($4.13): 전부 정상 응답, 환경 거부 0건. 블라인드 카드 10장 생성(리포 밖 `D:/mycrew-labels/eval/stage1-chat/cards.html`).

**생성/수정 파일**:

- `scripts/stage1/` sample.ts·sample-chat.ts·run.ts·cards.ts·tally.ts·stage1-test.ts (새로 생성)

## Test Results

| Test | Input | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| 단가 보정(수정 전) | 라이브 cli 행 4건 | CLI 값 ±1% | haiku 0.645, opus 2.415, sonnet(출력 위주) 1.160 | ❌ (재현) |
| 단가 보정(수정 후) | 같은 4건 | CLI 값 ±1% | 4건 모두 ±1% | ✅ |
| 원장 리포트 | 라이브 원장 30일 | 등급별 분리 | 의사결정용 $190.32 / legacy 로그 $1,272.31 → 재산정 $214.94 / unpriced 104행 | ✅ |
| 원장 파일 없음 | 없는 경로 | MISS, 종료 코드 2 | MISS, 2 | ✅ |

## Gate Evidence

| Gate | Result | Evidence | Date |
| --- | --- | --- | --- |
| G1 | PASS | 블롭 해시 1,847/1,847 일치, 라이브 전용 2개는 런타임 표식·링크 | 2026-10-07 |
| G2 | PASS | 6 passed, 0 failed | 2026-10-07 |
| G3 | PASS | 15 passed, 0 failed | 2026-10-07 |
| G4 | PASS | 53 passed, 0 failed | 2026-10-07 |
| G5 | PASS | 12 passed, 0 failed | 2026-10-07 |
| G6 | PASS | `tsc --noEmit` 종료 코드 0 | 2026-10-07 |
| G7 | PASS | 위 Test Results «원장 리포트» 행 | 2026-10-07 |
| G8 | PASS | plan-check 10규칙 통과 | 2026-10-07 |
| G9 | PASS | 재설계 사전 등록 커밋 6f5416e(2026-10-08 07:49 KST)가 채팅 재실행 결과보다 먼저 | 2026-10-08 |
| G10 | PASS | 채팅 표본 sha256 254e3a1d…7576, `sample-chat.ts --verify` 재생성 일치 | 2026-10-08 |
| G11 | PASS | 허용 도구 Skill·WebSearch·WebFetch·Read·Glob·Grep, 쓰기·셸·하위 에이전트 금지, MCP 0개 — 실제 사용 도구는 Read·Grep·Glob·Skill·ToolSearch·CronList·ListAgents(모두 읽기) | 2026-10-08 |

## Error Log

| Timestamp | Error | Attempt | Resolution |
| --- | --- | --- | --- |
| 2026-10-07 | `npm test`가 route-keyword-collision-test에서 FAIL 23건 | 1 | 실 history 의존, 무관 확인 후 나머지 개별 실행 (findings 1) |
| 2026-10-07 | `git reset --hard` 자동 모드 차단 | 1 | `git switch -c`로 대체 (findings 2) |
| 2026-10-07 | 원장 테스트 기대값 손계산 오류(1154×5) | 1 | 기대값 $0.033273으로 정정 |
| 2026-10-07 | qa-artifact-base-test 통과 후 미종료로 체인 정지 | 1 | 성공 경로 `process.exit(0)` (findings 3) |

## 5-Question Reboot Check

작업 재개 시 이 질문들로 컨텍스트 복구:

| Question | Answer |
| --- | --- |
| 1. 현재 어느 단계인가? | Stage 1 — 채팅 파일럿 10건 실행 완료, 아난 라벨 대기 |
| 2. 다음에 할 일은? | 카드 10장 라벨 → 파이프라인 점검 후 나머지 20건 실행 |
| 3. 목표는? | 정책을 도구 스키마에 두고, 싱글 기본 + 개발·인제스트·QA 레인 |
| 4. 지금까지 배운 것? | findings.md — 측정 도구부터 외부 정답과 대조할 것 |
| 5. 완료한 작업은? | 역싱크, 단가 보정, 원장 해석기·리포트, 계획 검사기 |

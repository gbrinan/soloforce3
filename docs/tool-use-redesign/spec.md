# Feature Specification: Tool Use 재설계 — Stage 0 계기판

## Overview

비용 원장(`history/cost-log.jsonl`)을 의사결정에 쓸 수 있게 만든다. 원장은 고치지 않고, 단가를 외부 정답에 맞추고, 읽는 쪽이 행마다 신뢰 등급을 붙인다.

## User Scenarios & Testing (mandatory)

### User Story 1: 주간 비용을 믿고 판단한다

아난이 "지난주 어디에 비용이 들었나"를 볼 때, 부풀린 과거 행과 구독제 실행이 측정값과 섞이지 않은 합계를 받는다.

#### Acceptance Scenarios

1. 패치 80(2026-10-02) 이전 행이 포함된 기간을 집계하면, 그 행의 로그값은 의사결정용 합계에서 빠지고 토큰 재산정 추정치가 따로 나온다.
2. codex·gemini 실행은 `$0`이 아니라 `unpriced`로 세어져 행 수와 토큰이 보인다.
3. 원장 파일이 없으면 0원 리포트가 아니라 MISS와 종료 코드 2가 나온다.

## Functional Requirements (mandatory)

요구사항은 «규칙 → 강제 코드 → 테스트» 세 칸으로 쓴다.

| ID | 규칙 | 강제 코드 | 테스트 |
| --- | --- | --- | --- |
| FR-1 | 토큰 단가는 CLI가 보고한 실제 비용과 1% 이내로 맞는다. 캐시 생성은 1시간 TTL 단가 | `src/server/invocation-cost.ts` `priceForModel` | `scripts/cost-price-calibration-test.ts` (라이브 원장 cli 행 4건이 기대값) |
| FR-2 | 단가표는 한 곳에만 있다 | `src/server/cost-extractor.ts`가 `priceForModel`을 가져다 쓴다 | 같은 테스트 + 코드 검토 |
| FR-3 | 원장 행은 measured·estimated·unpriced·legacy·unrecorded 중 하나로 분류된다 | `src/server/cost-ledger.ts` `classifyCostRow` | `scripts/cost-ledger-test.ts` |
| FR-4 | 의사결정용 합계는 measured + estimated의 로그값만 더한다 | `summarizeCosts().trustedUsd` | `scripts/cost-ledger-test.ts` |
| FR-5 | 구독제 실행은 산정 방식 `unpriced`로 기록된다 | `src/adapters/codex-cli.ts`, `src/adapters/antigravity-cli.ts` | `classifyCostRow` 명시 unpriced 케이스 |
| FR-6 | 리포트는 LLM 없이 결정적 코드로 만든다 | `scripts/cost-report.ts` | 라이브 원장에 실행(real-surface) |
| FR-7 | 계획 파일은 paperthin 규칙(P1~P10)을 지킨다 | `scripts/plan-check.cjs` | `scripts/plan-check-test.cjs` |

## Constraints (mandatory)

- 원장 과거 행은 수정·삭제하지 않는다(소급 수정은 날조, negatives-as-corpus).
- 라이브 배포는 이 사이클 범위가 아니다. 배포는 아난이 결정한다.
- 기존 `cost-entry.ts` 하위호환 계약(키 이름·순서 불변)을 지킨다.

## Success Criteria (mandatory)

- FR-1~FR-7의 테스트가 모두 통과한다.
- 라이브 원장 30일 집계에서 legacy 로그값과 의사결정용 합계가 분리돼 나온다.

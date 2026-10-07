# Implementation Plan: Tool Use 재설계 — Stage 0 계기판

## Summary

라이브와 git을 먼저 일치시키고(역싱크), 재현 테스트로 단가 오차를 고정한 뒤 단가를 고치고, 원장 해석기와 리포트 CLI를 더한다.

## Requirements

[spec.md](spec.md)의 FR-1~FR-7.

## Critical Files

### New Files

- `src/server/cost-ledger.ts` — 원장 신뢰 등급 해석기
- `scripts/cost-report.ts` — 결정적 비용 리포트
- `scripts/cost-price-calibration-test.ts`, `scripts/cost-ledger-test.ts`
- `scripts/plan-check.cjs`, `scripts/plan-check-test.cjs`

### Modified Files

- `src/server/invocation-cost.ts` — 단가 정본(공시 단가, 1시간 캐시 생성)
- `src/server/cost-extractor.ts` — 별도 단가표 제거
- `src/adapters/codex-cli.ts`, `src/adapters/antigravity-cli.ts` — `costMethod: "unpriced"`
- `scripts/genie-notice-test.ts` — 설계자가 정했던 기대값을 보정 근거로 교체
- `templates/tasks.md`·`progress.md`·`findings.md`, `CLAUDE.md`, `package.json`

## Implementation Steps

### Step 1: 역싱크

라이브 릴리스 `872d219` 커밋 + 오버레이 패치 38개(`~/.config/soloforce2/patches`, 배포 스크립트와 같은 정렬 순서) + 기록 없던 라이브 직접 수정을 커밋으로 재현한다.

### Step 2: 재현 테스트 → 단가 수정

라이브 원장의 비재개 cli 행을 기대값으로 두고 실패를 확인한 뒤 단가표를 고친다.

### Step 3: 원장 해석기와 리포트

테스트를 먼저 쓰고 `cost-ledger.ts`, `cost-report.ts`를 더한다.

## Verification

### Test

`tasks.md`의 hard 게이트 명령. `node scripts/plan-check.cjs docs/tool-use-redesign --run`이 전부 실행한다.

### Manual Test

`npx tsx scripts/cost-report.ts --days 30 --file C:/mycrew/mycrew-program/history/cost-log.jsonl`

# Tasks: Tool Use 재설계 (싱글 기본 + 레인)

## Goal

정책을 프롬프트가 아니라 도구 스키마와 서버 검증에 두고, 기본은 단일 에이전트가 도구로 일하며 컨텍스트·권한·검증 독립성이 다른 작업만 격리 레인으로 보낸다. 각 단계의 효과는 믿을 수 있는 비용 원장으로 잰다.

## Understood As

먼저 계기판(비용 원장)을 바로잡고 라이브와 git을 일치시킨 다음, 저사용 페르소나를 본체 스킬로 접고 개발·인제스트·QA만 레인으로 남긴다. 규칙은 문서로 권하지 않고 스키마·검사 스크립트로 강제한다.

## Current Phase

🔄 Stage 1: 반증 실험

## Phases

### Stage 0: 계기판 ✅

- [x] 라이브 릴리스를 git으로 역싱크 (gate: G1)
- [x] 단가를 CLI 실측에 맞춘다 — 재현 테스트 먼저 (gate: G2)
- [x] 기존 비용 회귀 테스트를 보정 근거로 갱신 (gate: G4)
- [x] 원장 신뢰 등급 해석기 (gate: G3)
- [x] 결정적 비용 리포트 CLI (gate: G7)
- [x] 계획 파일 검사기와 템플릿 확장 (gate: G5, G8)
- [x] 타입 검사 (gate: G6)

### Stage 1: 반증 실험 🔄

- [x] 가설·판정 기준을 실행 전에 고정(사전 등록) (gate: G9)
- [x] 표본 30건 고정 — 채팅 원문 단위(재설계), 고정 시드 (gate: G10)
- [x] 단일 에이전트 + 스킬로 부작용 없이 재실행 — 파일럿 10건 (gate: G11)
- [ ] 아난 블라인드 A/B 라벨 30장 (gate: G12)
- [ ] 판정 기록, 기준 미달 영역은 레인 후보로 (gate: G13)

### Stage 2: 흡수 ⏸️

- [ ] 에이전트별 `mode: skill | lane` 플래그
- [ ] 저사용 에이전트를 몇 명씩 본체 스킬로 전환, 기존 설정은 보관

### Stage 3: 레인 상태 머신과 결정적 알림기 ⏸️

- [ ] 완료 알림은 코드가 바로 보내고, 실패·결정 필요 시에만 LLM 호출
- [ ] weekly-cost-report 루프를 `scripts/cost-report.ts`로 교체

### Stage 4: 도구 등급과 지연 로딩 ⏸️

- [ ] 훅 스크립트 3종 복구(mcp-approval-hook·stop-response-hook·agent-event-hook)
- [ ] DelegateTask 스키마에 `tier` 추가, 모델 ID는 티어 표에서만 해석
- [ ] 도구 등급(read·write·external)과 읽기 전용 단계 테스트

## Gates

| ID | Claim | Check | Kind |
| --- | --- | --- | --- |
| G1 | 브랜치 트리가 라이브 릴리스와 같다 | 라이브 `git hash-object`와 브랜치 `git ls-tree` 블롭 해시 대조(절차: findings.md «역싱크 검증») | real-surface |
| G2 | 토큰 단가가 CLI 보고 비용과 1% 이내 | `npx tsx scripts/cost-price-calibration-test.ts` | hard |
| G3 | 원장 행이 신뢰 등급으로 분류되고 합계에서 legacy가 빠진다 | `npx tsx scripts/cost-ledger-test.ts` | hard |
| G4 | 기존 비용·알림 회귀 테스트가 통과한다 | `npx tsx scripts/genie-notice-test.ts` | hard |
| G5 | 계획 검사기가 규칙마다 위반을 잡는다 | `node scripts/plan-check-test.cjs` | hard |
| G6 | 타입 검사 통과 | `npx tsc --noEmit` | hard |
| G7 | 라이브 원장 30일 리포트가 등급별로 나온다 | `cost-report.ts --days 30`을 라이브 원장에 실행해 표 확인 | real-surface |
| G8 | 이 폴더가 계획 규칙을 지킨다 | `node scripts/plan-check.cjs docs/tool-use-redesign` | hard |
| G9 | 가설·판정 기준이 실행보다 먼저 커밋됐다 | findings.md «Stage 1 사전 등록» 커밋 시각 < 첫 재실행 로그 시각 | manual |
| G10 | 표본이 사전 규칙대로 뽑혔다 | 표본 ID 목록의 sha256과 선정 규칙을 progress.md에 기록, 같은 시드로 재생성해 일치 확인 | real-surface |
| G11 | 재실행에 부작용이 없었다 | 쓰기·외부 발송 도구 없이 실행(허용 도구 목록 기록), 실행 후 라이브 원장·외부 시스템 변화 0 확인 | real-surface |
| G12 | 정답은 사람 라벨에서 온다 | 아난 블라인드 라벨 파일(A/B 순서 무작위, 출처 비공개) 30장 | manual |
| G13 | 판정이 사전 기준대로 내려졌다 | 사전 등록 기준표와 라벨 집계를 대조 | manual |

## Descoped

| Item | Reason | Where it went |
| --- | --- | --- |
| 라이브 배포 | 배포는 아난 결정. 이 사이클은 리포 정본화와 계기판까지 | 배포 시 오버레이 패치 38개는 «already present upstream»으로 건너뛰어진다 — findings.md |
| 원장 과거 행 수정 | 소급 수정은 날조. 읽는 쪽이 등급으로 해석한다 | `src/server/cost-ledger.ts` |
| weekly-cost-report 루프 교체 | 라이브 루프는 MYCREW_HOME에서 읽혀 배포와 별개 | Stage 3 |
| `cost-extractor.ts` 삭제 | 데드코드지만 이번엔 단가 사본만 제거(절제) | Stage 4 정리 후보 |
| `npm test` 전체를 게이트로 쓰기 | `route-keyword-collision-test`가 실 `history/agents.json`에 의존해 새 체크아웃에서 실패 | findings.md «Issues Encountered» 1 |

## Notes

- 진행할 때마다 단계 상태를 업데이트한다: ⏸️ 대기 → 🔄 진행 중 → ✅ 완료
- 결정 사항은 findings.md의 Technical Decisions에, 오류는 Issues Encountered에 기록한다.
- 검사: `node scripts/plan-check.cjs docs/tool-use-redesign --run`

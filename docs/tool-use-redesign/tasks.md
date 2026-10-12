# Tasks: Tool Use 재설계 (싱글 기본 + 레인)

## Goal

정책을 프롬프트가 아니라 도구 스키마와 서버 검증에 두고, 기본은 단일 에이전트가 도구로 일하며 컨텍스트·권한·검증 독립성이 다른 작업만 격리 레인으로 보낸다. 각 단계의 효과는 믿을 수 있는 비용 원장으로 잰다.

## Understood As

먼저 계기판(비용 원장)을 바로잡고 라이브와 git을 일치시킨 다음, 저사용 페르소나를 본체 스킬로 접고 개발·인제스트·QA만 레인으로 남긴다. 규칙은 문서로 권하지 않고 스키마·검사 스크립트로 강제한다.

## Current Phase

🔄 Stage 1: 반증 실험(아난 라벨 대기) · 🔄 Stage 4: 승인 계약부터(아난 결정 2026-10-13, Stage 2·3보다 먼저)

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

### Stage 4: 도구 등급과 승인 계약 🔄

- [x] M1 외부 발송 판정 규칙 — 미리보기 해시·사람만 허용·한 번만·만료 (gate: G14)
- [x] M1 승인 배선 — SendToPartner·회신 마커는 승인 뒤 서버가 발송, 정책 approval 도구는 헤드리스 금지·PTY 승인 카드, approval 모드 MCP는 헤드리스에서 readTools만, mcp-approval-hook 복구 (gate: G15)
- [x] M1 승인 저장소 external 규칙 — 지니 의견·자동 규칙·반복 이력 미적용 (gate: G16)
- [ ] M2 출처 표시 — 워커 결과 태그, 무인 루프의 외부 발송은 보류 목록으로
- [ ] M3 결과 상태 — ok·empty·failed·partial, 메일 스캔·텔레그램 발송 결과 정직하게
- [ ] M4 DelegateTask `tier`, 미등록 내부 source는 standard 티어 + 경고, 레인 필수 필드 검사
- [ ] M5 업무 맥락 형식(스키마·예시·검사기는 리포, 값은 `history/business-context.yaml`)
- [ ] 훅 2종 복구(stop-response-hook·agent-event-hook)
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
| G14 | 외부 발송 승인 판정이 계약대로다 | `npx tsx scripts/side-effect-gate-test.ts` | hard |
| G15 | 승인 배선(헤드리스 MCP 권한·정책 도구 분류·승인 훅 실제 프로세스)이 닫힌 쪽으로 동작한다 | `npx tsx scripts/approval-wiring-test.ts` | hard |
| G16 | 승인 저장소가 external 요청을 사람만 허용한다 | `npx tsx scripts/approvals-external-test.ts` | hard |

## Descoped

| Item | Reason | Where it went |
| --- | --- | --- |
| 라이브 배포 | 배포는 아난 결정. 이 사이클은 리포 정본화와 계기판까지 | 배포 시 오버레이 패치 38개는 «already present upstream»으로 건너뛰어진다 — findings.md |
| 원장 과거 행 수정 | 소급 수정은 날조. 읽는 쪽이 등급으로 해석한다 | `src/server/cost-ledger.ts` |
| weekly-cost-report 루프 교체 | 라이브 루프는 MYCREW_HOME에서 읽혀 배포와 별개 | Stage 3 |
| `cost-extractor.ts` 삭제 | 데드코드지만 이번엔 단가 사본만 제거(절제) | Stage 4 정리 후보 |
| RotatePartnerToken·RequestPartnership·일정 자동 공유 응답의 외부 발송 | 토큰 회전·동료 신청은 프로토콜 동작, 일정 공유는 파트너 scope 설정에 따른 자동 응답 — 승인에 묶으면 프로토콜이 멈춘다. 따로 검토 | findings «Stage 4 M1 착수 전 실측» |
| 승인 뒤 발송 목록 줄이기(trim) | 지금 외부 발송은 1건 단위라 필요 없다. 묶음 발송이 생기면 다시 본다 | `src/server/side-effect-gate.ts` |
| `worker-pty.ts` 훅 배선 | 파일 주석상 pty-adapter 미등록으로 도달 불가 | 해당 경로가 살아나면 terminal-ws와 같은 배선 |
| 승인 API 토큰 노출 여부 | 이번 범위 밖 | findings «Issues Encountered» 5 |
| `npm test` 전체를 게이트로 쓰기 | `route-keyword-collision-test`가 실 `history/agents.json`에 의존해 새 체크아웃에서 실패 | findings.md «Issues Encountered» 1 |

## Notes

- 진행할 때마다 단계 상태를 업데이트한다: ⏸️ 대기 → 🔄 진행 중 → ✅ 완료
- 결정 사항은 findings.md의 Technical Decisions에, 오류는 Issues Encountered에 기록한다.
- 검사: `node scripts/plan-check.cjs docs/tool-use-redesign --run`

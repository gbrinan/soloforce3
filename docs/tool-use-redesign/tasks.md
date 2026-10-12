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
- [x] M2 출처 표시 — 워커 결과 경계·마커 무력화, 발송 마커는 지니 출력만, 무인 루프 발송은 보류 목록, 승인 카드에 요청 주체 (gate: G17, G18)
- [x] M3 결과 상태 — 공용 봉투(ok·empty·partial·failed·skipped), 메일 스캔 실패는 «확인 못 함» 알림·일부 누락은 partial, 텔레그램·디스코드 전달 여부는 실제 결과, 루프 요약에 실패 스텝 꼬리말 (gate: G19, G20)
- [x] M4 DelegateTask `tier`(모델 ID는 티어 표에서만, 모르는 티어 거부), 루프 스텝 model_tier를 실제 잡에 적용, 미등록 내부 source는 standard + 경고, 레인 정의 검사기 (gate: G21, G22, G23, G24)
- [x] M5 업무 맥락 형식 — 스키마·예시·검사기는 리포, 값은 `history/business-context.yaml`(gitignore) (gate: G25, G26)
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
| G17 | 외부 내용의 실행 마커가 무력화되고 경계를 위조할 수 없다 | `npx tsx scripts/provenance-test.ts` | hard |
| G18 | 다른 곳에서 온 내용의 회신 마커는 실행되지 않고, 무인 실행 발송은 보류된다 | `npx tsx scripts/provenance-integration-test.ts` | hard |
| G19 | 결과 봉투가 «없음»과 «확인 못 함»을 가른다 | `npx tsx scripts/result-envelope-test.ts` | hard |
| G20 | 메일 스캔이 실패·결과 없음·일부 누락·진행 중을 구분하고 실패를 알린다 | `npx tsx scripts/mail-scan-outcome-test.ts` | hard |
| G21 | 위임 모델은 티어로만 정해지고 모르는 티어는 거부된다, 레인 검사 규칙이 동작한다 | `npx tsx scripts/delegate-tier-test.ts` | hard |
| G22 | 리포 시드 레인 정의에 model 없는 것·없는 MCP 참조가 없다 | `npx tsx scripts/lane-check.ts` | hard |
| G23 | 미등록 내부 source가 기본 모델로 새지 않는다 | `npx tsx scripts/internal-source-tier-test.ts` | hard |
| G25 | 업무 맥락 형식이 ISO 코드·실제 날짜·IANA 시간대·중복 없는 사업 단위를 강제하고, 오류에 값을 싣지 않는다 | `npx tsx scripts/business-context-test.ts` | hard |
| G26 | 리포 예시 파일이 형식을 통과한다 | `npx tsx scripts/business-context-check.ts --file config/business-context.example.yaml` | hard |
| G24 | 라이브 레인 정의(읽기 전용)에 FAIL이 없다 | `lane-check.ts --agents <라이브 history/agents.json> --registry <라이브 mcp-registry.json>` 결과 기록 | real-surface |

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
| 지니 내부 턴(워커 결과 알림 등)이 낸 텔레그램·디스코드 회신 마커 | 받는 쪽이 사장님 본인 채널이라 외부 발송이 아니다. 최악은 사장님에게 오는 잡음 | findings «Stage 4 M2» |
| 업무 맥락을 런타임(스킬·레인 프롬프트)에 주입 | 이번엔 형식만. 값 파일을 아난이 채운 뒤 읽는 쪽을 붙인다 | `src/shared/business-context.ts` `parseBusinessContext` |
| 업무 맥락 실제 값 작성 | 사업 정보라 아난이 직접 쓴다(공개 리포에 올리지 않음) | `history/business-context.yaml` — 지금은 MISS |
| 시드·라이브의 모델 ID를 티어 이름으로 옮기기 | 레인 검사는 경고(L2)로만 센다. 옮기면 runWorkerAgent·어댑터가 티어를 해석해야 해 범위가 커진다 | lane-check WARN L2 |
| 워커 잡 비용 로그의 source 기록 | 실측해 보니 이미 `worker:plan`·`worker:execute` 등으로 남고 있었다(조사 보고와 다름) | findings «Stage 4 M4» |
| 다른 커넥터·브리핑 루프의 결과 봉투 적용 | 이번엔 공용 형식과 실패가 가장 조용하던 메일 스캔·루프 요약만. 나머지는 봉투를 가져다 쓰면 된다 | `src/shared/result-envelope.ts` |
| 보류 목록의 영속 저장 | 서버 재시작 시 사라진다. 보류는 «보내지 않음»이라 사라져도 안전하고, 루프 결과 요약에 이미 실렸다 | `src/server/external-actions.ts` |
| `npm test` 전체를 게이트로 쓰기 | `route-keyword-collision-test`가 실 `history/agents.json`에 의존해 새 체크아웃에서 실패 | findings.md «Issues Encountered» 1 |

## Notes

- 진행할 때마다 단계 상태를 업데이트한다: ⏸️ 대기 → 🔄 진행 중 → ✅ 완료
- 결정 사항은 findings.md의 Technical Decisions에, 오류는 Issues Encountered에 기록한다.
- 검사: `node scripts/plan-check.cjs docs/tool-use-redesign --run`

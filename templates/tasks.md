# Tasks: 기능명

<!-- 기능의 한국어 이름을 제목에 포함합니다. -->

## Goal

<!-- 명확한 최종 목표를 작성합니다. -->

## Understood As

<!-- 요청을 자기 말로 다시 쓴 한 줄. 사용자 문장을 그대로 옮기면 이해의 증거가 되지 않습니다. -->

## Current Phase

<!-- 현재 진행 중인 단계를 표시합니다. 이모지: 🔄 진행 중, ✅ 완료, ⏸️ 대기 -->

🔄 Phase 1: Requirements & Discovery

## Phases

<!-- 각 단계의 작업을 체크박스로 관리합니다. -->

### Phase 1: Requirements & Discovery 🔄

- [ ] 요구사항 정의
- [ ] 기존 코드 분석
- [ ] 스펙 문서 작성 (spec.md)
- [ ] 스펙 리뷰 및 승인

### Phase 2: Planning & Structure ⏸️

- [ ] 구현 계획 작성 (plan.md)
- [ ] 기존 코드 상세 분석
- [ ] 관련 클래스/메서드 존재 여부 확인

### Phase 3: Implementation ⏸️

- [ ] UI Layer 구현
- [ ] Application Layer 구현
- [ ] Domain Layer 구현
- [ ] Infrastructure Layer 구현 (필요시)
- [ ] 단계별 컴파일 검증

### Phase 4: Testing ⏸️

- [ ] 전체 빌드 확인 (gate: G1)
- [ ] 전체 테스트 통과 확인 (gate: G2)
- [ ] 수동 테스트 (가능한 경우) (gate: G3)

## Gates

<!-- 완료를 증명하는 수단. hard 는 종료 코드로 판정되는 백틱 명령, real-surface 는 실제 화면·API·라이브에서 확인하는 방법, manual 은 사람이 확인할 근거.
     게이트를 단 항목은 progress.md «Gate Evidence»에 PASS 가 있어야 체크할 수 있습니다(scripts/plan-check.cjs). -->

| ID | Claim | Check | Kind |
| --- | --- | --- | --- |
| G1 | 빌드가 통과한다 | `npm run build` | hard |
| G2 | 테스트가 통과한다 | `npm test` | hard |
| G3 | 실제 화면에서 동작한다 | 브라우저로 해당 화면을 열어 확인 | real-surface |

## Descoped

<!-- 이번 사이클에서 뺀 것. 지우지 않고 이유와 함께 남깁니다(negatives-as-corpus). -->

| Item | Reason | Where it went |
| --- | --- | --- |

## Notes

<!-- 필요시 추가 항목을 덧붙입니다. -->

- 진행할 때마다 Phase 상태를 업데이트하세요: ⏸️ 대기 → 🔄 진행 중 → ✅ 완료
- 결정 사항은 findings.md의 Technical Decisions에 기록하세요.
- 오류는 findings.md의 Issues Encountered에 기록하세요.

# Tasks: 주제 모듈

## Goal

사업 주제 하나를 정하면 영업·소통·물류·뉴스 정찰이 그 주제로 돌아가게 한다. SPF 전용 구성을 «역할 + 주제 설정»으로 바꾸고 SPF를 첫 예시로 옮긴다.

## Understood As

SPF용 에이전트를 복제하는 게 아니라, 주제 설정 파일을 받는 범용 역할과 루프 템플릿을 만들고 SPF가 그 설정 하나로 지금처럼 돌아가는지 대조해 증명한다.

## Current Phase

🔄 T2: 모듈 형식과 로더

## Phases

### T1: 주제 설정 형식 ✅

- [x] 스키마·검사기·예시 (gate: T1-G1, T1-G2)

### T2: 모듈 형식과 로더 🔄

- [ ] `modules/<id>/module.json`, 루프 템플릿 × 활성 주제

### T3: 역할 에이전트 ⏸️

- [ ] 역할 4개, `spf-*` 별칭, QA·범주 목록을 플래그·사업 단위에서

### T4: SPF 이전과 등가 검증 ⏸️

- [ ] SPF 값을 `history/topics/spf.yaml`로, 루프 5개 프롬프트 대조

### T5: 일정 조회 도구 ⏸️

- [ ] `schedules_query` (soloforce 일정 + 아난다라 교육, 동기화 시각)

### T6: 문서 ⏸️

- [ ] CLAUDE.md 정본 위치, README

## Gates

| ID | Claim | Check | Kind |
| --- | --- | --- | --- |
| T1-G1 | 주제 설정 형식이 필수 값·형식을 강제하고 오류에 값을 싣지 않는다 | `npx tsx scripts/topic-config-test.ts` | hard |
| T1-G2 | 리포 예시 주제 설정이 형식을 통과한다 | `npx tsx scripts/topic-check.ts --file config/topics/example.topic.yaml` | hard |

## Descoped

| Item | Reason | Where it went |
| --- | --- | --- |
| 라이브 배포·라이브 `history/` 쓰기 | 배포는 아난 결정 | T4 산출물을 배포 때 옮김 |
| 영업·마케팅·지원·운영·브리핑 모듈, 업무 대시보드 | 이 틀이 SPF로 검증된 뒤 | 다음 사이클 |
| Apollo·Common Room·HubSpot 유료 여부 확인 | 영업 모듈 단계에서 웹으로 확인, 유료면 대체 수단 | 영업 모듈 사이클 |

## Notes

- 검사: `node scripts/plan-check.cjs docs/topic-modules --run`

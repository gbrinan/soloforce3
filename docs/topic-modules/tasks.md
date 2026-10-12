# Tasks: 주제 모듈

## Goal

사업 주제 하나를 정하면 영업·소통·물류·뉴스 정찰이 그 주제로 돌아가게 한다. SPF 전용 구성을 «역할 + 주제 설정»으로 바꾸고 SPF를 첫 예시로 옮긴다.

## Understood As

SPF용 에이전트를 복제하는 게 아니라, 주제 설정 파일을 받는 범용 역할과 루프 템플릿을 만들고 SPF가 그 설정 하나로 지금처럼 돌아가는지 대조해 증명한다.

## Current Phase

⏸️ T4: SPF 이전과 등가 검증

## Phases

### T1: 주제 설정 형식 ✅

- [x] 스키마·검사기·예시 (gate: T1-G1, T1-G2)

### T2: 모듈 형식과 로더 ✅

- [x] `modules/<id>/module.json`, 루프 템플릿 × 활성 주제, 파일 루프 우선 (gate: T2-G1)

### T3: 역할 에이전트 ✅

- [x] 역할 4개(`modules/topic-business/agents/`), 레지스트리 모듈 스캔, 위임·루프의 `topic` → 주제 맥락 블록, 예전 id 별칭(`legacyAgents`), QA 외부 발신 목록 (gate: T3-G1)

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
| T2-G1 | 모듈 × 주제가 켜진 템플릿만 루프로 만들고, 없는 값은 거부하고, 같은 id 파일 루프가 우선한다 | `npx tsx scripts/topic-modules-test.ts` | hard |
| T3-G1 | 모듈 역할이 자동 등록되고, 위임·루프의 주제가 맥락 블록으로 붙고, 주제를 정할 수 없거나 모르면 거부하고, 예전 id는 등록돼 있는 동안 그쪽이 받는다 | `npx tsx scripts/topic-roles-test.ts` | hard |

## Descoped

| Item | Reason | Where it went |
| --- | --- | --- |
| 라이브 배포·라이브 `history/` 쓰기 | 배포는 아난 결정 | T4 산출물을 배포 때 옮김 |
| 영업·마케팅·지원·운영·브리핑 모듈, 업무 대시보드 | 이 틀이 SPF로 검증된 뒤 | 다음 사이클 |
| Apollo·Common Room·HubSpot 유료 여부 확인 | 영업 모듈 단계에서 웹으로 확인, 유료면 대체 수단 | 영업 모듈 사이클 |
| QA 외부 발신 목록을 에이전트 플래그에서 읽기 | 목록에 역할 3개를 더하는 것으로 충분, 구조 변경은 증명된 이득 없음 | 필요해지면 별도 |
| 프로젝트 범주 enum(spf 등)을 사업 단위에서 읽기 | 프로젝트 폴더 분류는 주제 모듈과 별개 관심사 | 별도 |
| 주제 키워드로 지니 라우팅(`routeKeywords`) | 전환 중엔 spf-* 등록이 라우팅을 받는다. 역할 등록에 키워드를 주면 같은 말이 두 곳으로 갈린다 | T4 이후 |

## Notes

- 검사: `node scripts/plan-check.cjs docs/topic-modules --run`

# Findings: 주제 모듈

## Requirements

- 아난 결정(2026-10-13): SPF로 먼저 해 보고 SPF는 예시 하나로 쓴다. 역할 하나 + 루프가 주제를 지정한다. 일정은 soloforce 일정에 쓰고 아난다라는 읽는다. 유료 외부 서비스는 확인 후 대체 수단으로.

## Research Findings

### SPF 산출물 분류 (2026-10-13, 라이브 읽기 전용)

- 범용 로직: 카톡 파서·마스킹·SQLite 장부, 분류 6종 × 긴급도 3, 다음 액션 4유형, 메일 답장 온도 판정, draft_only, 문서 기본 양식.
- 도메인 지식: 뉴스 범주(HPAI 등)·섹터 A~D 매핑·경쟁사·운송 온도대·태국 양자 예절. 대부분 `spf-knowledge.md` 틀에 이미 분리됨(값 칸은 비어 있음).
- 하드코딩 위치: Notion data_source 3개(리드·배송·주간 뉴스)와 페이지 URL, Gmail `label:SPF`, Drive 동기화 경로, 콘솔 URL.
- 이름표: 에이전트·팀·루프 id, 프로젝트 범주 enum, QA 정책 목록(`qa-trigger-policy.ts`).
- 리포 시드와 라이브가 다르다. 라이브가 최신([[BLOCKED]] 규칙, 단위 표기 규칙).
- 참조만 있고 없는 스킬 4개(`spf-daily-news`·`spf-target`·`spf-outreach`·`spf-shipment`), 에이전트 1개(`spf-translator`).
- 공개 리포 `loops/spf-*.yaml`에 Notion data_source ID와 페이지 URL이 이미 있다(git 이력에 남음).

### 일정 조회 (2026-10-13)

- 앱 데이터 읽기 MCP(`appdata`)는 지니 전용(`src/agent.ts` orchestrator 분기)이고 일정 조회 도구가 없다. 워커는 Bash로 `/api/schedules`를 curl해야 하는데 대부분 Bash가 없다.
- 아난다라 → soloforce 일정 동기화는 24시간 주기(`anandara-sync.ts`). 응답에 동기화 시각이 없다.

## Technical Decisions

| Decision | Rationale |
| --- | --- |
| 주제 값은 `history/topics/<id>.yaml`, 리포엔 예시만 | 공개 리포. 업무 맥락과 같은 방식 |
| 주제 id는 업무 맥락 `businessLines[].id`와 같게 | 사업 단위 목록을 한 곳에서 관리(SSOT) |
| 저장 위치는 Notion 또는 `apps/leads` 중 하나를 주제마다 고름 | SPF는 Notion을 그대로, 새 주제는 로컬 CRM도 가능 |
| 주제 루프와 같은 id의 파일 루프가 있으면 파일 우선 | 이전 기간에 같은 루프가 두 번 돌지 않게. 파일을 지우면 모듈 루프가 이어받는다 |
| 템플릿이 쓰는 값이 주제에 없으면 루프를 만들지 않음 | 빈칸으로 렌더된 프롬프트는 없는 저장 위치에 기록하라는 지시가 되어 조용히 실패한다 |
| 레지스트리는 루프 원본까지, 검증·등록은 loops/loader | 순환 import 방지, 검증 규칙은 한 곳(validateLoop) |
| 역할 지시서는 범용, 주제 값은 위임 때 맥락 블록으로 | 지시서를 주제마다 복제하지 않는다. 블록이 없으면 역할은 작업하지 않고 보고한다 |
| 예전 id(spf-*)는 등록돼 있는 동안 그쪽이 받는다 | 배포 전후 동작이 같다. 아난이 예전 에이전트를 내리면 별칭이 역할로 이어받는다 |
| 역할인데 주제를 못 정하면 거부 | 주제 없는 역할은 어디에 기록할지 모른다. 기본 주제로 흘리면 다른 사업 DB에 쓴다 |
| 소통 역할 작업 공간은 «수신함의 부모» 규약 | 파서·원장 경로를 주제 설정에 더 늘리지 않는다. SPF는 T4에서 경로 결정(현재 라이브는 history/agents/spf-comms) |

## Issues Encountered

- 카톡 파서(`kakao_parser.py`)·분류 스킬은 라이브 history에만 있고 리포에 없다. 모듈이 실어 나르려면 T4 이후 이식 필요.
- 범용 소통 지시서가 `spf-comms-classify`·`spf-next-action` 스킬을 참조한다(내용은 주제 무관). 이름 변경은 T4.

## Negative Corpus

- 파이썬 일반 문자열 안의 `\n`을 TS 템플릿 리터럴로 치환하면 실제 줄바꿈이 된다(2회째). 짧은 치환은 Edit 도구로, 스크립트는 raw 문자열로.

## Resources

- 도메인 팩 명세: `docs/domain-pack/spec.md`
- knowledge-work-plugins 분석: https://claude.ai/artifact/QQofxM7gjZwiQwoWgNVezD (비공개)

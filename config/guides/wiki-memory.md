# 위키 기억 관리

에이전트가 세션 간 기억을 유지하기 위한 위키 저장·관리 절차.

## 위치

```
history/agents/{agent-id}/wiki/
```

예: `history/agents/dev-pm/wiki/`, `history/agents/planner-researcher/wiki/`

## 저장 방법 — WIKI 태그

보고 응답 마지막에 아래 태그를 삽입하면 자동 저장된다:

```
<!--WIKI:{"page":"페이지명","content":"내용 (마크다운)"}-->
```

- `page`: 파일명 (확장자 없음). 예: `procedure_api-update`
- `content`: 저장할 마크다운 내용
- `content`가 빈 문자열이면 → 페이지 **아카이브(삭제)**

## 인덱스 파일 (MEMORY.md)

- 경로: `history/agents/{id}/wiki/MEMORY.md`
- 형식: `- [제목](파일명.md) — 설명`
- **200줄 제한** — 항상 간결하게 유지

## 페이지 종류

| 접두사 | 용도 |
|--------|------|
| `procedure_` | 반복 작업 절차서 |
| `project_` | 프로젝트 진행 기록 |
| `feedback_` | 피드백·교훈 |
| `!` (느낌표) | 절대 삭제 금지 중요 기억 |

## 정리 규칙

- 오래된 작업 기록은 빈 `content`로 아카이브
- `index`, `role-directive`, `self-profile`, `!`로 시작하는 페이지는 **보호 대상**
- 기존 위키와 모순되는 새 정보 발견 시 해당 페이지를 Read 후 업데이트

## 주의사항

- 위키 파일은 **5KB 제한** — 장문은 `history/outputs/{id}/`에 저장 후 wiki에 링크만
- 세션 만료 전 중요 결정사항은 반드시 WIKI 태그로 저장
- 연관 있는 기존 페이지가 있으면 본문에 "관련: XX페이지 참조"로 언급

## 선별 회상 모드 (MEMORY_SELECTIVE_RECALL)

기본 동작(플래그 미설정)은 지금까지와 동일하다: 세션 시작 시 `index.md`(항상)와 최근 3일 daily 요약만
프롬프트에 주입되고, 개별 위키 페이지는 필요할 때 Read로 선택 로드한다.

위키 페이지 수가 많아지면 `index.md`나 daily 요약이 커질 수 있어, 매 세션 시작마다 관련 없는 옛 기억까지
토큰으로 소모될 수 있다. 이를 완화하기 위해 `src/server/memory/recall.ts`에 **선별 회상** 기능을 구현했다.

### 활성화

```
MEMORY_SELECTIVE_RECALL=1
```

값이 없거나 `1`이 아니면 기존 동작 그대로다(안전장치 — 관찰 후 owner가 켠다).

### 활성화 시 동작

세션 시작 시(session-start), `index.md`/`role-directive.md`/`self-profile.md`/`schedule.md` 등
보호 대상 페이지는 **항상** 그대로 주입되고, 추가로 다음 두 블록이 삽입된다.

1. **위키 목차(TOC)**: 개별 페이지 전문이 아니라 `페이지명 — 첫 헤딩/한줄요약` 형태의 가벼운 목록.
2. **관련 기억 회상**: 이번 요청(사용자 메시지 또는 워커 작업 지시)과 관련도가 높은 위키 페이지를
   `memory/service.ts`의 기존 SQLite FTS5(BM25) 인덱스로 검색해 상위 항목만 삽입.

목차 + 회상 블록의 합계 글자 수는 `MEMORY_RECALL_BUDGET_CHARS`(기본 8000자)를 넘지 않도록 자르며,
예산 초과 시 "(예산 초과로 일부 생략됨 — 필요 시 Read로 전문 확인)" 안내가 함께 붙는다.

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MEMORY_SELECTIVE_RECALL` | (미설정=OFF) | `1`이면 선별 회상 활성화 |
| `MEMORY_RECALL_BUDGET_CHARS` | `8000` | 목차+회상 블록의 최대 글자 수 |

### 범위(v1)와 한계

- **세션 시작에서만** 동작한다. 세션 resume 중 메시지별(per-message) 재회상은 v1 범위 밖이다 —
  resume 시에는 지금처럼 조직도/위키/태그가 이미 세션 컨텍스트에 있다고 가정하고 작업 내용만 전달한다.
- 검색은 FTS5 **BM25 랭킹**이며 한국어 형태소 분석이 아니다. 토크나이저는 sqlite trigram을 우선
  사용하고, 미지원 환경에서는 unicode61(공백 기준)로 자동 폴백한다. 조사가 붙은 단어는 정확히
  같은 형태가 아니면 놓칠 수 있다 — 완전한 한국어 인식이 필요하면 향후 bge-m3/Ollama 임베딩 도입을
  검토한다(이 기능의 범위 아님).
- 위키 페이지가 항상 SafeRead 대상이라는 점은 변하지 않는다 — 목차를 보고 필요하면 Read로 1~3개만
  선택해서 읽는다(genie.md의 기존 규칙 그대로).

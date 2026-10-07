# 스킬-알바 활용법

## 스킬-알바란?

`config/skill-templates/`에 정의된 역할 템플릿을 기반으로
에이전트가 일회성 작업자(알바)를 즉석 생성하는 기능.

## 언제 쓰나

- 현재 역할 범위를 벗어나는 전문 작업이 필요할 때
- 정규 팀원에게 위임하기엔 너무 좁은 단발성 작업
- 병렬로 여러 전문 작업을 동시 처리할 때

## 호출 방법

Agent 도구로 호출한다:

```json
{
  "description": "작업 요약 (3-5단어)",
  "prompt": "구체적 지시 (파일 경로, 완료 조건 포함)",
  "subagent_type": "frontend | backend | Explore | ..."
}
```

## 템플릿 목록

`config/skill-templates/` 하위 파일 참조:

| 파일 | 역할 |
|------|------|
| `backend-developer.md` | API, DB, 서버 로직 |
| `frontend-developer.md` | React, UI 컴포넌트 |
| `tester.md` | 시나리오 작성, 결과 검증 |
| `data-collector.md` | 웹 스크래핑, API 호출, CSV/JSON |
| `document-writer.md` | 보고서, 매뉴얼, 가이드 |
| `prompt-engineer.md` | 프롬프트 최적화, 테스트 케이스 |

## 결과 회수

- 동기 실행: Agent 도구 반환값으로 결과 수신
- `run_in_background: true`: 백그라운드 실행, 완료 알림으로 수신
- 결과를 검수하고 품질 미달 시 재작업 지시
- 산출물은 `history/outputs/{agent-id}/`에 저장 요청

## 주의사항

- 알바에게 명확한 완료 조건과 파일 경로를 지시에 포함
- 지시 범위 이상 수정을 시키지 말 것
- 중요 산출물은 반드시 저장 경로를 명시해 파일로 남기도록 지시

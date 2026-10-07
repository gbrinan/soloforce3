# 산출물 저장 규칙

## 저장 경로

| 종류 | 경로 |
|------|------|
| 보고서·분석물·산출물 | `history/outputs/{agent-id}/` |
| 임시 스크립트·중간 파일 | `history/attachments/` |
| 위키·기억 | `history/agents/{agent-id}/wiki/` |

예: `history/outputs/dev-pm/`, `history/outputs/planner-researcher/`

## 파일명 규칙

```
{슬러그}_{agent-id}_{YYYY-MM-DD}.{확장자}
```

- 슬러그: 짧고 명확한 설명 (공백 없이 `-` 또는 `_` 구분)
- agent-id: `dev-pm`, `planner-researcher`, `qa`, `designer` 등
- 날짜: 작성 당일 기준

예:
- `마이크루비교분석_planner-researcher_2026-06-04.md`
- `보안취약점보고서_qa_2026-06-04.md`

## SafeWrite로 저장

```
SafeWrite({
  path: "history/outputs/dev-pm/파일명_dev-pm_2026-06-04.md",
  content: "..."
})
```

## 주의사항

- `wiki/` 디렉터리는 **5KB 제한** — 장문 산출물은 반드시 `outputs/`에 저장
- wiki의 `index.md` "주요 산출물" 섹션에는 자주 참조하는 것 **최대 5건**만 등록
- 5건 초과 시 덜 중요한 항목을 제거 (나머지는 `history/outputs/`에서 Glob/Read로 탐색)
- 기존 파일 **덮어쓰기 금지** — 날짜/타임스탬프를 붙여 신규 파일로 작성

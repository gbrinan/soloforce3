# 인제스트 핸드오프 규칙 (리서치·인터뷰 → 인제스트크랩)

리서치 산출물·페르소나 인터뷰를 온톨로지 코퍼스로 넘길 때의 유일한 규칙 문서.

## 흐름
1. **선택 게이트 [HARD]**: 산출물이 완성되는 시점(인터뷰 종료, phase 완료, summary 작성)에 작성 담당자(가상고객·인사이트리서처)가 사용자에게 묻는다 — "이 내용을 검색 코퍼스로 적재하도록 내보낼까요?" **사용자가 예라고 한 것만 내보낸다.**
2. **내보내기**: 아래 규격의 파일을 두 곳에 생성한다.
   - 정본 인박스(크랩 적재용): `history/outputs/research/_ingest-inbox/`
   - 구글드라이브 미러(사람 열람용): `G:/내 드라이브/mycrew-ingest-inbox/` (bash cp/python으로 복사, 실패 시 정본만 남기고 보고)
3. **적재**: 사용자가 인제스트크랩에게 "인박스 적재해줘"라고 지시하면, 크랩이 인박스의 미적재 파일을 배치 적재한다.

## 파일명 규칙 [HARD]
`{YYYYMMDD}_{유형}_{프로젝트 또는 페르소나}_{주제슬러그}.md`
- 유형: `interview`(페르소나 인터뷰) | `summary`(리서치 요약) | `phase`(단계 보고서) | `desk`(데스크 리서치)
- 예: `20260808_interview_이규선_세럼카피AB.md`, `20260807_summary_cosrx-blue-peptide-serum_전체.md`

## 파일 규격 [HARD] — frontmatter 필수
```
---
type: interview | summary | phase | desk
project: {project-id 또는 "-"}
persona: {페르소나 이름 또는 "-"}
date: YYYY-MM-DD
origin: {mycrew 내 원본 경로}
synthetic: true          # 가상 페르소나 산출물이면 반드시 true
exported_by: {agent-id}
---
```
- 본문은 원본 마크다운 그대로(요약·가공 금지 — 가공은 적재가 아니라 리서치의 일).
- `synthetic: true` 문서는 크랩이 적재 시 온톨로지 메타에 가상 시뮬레이션 표기를 유지해야 한다 — 실측 데이터와 섞여 사실로 검색되면 안 된다.

## 인제스트크랩의 처리 규칙
- 인박스 파일은 **읽기 전용** (원본 불변 원칙). 적재 여부는 파일을 고치지 말고 자기 원장 `history/outputs/ingest-crab/ingest-inbox-ledger.md`에 기록한다 (파일명·content_hash·적재일·결과).
- frontmatter 없는 파일은 적재하지 않고 "건너뜀"으로 정산한다.
- 재적재 방지: 원장의 content_hash와 대조.

# fleet-status (skill-알바)

- **id**: fleet-status
- **owner**: dev-pm
- **설명**: 에이전트 함대 관제 한 장 요약 — 직원·작업·승인·할일·비용을 agent-deck 스타일 대시보드 텍스트로 압축 (asheshgoplani/agent-deck 개념 재해석 포팅)
- **키워드**: 함대, 관제, fleet, 현황, 상태 요약, 대시보드, 지금 뭐 돌아가, 작업 현황, 비용 현황, agent-deck, 미션컨트롤

## 알바 프롬프트
> `Agent` 도구로 이 스킬-알바를 스폰할 때, 아래 내용을 prompt 앞부분에 넣고 그 뒤에 구체적 작업 지시(기간 등)를 덧붙이세요.

당신은 My Crew의 함대 관제(fleet-status) 알바입니다. agent-deck("모든 세션을 한 터미널에서 — running/waiting/done + 비용")의 개념을 My Crew 데이터로 구현합니다. 목표: 사장님이 10초 안에 "지금 무슨 일이 벌어지고 있고, 뭐가 막혀 있고, 얼마 썼는지"를 파악하게 하는 한 장 요약.

### 데이터 소스 (SafeRead)
1. `history/jobs.json` — 작업. status별 분류(running/planning/queued=🟢 active, failed/outputs_missing=🔴 attention, completed=✅). **오늘·어제 것만** 집계 (createdAt 기준)
2. `history/agents.json` — 직원 명단 (id·name·team)
3. `history/approvals.json` — pending 승인만 (대기 중 승인 = 사장님 조치 필요 항목)
4. `history/genie-todos.json` — 미완료(done/cancelled 아닌) 할일 수와 최신 3건
5. `history/cost-log.jsonl` — 오늘 비용 합계(costUsd), 상위 지출 에이전트 3

### 규칙
- **재위임 절대 금지**: DelegateTask·Agent 등으로 다른 직원/알바에게 넘기지 말고, 당신이 직접 SafeRead로 읽고 직접 집계하라. 이 작업은 단순 읽기·세기다.
- 파일이 크므로 전체를 요약에 옮기지 말 것 — 집계 숫자와 대표 항목만
- 추측 금지: 파일에 없는 상태를 만들지 말 것
- 🔴 attention 항목은 반드시 사유(error 요약 40자)와 함께
- 완료 조건: 아래 형식의 요약을 (1) 텍스트로 보고하고 (2) SafeWrite로 `history/outputs/dev-pm/fleet-status-YYYYMMDD-HHMM.md` 에 저장. **파일 저장을 생략하지 말 것.**

### 출력 형식
```
🎛 FLEET STATUS — YYYY-MM-DD HH:MM
🟢 ACTIVE (n): 직원명 — 작업제목(40자) [status, 경과]
🔴 ATTENTION (n): 직원명 — 작업제목 [사유 40자]
⏸ 승인 대기 (n): 요약 1줄씩 (없으면 "없음")
📋 할일 미완료 n건 — 최신: …
💰 오늘 비용: $X.XX (상위: 직원A $x / 직원B $x / 직원C $x)
📊 오늘 작업: 완료 n · 실패 n · 진행 n
```

## 사용 이력 · 피드백
> 이 스킬-알바를 쓴 직원은 결과를 한 줄 남기세요 (성공/실패/개선점). owner가 이를 반영해 정의를 갱신합니다.

- 2026-07-23 시험 3회(아샬): ①1차 — 알바가 집계를 DelegateTask로 재위임하며 배회 → 프롬프트에 재위임 금지 추가 ②2차 — mycrew 인프라 버그(작업 본문 미전달, 07-17부터 재발)로 빈 지시 도착 ③3차 — 장시간 running 후 수동 취소. 정의 자체는 retrospective와 동일 패턴으로 건전하나, 위임 본문 미전달 버그 수정 전까지 시험 미통과 상태. 다음 시험 시 planGate:false + 본문 인라인 절차 필수.
- 2026-07-24 E2E 통과(아샬, planGate 경로): 세션 핸드오프 근본수정(projDir 인코딩) 후 계획→실행 연속 성공, 규정 형식의 FLEET STATUS 대시보드 정상 산출(ACTIVE/ATTENTION 실데이터). 잔여: 위임 래퍼가 붙이는 [시스템 지시-산출물 불필요] 때문에 파일 저장은 생략됨 — 파일 필요 시 요청에 저장 명시 지시 유지.

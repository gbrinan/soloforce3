# 작업 지표(Metrics) 가이드

## 배경

2026-07-06에 일부 에이전트의 모델 티어를 조정했다(dev-pm/planner → Sonnet, qa → Haiku). 이 변경이 실제 작업
품질에 어떤 영향을 미쳤는지 설문이 아니라 **자동으로 기록되는 지표**로 판단하기 위해 지표 계측(v1)을 도입했다.

## 무엇을 기록하는가 (개인정보 안전)

- **이벤트·결과만 기록한다.** 사용자 프롬프트 원문이나 파일 내용은 절대 기록하지 않는다(개인정보보호법 대응).
- 잡(job) 1건이 종결(완료/실패/산출물누락)될 때마다 아래 필드만 append-only로 `history/metrics.jsonl`에 저장한다:
  - `jobId`, `agentId`, `model`, `jobType`(작업 제목), `status`, `durationMs`, `costUsd`,
    `inputTokens`/`outputTokens`(v1은 0/0 고정 — 아래 한계 참조), `retried`, `approvalOverride`
- 지표 기록 실패(디스크 오류 등)는 절대 잡 처리 자체를 실패시키지 않는다 — 콘솔 경고만 남기고 무시된다.

## 핵심 지표

| 지표 | 의미 |
|------|------|
| 성공률 (successRate) | `completed / count` — 해당 에이전트/모델이 완료로 끝난 비율 |
| 재시도율 (retryRate) | `retried / count` — 산출물 검증 실패로 재제출된 비율 |
| 작업당비용 (avgCostPerJob) | `totalCostUsd / count` — 잡 1건당 평균 비용(USD) |
| 평균시간 (avgDurationMs) | 잡 시작~종료까지 평균 소요 시간 |

에이전트별(byAgent)과 모델별(byModel) 두 축으로 동일한 롤업을 제공하므로, "특정 에이전트가 모델 변경 후
성공률/재시도율이 나빠졌는지"를 바로 비교할 수 있다.

## API

- `GET /api/metrics/summary?days=7` — 최근 N일(기본 7일) 요약. `byAgent`, `byModel`, 최근 작업 목록(`recentTraces`,
  최대 50건)을 반환한다.
- `GET /api/metrics/trace/:jobId` — 특정 잡 1건의 지표 레코드를 조회한다. v1은 스텝별 타임라인이 아니라
  종결 시점의 단일 레코드가 곧 트레이스다. 없으면 `{ error: "not found" }`(404).

## 지표(지표) 패널 읽는 법

상단 메뉴에서 "지표" 탭을 열면:

1. **기간 선택** — 최근 7일/14일/30일 세그먼트 컨트롤.
2. **에이전트별 테이블** — 에이전트, 사용 모델, 작업수, 성공률, 평균시간, 작업당비용, 재시도율.
3. **모델별 테이블** — 같은 지표를 모델(Sonnet/Haiku 등) 기준으로 롤업. 모델 티어 변경 효과를 가장 직접적으로
   보여주는 뷰.
4. **최근 작업 목록** — 최근 잡을 상태 배지(완료/실패/산출물누락)와 함께 나열. 항목을 클릭하면
   `/api/metrics/trace/:jobId`를 조회해 해당 잡의 상세(모델, 소요시간, 비용, 재시도 여부, 승인 개입 여부)를 보여준다.

## v1 한계

- `inputTokens`/`outputTokens`는 0으로 고정되어 있다 — `jobs.ts`의 `addCostToJob()`이 입력+출력을 합산값으로만
  누적하고 개별 값을 분리 보관하지 않기 때문이다. 비용(`costUsd`)이 주요 판단 축이며, 토큰 분리가 필요하면
  `addCostToJob`에 `inputTokens`/`outputTokens` 필드를 추가하는 후속 작업이 필요하다.
- `approvalOverride`는 현재 항상 `"none"`으로 고정된다 — 승인 개입 이벤트를 잡 지표에 저렴하게 연결할 수단이
  아직 없다(v1 범위 밖).
- 스텝별(도구 호출 단위) 타임라인은 제공하지 않는다 — 잡 종결 시점의 단일 레코드가 v1 트레이스의 전부다.

## 관련 파일

- `src/server/metrics.ts` — 계측·집계 로직 (`recordJobMetric`, `summarize`, `getJobMetric`)
- `src/server/routes.ts` — `/api/metrics/summary`, `/api/metrics/trace/:jobId`
- `src/client/components/Metrics/MetricsPanel.tsx` — 지표 패널 UI
- `history/metrics.jsonl` — append-only 원본 로그

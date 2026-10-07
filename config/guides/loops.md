# 루프 (자동 반복 작업)

## 개요
루프는 스케줄(반복 작업)을 확장한 개념이다. 두 종류가 있다:
- **정기 루프**: 정해진 시간에 한 번 위임하고 끝(스케줄과 유사, 여러 단계를 묶을 수 있음).
- **완료까지 반복하는 루프**: "테스트 통과할 때까지" 처럼 완료 조건을 만족할 때까지 자동 재시도.

루프 정의는 YAML 파일 하나가 곧 하나의 루프다. 저장 위치: `<MYCREW_HOME>/loops/*.yaml`.

## 자연어로 루프 만들기

마이크루에게 이렇게 말하면 된다:
- "매일 새벽 2시에 테스트 통과할 때까지 자동으로 고쳐줘"
- "평일 아침 8시에 브리핑 자동으로 만들어줘"

마이크루가 정의 요약과 다음 실행 시각을 보여주고, 승인하면 `enabled: true`로 저장한다.

## YAML 필드

- `loop.id`: 고유 식별자.
- `loop.trigger.cron`: cron 표현식 (Asia/Seoul 기준).
- `loop.steps[].type`: `task`(1회 위임) 또는 `until_done`(완료까지 반복).
- `loop.steps[].done_condition`: `until_done`에는 필수. `check`(쉘 명령, exit 0=완료) 또는
  `completion_promise`(결과 텍스트에 포함될 정확한 문자열).
- `loop.steps[].max_iterations`: 최대 반복 횟수 (최대 25, 기본 5).
- `loop.steps[].model_tier`: `cheap`(저비용/경량) / `standard`(기본) / `frontier`(최고 성능). **이제 실제로 모델을 고정한다** — 가이드 문구가 아니라 해당 스텝의 위임 job이 지정된 모델로 실행됨(cheap→claude-haiku-4-5-20251001, standard→claude-sonnet-4-6, frontier→claude-opus-4-7, `MODEL_TIER_*` 환경변수로 override 가능). 미지정 시 담당 에이전트 기본 모델 유지.
- `loop.budget`: 실행당/일일/월간 비용·시간 한도.
- `loop.approval.mode`: `draft_only`(기본, 외부 발신 금지) 또는 `auto`.

## 5중 안전장치

1. **최대 반복 횟수** — `max_iterations` (하드캡 25). 이 값을 초과해 반복시키는 정의는 저장 시 자동으로 25로 조정된다.
2. **예산 자동 일시정지** — 실행당/일일/월간 한도 초과 시 실행 중단 또는 루프 자동 일시정지.
3. **진행 없음 감지** — 결과가 연속으로 동일하면(`no_progress_after`) 무한 루프로 보고 중단.
4. **연속 실패 자동 일시정지** — 3회 연속 실패하면 루프가 자동으로 멈추고 알림.
5. **완료 조건 게이트 필수** — `until_done` 스텝은 `check` 또는 `completion_promise` 없이는 등록 자체가 거부된다.
   모델이 스스로 "다 했다"고 선언하는 것만으로는 절대 종료되지 않는다.

## 예산·일시정지·검토 주기

- `budget.max_runs_per_day`, `budget.monthly_cap_usd` 등으로 과금 폭주를 막는다.
- 사이드 패널 또는 API로 언제든 일시정지(`pause`)/재개(`resume`) 가능.
- `expiry.review_after_days`(기본 30일) 동안 아무도 확인하지 않은 루프는 채팅으로 리마인더를 보낸다.
  자동으로 꺼지지는 않는다 — 사용자가 계속 실행할지 판단해야 한다.

## 사용자 예상 질문 → 답변 포인트

- "루프가 뭐야?" → 스케줄보다 강력한 자동 반복 작업. 완료할 때까지 재시도하는 것도 가능하다.
- "비용이 무한정 나가지 않아?" → 실행당/일일/월간 한도를 설정할 수 있고, 초과하면 자동으로 멈춘다.
- "루프가 이상한 짓을 하면?" → `approval.mode: draft_only`(기본값)면 외부 발신·결제·삭제가 금지되고 산출물은 초안으로만 저장된다.
- "루프 확인 안 하면?" → 30일(기본) 지나면 검토 리마인더가 온다. 자동으로 꺼지지는 않는다.

## 관련 위치
- 정의 파일: `<MYCREW_HOME>/loops/*.yaml`
- 실행 이력: `history/loops/<loopId>/runs.jsonl`
- 상태: `history/loops/<loopId>/state.json`
- API: `GET /api/loops`, `GET /api/loops/:id/runs`, `POST /api/loops/:id/run|pause|resume|reviewed`

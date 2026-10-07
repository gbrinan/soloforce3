# Retry findings

- 기존 Claude 인증은 복구됐다. native CLI의 실제 control initialize 응답에서 모델 목록을 얻었다. `model-catalog.json`은 호출 성공 증거가 아니다.
- 실제 IngesTiger 응답은 확보했지만 후보 저장은 세 번 모두 완료하지 못했다. 원본 응답과 세션 ID는 JSON 파일에 보존했다. 정본 수용/반영 및 직원 인계는 0건이다.
- 첫 실행의 관측 코드가 modelUsage 키 두 개를 다른 모델로 오판했다. 키에는 alias와 auxiliary 작업이 함께 포함될 수 있다. 후속 실행은 assistant.message.model을 직접 기록했다.
- 첫/세 번째 응답의 evidence는 string이지만 실제 계약은 string[]이다. 두 번째 응답은 JSON 코드블록 뒤 Processing note를 포함했다. 기존 검증기가 이를 거절하는 것은 정상이다. 새 fenced JSON 회귀 테스트는 순수 fenced JSON 수용을 확인해 파서 결함 가설을 기각했다.
- 첫 응답은 담당 부서 미정을 decision으로 분류하고 원문에 없는 2026-09-14 시점을 추가했다. 두 번째 응답도 원문에 없는 기한/준비 상태를 추론했다. 세 번째는 한국어 조건을 개선했으나 evidence 계약을 여전히 어겼다. 모두 수용하지 않았다.
- jobs.ts에서 실제 job UUID 대신 직원별 고정 문자열을 adapter에 넘기는 결함을 재현했다. 실제 큐를 사용하는 관측 adapter 회귀 테스트 red/green을 확보했다. 수정은 기존 jobId를 전달하는 여섯 호출 지점에 한정했다.

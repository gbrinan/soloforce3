# Windows Sonnet 실제 연속 협업 검증 보고서

TLDR: **Windows 네이티브 실행, 실제 모델 호출, 서로 다른 실제 모델의 연속 협업을 각각 통과로 판정한다.** IngesTiger는 사용자가 선택한 Sonnet 5로 합성 규정을 분석했고, Opus 5 전문 직원이 WikiSearch/WikiRead/WikiHandoff를 호출해 Sonnet 5 Corpus Keeper에게 인계했다. Keeper는 실제 CSV를 조인해 V001=2,000원, V002=3,000원, 합계=5,000원 보고서를 만들고 WikiRecordUsage까지 완료했다. 실제 직원 PTY 재시작만 Windows CLI 신뢰 화면에서 종료돼 미검증이다.

## 독립 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| Windows 네이티브 설치·실행 | 통과 | Node 24.14.0, npm 11.9.0, Python 3.14.6, 의존성 설치·필수 검사·build, 서버/MCP/UI 확인 |
| 실제 모델 호출 | 통과 | Sonnet structured output 세션 `e453c0b0-c721-4c10-bd24-03ff54377ff2`, 비용·토큰 및 실제 응답 보존 |
| 실제 다중 모델 연속 협업 | 통과 | Opus 5 직원 job `53cd3647-...` → Sonnet 5 Keeper job `5ea0d199-...`, 두 작업 completed |
| Wiki 인용 결과물·사용 기록 | 통과 | 네 판 1 citation, 행 25/27/28/29, SHA-256·작업 UUID 대조 |
| 실제 직원 PTY 재시작 | 미검증 | 두 시도 모두 모델 호출 전 clone trust 화면에서 `agent_pty_terminated` |
| Wiki 화면 | 부분 통과 | 실제 저장 작업 `c303cfa9...`, 후보 1개, 원본 판 일치를 실제 WikiPanel에서 확인. 인용 결과물 상세 화면은 미확인 |

## 환경과 보존

- 저장소: `C:/Users/user/Documents/Codex 2/soloforce2-windows-collaboration`, Git branch `codex/windows-collaboration-verification`.
- 실행 기반 commit: `162cdcb1619705b1709b01be78d2ea763af466dc`; origin/main은 조회 시 `390872c70b310d2d9f1a5732ccc596ac18c326f7`.
- Windows NT 10.0.26200. Windows Node `C:/Program Files/nodejs/node.exe` v24.14.0, npm 11.9.0. WSL Node는 사용하지 않았다.
- Python은 `py -3`로 확인한 `C:/Users/user/AppData/Local/Python/pythoncore-3.14-64/python.exe` v3.14.6. bare `python` Store alias는 사용하지 않았다.
- Claude native CLI 2.1.263, 기존 claude.ai Max 인증 사용. 인증 파일과 비밀값을 복사·출력·커밋하지 않았다.
- 격리 root: `verification/windows-schema-live/runtime 한글 gAnL1j`, port 3488. 기존 서비스·사용자 `.env`·history·원본·미커밋 변경은 건드리지 않았다. 모든 작업 종료 후 3488 서버를 중지했다.
- 읽기 전용 실제 Wiki component preview는 127.0.0.1:3490에서 확인했다. 추가 모델 호출과 수정 API를 차단한 검증 surface다.
- 기존 서버가 만든 미추적 `config/mail-scan-filters.json`은 보존하고 커밋하지 않는다.

## 구조화 IngesTiger 분석

Claude CLI의 `--json-schema`에 기존 `WikiResponseSchema`를 draft-07로 전달한다. 설치 CLI가 zod 기본 draft 2020-12의 `$schema`를 거절했기 때문에 지원 dialect로 바꿨으며, evidence 배열·strict 객체·크기 제한은 동일하다. structured_output이 없거나 API error면 실패시킨다. 일반 gateway 텍스트 응답은 기존 동작을 유지하고 schema 호출은 warm session을 사용하지 않는다.

- 요청/실제 모델: `claude-sonnet-5` / `claude-sonnet-5`.
- 분석 job: `c303cfa9d4f60db91e37e6dd9c47bd3f01b374daa347a560dd706e2861e33e22`.
- 실제 CLI 세션: `e453c0b0-c721-4c10-bd24-03ff54377ff2`.
- 표시 비용: $0.072355.
- 후보 4개는 적용일 2026-10-01, 시스템의 주문 초안 작성 제한, 사람의 최종 주문 실행, 자동 주문 금지, 담당 부서 미정을 보존한다.
- `codex:synthetic-test`가 합성 원문과 대조해 수용했다. reason에 실제 사람의 업무 승인이 아님을 명시했다.
- 지식 판 1: `K-4e36a47c-...`(초안 제한), `K-3d1c5522-...`(사람 실행), `K-f1bad91a-...`(자동 주문 금지), `K-86d2ffc2-...`(부서 미정). 전체는 [검토 증거](reviewed-knowledge.json)에 있다.

## 실제 Opus → Sonnet 연속 협업

전문 직원은 실제 assistant message에서 `claude-opus-5`로 관측됐다. `거래처별 금액 집계` 검색 결과와 별개로 mandatory를 확인했고, 빈 검색으로 네 정본을 찾은 뒤 WikiRead 4회, WikiHandoff 1회를 실제 호출했다. 목적은 `join_aggregate`, 대상은 `corpus-keeper`다.

- 전문 직원 job `53cd3647-1f99-4604-a909-0923af9dd539`, session `8d2139ad-1370-4467-a84c-851a5b823c6e`, 상태 completed.
- Corpus Keeper job `5ea0d199-a53c-4351-a298-7329de586a72`, session `def5ba78-ef5b-4340-91cd-cd0992e21db4`, 실제 모델 `claude-sonnet-5`, 상태 completed.
- Keeper는 SafeRead로 두 CSV를 읽고, SafeWrite로 Node ESM 계산 스크립트를 저장하고, SafeBash로 실행했다. 결과: V001 가상상사 2건 2,000원, V002 예시물산 1건 3,000원, 전체 5,000원, 미매칭 없음.
- 보고서: [거래처 집계 보고서](거래처%20집계%20보고서.md). 적용일과 모든 제약·미결정을 포함하며 실제 주문·업무 승인 아님을 명시한다.
- 구조화 증거: [직원·사용 기록](worker-evidence.json), [Opus transcript](windows-analyst-transcript.json), [Keeper transcript](corpus-keeper-transcript.json).

WikiRecordUsage ID는 `c966183bbc51c1bbfadc53b01041c562d50e56c09b02fc1b79b2663a66bf1de0`, 결과물 SHA-256은 `2f640a73880a7dee55fffec8948e48d3a9bd4c839afbaebb525e8efb24703f0b`다. citation 행은 초안 제한 25, 사람 실행 27, 자동 주문 금지 28, 부서 미정 29다. 저장 파일을 다시 해시하고 각 행에 citation이 실제 존재하는지 확인했다. receipt jobId는 Keeper의 실제 큐 UUID와 일치한다. ACK는 analyst 완료로 계산하지 않았고 두 실제 job이 completed가 된 후 결과물을 검사했다.

## 실패·변경 및 권한 시나리오

이전 Windows 실제 HTTP/stdio MCP surface 및 최종 `test:wiki-collaboration`에서 다음을 통과했다: 검색 밖 mandatory, 수신 직원 읽기 권한 없을 때 handoff 거절, 판 변경 후 이전 판 handoff/usage 차단, 원본 변경 상태와 적용 차단, citation 누락 usage 거절, 기록 후 파일 변경 감지, 직원 조회 token의 review/commit 403, 한글·공백 경로, stdio MCP 새 프로세스에서 네 도구 재등록. 이 검사는 합성 fixture이며 이번 실제 직원 성공과 별도로 판정한다.

실제 collaboration 과정에서 호스트 자동 QA가 코드 변경 표본으로 오인해 QA 작업 두 개와 Genie 알림 호출을 추가했다. 두 QA job은 격리 범위에서 취소해 failed terminal 상태로 남겼고, 재현 harness에 `AUTO_QA_TRIGGER=false`를 추가했다. 실제 analyst와 Keeper completed 상태에는 영향이 없다.

## 비용과 검사

- IngesTiger Sonnet: $0.072355.
- Opus 전문 직원: $1.0827865.
- Sonnet Keeper: $0.9364234.
- 예상하지 못한 격리 Genie 알림 4회: $0.8359211.
- 이번 성공 흐름의 로컬 표시 합계: **$2.926486**. CLI/host 목록가 계산이며 실제 청구액·계정 전체 사용량·잔여 예산은 확인할 수 없다. 새 유료 서비스나 구독은 구매하지 않았다.

최종 검사: `verify:ingestiger`, `test:ingestiger-role`, `test:wiki-product`, `test:wiki`, `test:wiki-collaboration`, `build` 모두 exit 0. 새 schema/harness strict typecheck와 `wiki-gateway-schema-test.ts`도 exit 0. [exit 코드](final-checks.txt).

## 변경 파일과 미검증 범위

- `src/server/ai-gateway.ts`, `src/server/ai-gateway-response.ts`: 선택적 JSON Schema CLI 전달과 structured_output 처리.
- `src/server/wiki/execution.ts`: 기존 WikiResponseSchema를 draft-07 JSON Schema로 강제.
- 회귀 및 실제 검증 스크립트·운영 문서·이 보고서 추가.
- IngesTiger upstream pin은 바꾸지 않았다. 사용자의 명시 요청에 따라 격리 검증 모델만 Sonnet으로 설정했다.

실제 직원 PTY는 clone trust 화면에서 두 번 종료됐고 모델/도구 호출이 없었다. CLI trust 값을 강제로 편집하지 않았다. 일반 Claude `-p` 경로, 실제 다중 모델 협업, Windows 실행은 독립적으로 통과한다. PTY 재시작만 미완료다.

반대 관점: structured output은 형식 오류를 막지만 의미 정확성을 보장하지 않는다. 이번 수용은 합성 원문 전체가 한 단위이고 다섯 조건을 사람이 직접 대조한 제한된 검증이다. 운영 문서에는 이 검토 단계를 계속 필수로 둔다.

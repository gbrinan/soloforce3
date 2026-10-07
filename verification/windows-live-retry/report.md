# Windows 실제 호출 재시도 검증 보고서

TLDR: 인증 복구 후 실제 IngesTiger 응답 3회를 확보했다. 그러나 세 번 모두 후보 저장까지 실패해 정본 반영, 전문 직원 인계, Corpus Keeper 완료, 다중 모델 협업은 미완료다. 작업 ID 전달 결함은 수정하고 실제 큐 경계의 회귀 검사와 필수 검사·빌드를 통과했다.

## 독립 판정

| 대상 | 판정 | 관측 근거 |
|---|---|---|
| Windows 실행 | 부분 통과 | 네이티브 Node/Python, 설치·빌드·서버·HTTP/stdio MCP 통과. 실제 직원 PTY는 미검증 |
| 실제 모델 호출 | 통과 | 실제 Claude 응답·세션·비용 확보. 분석 결과 수용 성공과 다름 |
| IngesTiger 분석 → 정본 | 실패 | evidence 배열 계약 및 JSON-only 출력 불충족. 정본 반영 0건 |
| 실제 직원 간 연속 협업 | 미완료 | 수용된 실제 모델 정본이 없어 B→C 실행하지 않음 |
| 서로 다른 모델 협업 | 미완료 | 계정 모델 목록만 확인. 두 직원의 실제 실행 모델 증거 없음 |
| 실제 Wiki 화면/직원 PTY 재시작 | 미검증 | 이전 로그인·약관 화면과 바이너리 기동 검사를 실제 작업 완료로 계산하지 않음 |

## 환경·버전·서비스

- 저장소: `C:/Users/user/Documents/Codex 2/soloforce2-windows-collaboration`, Git clone, branch `codex/windows-collaboration-verification`.
- Windows NT 10.0.26200, native Node v24.14.0, npm 11.9.0, native Python 3.14.6. Git Bash에서 Windows exe를 사용했으며 WSL Node는 사용하지 않았다.
- Python 실행 경로는 `py -3`로 확인한 `C:/Users/user/AppData/Local/Python/pythoncore-3.14-64/python.exe`; bare python은 Store alias여서 사용하지 않았다.
- Claude native 2.1.263, 기존 claude.ai Max 인증을 사용했다. 인증 파일 복사 없음.
- 기준 HEAD `2e3bcf7775a120ab7f4ddc4d0cafd821f11eef0b` 위 jobs.ts 로컬 수정으로 검사했다. 재조회한 origin/main은 `390872c70b310d2d9f1a5732ccc596ac18c326f7`; 이후 변경 없음. [Git 조회](git-check.txt).
- 기존 격리 서버 127.0.0.1:3487은 health 200/ok=true, jobs 200/0건. PID 53360. 이번 수정 이전에 시작한 프로세스이며 이번 jobId 수정의 실서비스 검증으로 계산하지 않는다. 실제 모델 분석과 큐 회귀 검사는 새 프로세스에서 실행했다. [상태](server-state.json).
- 실제 분석은 매번 별도 MYCREW_HOME/WORKSPACE_ROOT의 `runtime 한글 ...`에서 실행했다. [첫 실행](first-run.json), [둘째](second-run.json), [셋째](run.json). 기존 3456 서비스, 사용자 .env/history/원본/직원 설정은 변경하지 않았다. 격리 runtime은 증거 보존을 위해 남겨 Git에서 제외했다.
- 새 유료 서비스·구독 구매, 원격 push·PR·배포 없음. 비밀값 출력·커밋 없음. 기존 서버 생성 파일 `config/mail-scan-filters.json`은 미추적 상태로 보존했다.

## 실제 모델 응답과 분석 실패

고정 요청 모델은 `claude-haiku-4-5`로 유지했다. 실제 assistant 메시지의 모델 ID는 `claude-haiku-4-5-20251001`로 관측했다. [관측값](ingestiger-observed-models.json). modelUsage의 alias/보조 호출 키를 서로 다른 직원 모델로 세지 않는다.

| 실행 | 실제 CLI 세션 ID | 표시 비용 USD | 결과 |
|---|---|---:|---|
| 1 | 465c1640-fea7-47ba-b69d-f8a76da971fa | 0.026954 | 관측 코드가 modelUsage 키 2개를 거절. 원본도 evidence string과 미정 decision/근거 없는 날짜 포함 |
| 2 | 7fd48d0c-3f69-420d-9d9d-70c2b14b1f20 | 0.0112024 | JSON 뒤 Processing note로 wiki_model_invalid_json. 원문 밖 기한·준비 상태 추론 포함 |
| 3 | 9246abd8-d463-4ce8-a545-30d4b26858fb | 0.0168194 | 한국어 출력 개선, evidence가 string[] 대신 string이라 스키마 거절 |

원본: [1](ingestiger-first-response.json), [2](ingestiger-second-response.json), [3](ingestiger-response.json). 셋째 Wiki 준비 job ID는 `eed506799337e692af3a9791b79a71d54ee235f58a15f4b39e9d2af3b520af28`, request ID는 `0421d9d3d933412798dd121652fbce9d0a002a890a536daa697b58df083c62c9`. 이는 직원 작업 큐 UUID와 다른 IngesTiger 준비 ID다. 모든 실제 실행 scope는 `synthetic/windows-collaboration`이다.

실제 모델을 쓰는 검증 runner는 WikiExecution에 주입하여 native Claude를 호출했다. production buildBaseArgs/safeChildEnv, host 역할·준비 prompt·고정 모델·tool-less 계약을 사용하되 최종 응답과 실제 assistant 모델을 보존했다. 셋째는 원문 밖 추론 금지와 한국어 출력 조건을 추가 전달했다. 기본 gateway 그대로의 운영 경로와 구분한다. 모델 결과의 evidence를 사람이 배열로 고쳐 통과시키거나 검사기를 완화하지 않았다.

모든 응답은 수용하지 않고 보존했다. 스키마를 통과한 후보가 없으므로 정식 review hold 기록도 생성할 대상이 없었다. 테스트 검토자 수용/정본 반영은 0건이며 실제 사람의 업무 승인 기록도 없다. 따라서 새 지식 ID·판·인용 위치·결과물 해시·사용 기록·인계 대상 작업 ID·완료 증거는 없다. 이전 합성 fixture의 지식을 실제 모델 결과로 재사용하지 않았다.

[모델 목록](model-catalog.json)은 현재 인증 상태에서 CLI control initialize로 얻었다. Haiku와 Sonnet(`claude-sonnet-5`)을 직원 조합으로 고려했으나 실제 두 직원 실행 전 단계가 실패해 사용 가능 호출 성공으로 보고하지 않는다.

## 비용

세 응답 표시 비용 합계는 **0.0549758 USD**다. modelUsage에는 costBasis=list가 표시돼 실제 계정 청구액을 의미하지 않는다. 최종 응답 usage 합계: input 30, output 5168, cache-read 16668, cache-create 11532 tokens. 보조 내부 호출은 modelUsage에 따로 있으므로 이 합계를 계정 전체 토큰으로 해석하지 않는다. 모델 목록 조회 비용, 계정 전체 사용량·잔여 예산·최종 청구액은 확인하지 못했다.

## 코드 수정과 재검사

`src/server/jobs.ts`의 여섯 adapter.execute 호출이 기존 직원별 고정 label 대신 실제 jobId를 전달하도록 수정했다. Wiki capability/사용 기록을 실제 큐 작업과 대조할 수 있게 하는 수정이다. jobId 없는 직접 호출의 기존 label은 유지했다.

- Red: 실제 createJob UUID `c721b376-9d74-4033-967c-a5c57e12e551` 대신 `identity-probe-job`이 adapter에 도착해 실패.
- Green: 최종 반복의 UUID `b0fa56d8-e476-490d-9035-41fdef2bf9ba`가 adapter에 그대로 도착. 관측 adapter는 합성이므로 실제 모델의 WikiRecordUsage 종단 검증은 아님.
- 순수 fenced JSON 응답은 기존 파서로 통과했다. 파서 결함 가설을 기각했으며 생산 코드의 JSON 검사를 수정하지 않았다.
- 스크립트 중간 문자열 편집 오류로 1회 구문 오류가 있었으나 모델 호출 전 실패였다. 수정 후 별도 strict 타입 검사 통과.

| 명령 | 결과 |
|---|---|
| npm.cmd run verify:ingestiger | exit 0 |
| npm.cmd run test:ingestiger-role | exit 0 |
| npm.cmd run test:wiki-product | exit 0 |
| npm.cmd run test:wiki | exit 0 |
| npm.cmd run test:wiki-collaboration | exit 0 |
| npm.cmd run build | exit 0 |
| node --import tsx scripts/wiki-job-identity-test.ts | 통과, 실제 큐 + 합성 adapter |
| node --import tsx scripts/wiki-model-json-test.ts | 통과, 합성 응답 |
| 추가 스크립트 strict tsc --noEmit 검사 | exit 0 |

[검사 exit 코드](check-results.txt), [타입 검사](script-typecheck-result.txt), [파서 검사](fenced-json-result.txt). 로그는 로컬 .log로 보존하고 Git에서 제외했다. npm ci와 Windows 설치는 [앞선 보고서](../windows-20260914/report.md)의 실행 결과이며 이번에는 재설치하지 않았다.

## 나머지 요구와 한계

읽기 권한 없는 수신자 거절, 이전 판 인계/사용 차단, 원본 변경, 인용 누락, 파일 변경, 직원 토큰의 검토/반영 거절, 한글·공백 경로, 실제 stdio MCP 재시작은 [이전 표면 증거](../windows-20260914/surface-result.json) 및 이번 test:wiki-collaboration으로 확인했다. 이는 합성 fixture이며 실제 직원 협업의 증거가 아니다. V001=2000/V002=3000/합계5000도 이전 호스트 계산만 있고 실제 Corpus Keeper 보고서는 없다.

일반 -p/PTY/Genie 도구 구성 검토와 네 Wiki 도구의 실제 stdio 호출은 앞선 보고서에 있다. 실제 직원 PTY 작업/재시작 및 Wiki UI의 인용 결과물 표시는 아직 확인하지 못했다.

반대 관점: 세 번째 응답의 주요 문구가 원문과 가까워졌다는 이유만으로 evidence를 보정해 후속 작업을 진행하면, 고정 모델 분석 계약 자체의 실패를 숨기게 된다. 정본을 만들지 않고 실패를 남긴 것이 이번 판정의 한계이자 재현 가능한 결과다.

작업공간 AGENTS.md의 “같은 작업이 세 번 실패하면 접근을 중단하고 사람에게 필요한 결정을 구체적으로 요청한다”에 따라 네 번째 유료 분석 호출은 실행하지 않았다. 재개 결정은 **고정 모델/pin을 유지하면서 호스트 호출에 명시적 JSON 스키마 강제를 추가하는 수정 경로를 진행할지**다. 이 경로는 아직 구현·검증하지 않았다.

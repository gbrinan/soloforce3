# Soloforce2 Windows 협업 검증 — 2026-09-14

TLDR: **Windows 설치·빌드·HTTP 서버·Wiki MCP 기능 검사는 통과했다. 실제 모델 호출은 OAuth 만료로 실패했으며, 실제 직원 간 연속 협업과 다중 모델 검증은 미완료다.** 합성 응답·호스트 집계를 실제 모델 작업으로 계산하지 않았다.

> 후속 기록: [인증 복구 후 실제 호출 재시도](../windows-live-retry/report.md). 아래 OAuth 실패는 최초 실행 당시 결과입니다.

## 독립 판정

| 대상 | 판정 | 근거 |
|---|---|---|
| Windows 네이티브 실행 | 부분 통과 | Node/Python, npm ci, 빌드, 일반 서버 health, TCP/stdio MCP, ConPTY 바이너리 기동 통과. 직원 PTY 작업 완료는 미검증 |
| 실제 IngesTiger 모델 호출 | 실패 | host 호출 wiki_model_failed. 별도 CLI 진단: OAuth session expired and could not be refreshed |
| 서로 다른 모델의 연속 협업 | 미완료 | 실제 사용 가능 모델을 확인할 인증이 없음. 설정 이름·정적 모델 목록으로 성공을 주장하지 않음 |
| 합성 Wiki 기능 | 통과 | 실제 Python 저장, TCP HTTP와 stdio MCP, 인용·권한·변경 검사를 반복 실행 |
| 실제 Wiki 화면 | 미완료 | 전체 서버 화면은 약관·Google 로그인 단계. 동의·로그인을 대신 수행하지 않음 |

## 실행 환경과 보존

- 최초 위치: `C:\Users\user\Documents\Codex 2`.
- 실행 저장소: `C:\Users\user\Documents\Codex 2\soloforce2-windows-collaboration`. ZIP이 아닌 새 Git clone.
- 원격: https://github.com/gbrinan/soloforce2.git. 조회 당시 origin/main = `390872c70b310d2d9f1a5732ccc596ac18c326f7`. 대상 commit 조상 검사 exit 0. 이후 원격 commit은 조회 당시 없었다.
- Windows NT 10.0.26200, Node `v24.14.0`, npm `11.9.0`, Python `3.14.6`. WSL/Linux Node를 사용하지 않았다. 명령 전달은 Git Bash, 실제 런타임은 Windows exe다.
- Node: `C:\Program Files\nodejs\node.exe`.
- Python: `C:\Users\user\AppData\Local\Python\pythoncore-3.14-64\python.exe`. `python`은 Windows 실행 별칭으로 실패; `py -3`로 경로 확인.
- Claude: PATH의 npm 설치본 2.1.210, native `C:\Users\user\.local\bin\claude.exe` 2.1.263. 둘 다 로그인 상태 false. 실호출 진단은 native exe 사용.
- 별도 `MYCREW_HOME`/`WORKSPACE_ROOT`: [surface-result.json](surface-result.json)의 root. 한글·공백 경로이며 실행마다 독립 생성.
- 기존 3456 listener와 기존 checkout의 staged/unstaged 변경·history·원본·.env는 갱신하거나 삭제하지 않았다. 3456 health는 제한 시간 내 응답이 없어 정상/비정상 원인을 단정하지 않았다. CIM 조회 불가로 netstat를 사용했다.
- 서버: `127.0.0.1:3487`, 일반 `npm.cmd start` 사용, DRY_RUN 아님. 인증 자료를 복사하지 않았다. bootstrap 설정 쓰기는 별도 `CLAUDE_CONFIG_DIR`에 한정했다. 이 설정은 기존 CLI 인증을 옮기는 수단이 아니다.
- 기존 직원 설정을 수정하지 않았다. 새 서버의 기본 직원·보조 설정은 합성 환경 안에 생성됐다. 서버가 새 `config/mail-scan-filters.json`도 생성했으며 미추적 파일로 남겼다.
- 검증 서버의 `/api/jobs`가 HTTP 200, 0건임을 확인한 후 해당 PID만 종료하고 최신 합성 데이터로 재시작했다. Windows SIGTERM은 graceful shutdown 완료를 보증하지 않으며, 이때 활성 작업은 없었다.

## 명령과 검사 결과

로그 파일은 이 보고서와 같은 로컬 폴더에 보존하며 Git에 넣지 않는다.

| 실행 | 결과 |
|---|---|
| git clone --branch main; git fetch origin; git pull --ff-only origin main | 완료, main 대상 commit 일치 |
| node --version; npm.cmd --version; py -3 --version | 위 버전 확인 |
| npm.cmd ci | exit 0, Windows에서 신규 설치 |
| npm.cmd run verify:ingestiger | exit 0 |
| npm.cmd run test:ingestiger-role | exit 0 |
| npm.cmd run test:wiki-product | exit 0, 합성 모델 응답 사용 |
| npm.cmd run test:wiki | exit 0 |
| npm.cmd run test:wiki-collaboration | exit 0, 위임 콜백 사용, 실제 직원 실행 아님 |
| npm.cmd run build | 첫 시도는 설치 중 tsc shim 부재로 실패. 설치 완료 후 동일 코드 재실행 성공 |
| node --import tsx scripts/wiki-windows-surface-test.ts | 두 번 통과, 각 실행에서 실제 MCP 프로세스를 두 번 기동 |
| 새 스크립트 strict TypeScript 검사 | [typecheck-result.txt](typecheck-result.txt) |
| native ConPTY에서 claude.exe --version 2회 | exit 0, 버전 출력 확인. 모델/직원 실행 아님 |
| npm.cmd start, /api/health | 일반 서버 기동, HTTP 200, ok=true |
| /api/wiki/capabilities | Python 3.14.6, pin probe 성공; modelConnection=not_checked |

의존성 설치가 73개 취약점(낮음 2, 보통 47, 높음 24)을 보고했다. 이번 변경과 무관한 전체 의존성을 자동 업그레이드하거나 `audit fix --force`로 변경하지 않았다. 빌드는 큰 chunk/플러그인 시간 경고를 남겼다.

## 실제 모델 호출과 미완료 인계

1. 기본 fixed-contract `claude-haiku-4-5`로 `test:wiki-live -- --confirm-real-call --output ...`을 실행했다. 합성 자료를 사용하고 임시 history를 분리했지만 `wiki_model_failed`로 종료했다. 이 기본 스크립트의 scope는 `synthetic/real-call`이며, 요구된 `synthetic/windows-collaboration` 연속 협업과 구분한다.
2. 도구·MCP·세션 저장을 끈 native CLI 진단을 1회 실행했다. 응답은 `is_error=true`, `terminal_reason=api_error`, `Failed to authenticate: OAuth session expired and could not be refreshed`였다. `subtype=success` 필드만 보면 오판하므로 사용하지 않았다.
3. 진단 session ID: `451e6c5d-1338-499e-9284-709da56502bb`. 실제 modelUsage는 빈 객체, API 처리 시간 0, 입출력 토큰 0, reported cost 0 USD. 모델이 실제 응답했다는 증거가 없다.
4. 전문 직원·Corpus Keeper의 실제 작업 ID, 완료 응답, 서로 다른 실제 모델 ID는 **없다**. 실행하지 않은 인계 작업을 완료 처리하지 않았다. 사용 가능 모델을 정적 adapter 목록에서 추정하지 않았다.
5. 사용자에게 Windows 기존 계정 로그인 완료 여부만 요청했다. 인증값을 채팅으로 요청하거나 다른 환경의 인증 파일을 복사하지 않았다. 실패 확인 후 같은 호출을 반복하지 않았다.

호스트 실패의 비용은 성공 ledger가 없어 독립적으로 확정할 수 없다. 진단 호출의 0 USD는 도구가 보고한 값이며 계정 전체 사용량·실제 청구액·남은 예산을 증명하지 않는다. 신규 유료 서비스·구독 구매는 없었다.

## 요구된 합성 범위의 기능 증거

아래는 **테스트 코드가 생성한 후보와 집계**다. IngesTiger 모델의 분석 품질이나 직원의 계산 성공 증거가 아니다.

- scope: `synthetic/windows-collaboration`.
- 원문: “2026-10-01부터 시스템은 주문 초안만 작성한다. 최종 주문은 사람이 실행한다. 자동 주문은 금지한다. 담당 부서는 아직 정하지 않았다.”
- 후보에 원문 전체를 그대로 넣고 `codex:synthetic-test`로 원문 대조를 기록했다. 사람의 업무 승인으로 표시하지 않았고 `claim_status=source_reported`를 유지했다.
- 마스터 V001=가상상사, V002=예시물산과 거래 1200/800/3000을 vendor_code로 실제 코드 조인·집계: V001=2000, V002=3000, 합계=5000원.
- 지식 ID `K-2cd67367-1c78-4c02-a554-b937df58f899`, 사용 기록 판 1. 변경 검사 후 현재 판 2.
- Wiki 준비 job ID `e1ac7f5e9d3f015fc5891e481d6cbda98b753749da68e3ad5a384e34815a043b`.
- MCP 검사 grant의 job ID는 `synthetic-http-mcp`. 실제 작업 엔진이 만든 직원 job ID가 아니다.
- citation: `[[wiki:synthetic/windows-collaboration/K-2cd67367-1c78-4c02-a554-b937df58f899@1]]`. WikiRead 반환값을 원문 규정 바로 옆 5행에 넣었다.
- 사용 기록 ID `3296a827874d02b3d39112af212cde262783331d9f8cc2eb0418097af69997e4`.
- 기록 당시 SHA-256 `44dd8be4d93b962f9a2427c6ae1cee3e3e1f3e72835ae19cbde9cd81616da068`.
- 결과물: [거래처 집계 보고서](<합성 협업 환경 2yGeTG/history/outputs/analyst/거래처 집계 보고서.md>). 의도적으로 기록 후 수정한 상태를 보존했다. 최신 해시와 기록 당시 해시가 달라야 정상이다.
- [전체 구조화 증거](surface-result.json)는 인용 행, snapshot, 저장 경로, refs와 `knowledgeState=revised`, `sourceState=changed`, `outputState=changed`를 포함한다.

## 실패·변경 시나리오

| 시나리오 | 관찰 |
|---|---|
| 검색어가 규정과 불일치 | 검색 items 0, mandatory에 정본 포함; 실제 WikiSearch 호출 |
| 수신 직원 읽기 권한 없음 | WikiHandoff의 wiki_worker_scope_denied, 위임 콜백 미실행 |
| 판 1 → 2 | 이전 판 handoff HTTP 409와 usage 거절, wiki_revision_changed |
| 원본 내용 변경 | read의 changed 상태, 적용 bundle 거절 |
| citation 없음 | 실제 WikiRecordUsage의 wiki_citation_missing |
| 기록 후 결과물 수정 | outputState=changed |
| 직원 토큰으로 review/commit | 두 HTTP 요청 모두 403 |
| 한글·공백 Windows 경로 | 저장·MCP 조회·파일 SHA-256 비교 통과 |
| MCP 자식 프로세스 재시작 | 새 stdio 프로세스에서 네 도구 재등록·호출 통과 |
| 직원 PTY 재시작 후 Wiki 호출 | 미검증. ConPTY 버전 실행만 별도 통과 |

일반 `claude -p`는 `src/agent.ts`, 상주 직원은 `src/server/worker-pty.ts`, Genie는 `src/server/terminal-ws.ts`에서 Wiki 도구 설정을 확인했다. 직원 PTY token은 활성 작업 동안만 유효하다. adapter registry에 `pty-adapter`가 등록되지 않은 경로에 대한 기존 코드 주석도 있어, PTY 코드를 읽은 것만으로 일반 작업이 해당 경로를 사용한다고 단정하지 않았다.

## 변경과 재개

- 추가: `scripts/wiki-windows-surface-test.ts` — 반복 가능한 합성 Windows 표면 검사.
- 문서: README-WINDOWS, 직원 협업 안내, config/wiki README의 오래된 “MCP 미연결” 문구 교정.
- 기존 테스트 삭제·검사 완화·고정 IngesTiger pin/모델 계약 변경 없음. 원격 push·PR·배포 없음.

실제 연속 협업 재개에는 Windows 터미널에서 `C:\Users\user\.local\bin\claude.exe auth login`으로 기존 계정 인증 복구가 필요하다. 비밀값은 공유하지 않는다. 이후 실제 계정에서 모델 가용성을 확인하고, 별도 새 MYCREW_HOME에서 요구된 scope로 원문 분석부터 다시 실행해야 한다. 이번 합성 정본을 실제 모델 분석 결과로 재사용하지 않는다.

새 체크아웃에는 `.env`가 없다. 필요하면 저장소 루트의 `package.json` 옆 `.env`에 `CLAUDE_PATH`, `INGESTIGER_PYTHON`, `MYCREW_HOME`, `WORKSPACE_ROOT`, `PORT`를 배치한다. 현재 서버는 프로세스 환경변수로 설정했다. 앱 로그인에 필요한 항목은 `.env.example`의 Google/SSO 설정을 따르며 임의 비밀값을 만들지 않는다.

반대 관점: MCP·권한 검사가 모두 통과해도 모델이 mandatory를 읽고 의미 조건을 보존하며 실제 위임을 끝내는지는 보장되지 않는다. 따라서 이번 결과로 운영 준비 완료나 다중 모델 협업 성공을 선언할 수 없다. 인증 복구 뒤 A→B→C 작업의 실제 모델 ID·작업 ID·완료 상태·인용 결과를 확인하는 단계가 남아 있다.

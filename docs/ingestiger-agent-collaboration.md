# 직원의 공유 Wiki 활용과 인계

2026-09-14. IngesTiger가 준비하고 검토자가 수용한 Wiki 정본을 일반 직원과 Genie가 조회하고, 다른 직원에게 근거와 함께 위임하며, 결과물의 인용 위치를 확인하는 호스트 기능이다. IngesTiger 공용 코어의 pin은 draft.6 그대로 유지한다.

## 실행 흐름

1. 요청에 기업·프로젝트 범위를 명시한다. 직원의 `WikiSearch`는 현재 정본을 검색하고, 검색어와 일치하지 않아도 해당 범위의 제약·미결정을 별도 mandatory 목록에 반환한다. 제목·내용의 단어 일치 검색이며 벡터·그래프 리랭킹은 아니다. 적용 범위를 자동 판정하지 않아 범위 전체의 제약·미결정을 확인 대상으로 제시한다.
2. `WikiRead`는 ID와 예상 판을 받아 조건·인용·원문 좌표·원본 변경 상태·citation을 반환한다. 판이 바뀌면 다시 조회해야 한다. 현재 판이나 인용 일치를 업무 승인으로 해석하지 않는다.
3. 다른 전문 직원이 필요하면 `WikiHandoff`에 구체적인 요청·목적·참조를 전달한다. 호스트가 발신·수신자의 읽기 권한, 판, 원본 상태를 확인한 뒤 기존 작업 위임 엔진을 호출한다. corpus-keeper는 join_aggregate 목적에만 인계하며 신규 ingest-crab은 ingestiger로 연결한다. 같은 요청은 60초 동안 중복 위임을 억제한다. ACK는 접수이며 완료가 아니다.
4. 직원은 자기 `history/outputs/<agent>/` 아래 Markdown 또는 텍스트 결과물에 `[[wiki:기업/프로젝트/K-ID@판]]` 인용을 적는다. `WikiRecordUsage`는 파일을 다시 읽어 인용 위치(행), 파일 해시, 지식 판·snapshot, 호스트가 부여한 작업·직원 ID를 기록한다. 내용상 적절한 활용을 검증하는 기능은 아니다.
5. Wiki 정본 화면의 **이 지식을 인용한 결과물 확인**에서 기록을 조회한다. 지식 판·원본·결과물이 바뀌면 재검토가 필요한 상태를 표시한다. 백그라운드 알림이나 결과물 자동 수정은 하지 않는다.

일반 Claude -p 직원, 상주 PTY 직원, Genie PTY에 도구와 공통 안내를 연결했다. 직원 PTY는 작업 실행 중에만 호출 권한이 활성화된다. 별도 어댑터가 SafeFS를 사용하지 않으면 이 도구를 자동으로 사용할 수 없다. 기존 대화는 새 실행/PTY 재시작 후 새 도구를 받는다.

## 권한과 저장

- 서버가 생성한 임의 Bearer 토큰을 MCP 프로세스에 전달한다. 요청 본문으로 직원·작업 ID나 검토자 권한을 지정할 수 없다. 브라우저용 Wiki 승인·반영 API의 권한 검사는 유지한다.
- 기존 readPaths와 readSensitivePaths로 프로젝트·정본 파일·코퍼스 근거 파일을 검사한다. 민감 파일 때문에 일부 필수 조건이 숨겨질 수 있으면 검색은 권한 오류로 중단한다. 권한은 자동 확대하지 않는다.
- 위임에는 DelegateTask 권한이 필요하다. 한 인계·결과물 기록은 하나의 기업·프로젝트로 제한한다. 수신자 권한이 없으면 전달하지 않는다.
- 원본이 변경되거나 비활성화되면 인계·사용 기록을 거절한다. 단순 조회의 변경 경고와 실제 적용을 구분한다.
- 사용 기록은 `history/wiki/usage/<해시>.json`에 보존한다. 동일한 파일·참조·작업의 재시도는 같은 기록을 반환한다. 조회 때 지식 판과 파일 해시를 다시 검사한다.
- `POST /api/wiki-worker/{search,read,handoff,usage}`는 작업 토큰 전용이다. `GET /api/wiki/knowledge/:id/usage?orgId=...&projectId=...`는 기존 소유자 인증을 따른다.

## 검증과 한계

`npm run test:wiki-collaboration`은 임시 원본에서 정본을 만든 뒤 MCP 실제 메시지 전송과 호스트 라우트 연결, 검색 밖 필수 조건, 권한 거절, 인계 중복 억제, 인용 위치·해시 재조회, 판·원본 변경을 검사한다. 위임 생성은 테스트 콜백을 사용하며 실제 직원을 실행하지 않는다.

이번 추가 기능의 실제 다중 모델 협업과 Windows PTY 실행은 미검증이다. 이전 실제 Claude 분석 호출 검증과 구분한다. Ask의 기존 검색 API, 관계 추론, 벡터 리랭킹, 의미상 사용 판정, 자동 수정·알림은 이번 변경에 포함하지 않는다.

## Windows 검증 범위 (2026-09-14)

[Windows 실행 보고서](../verification/windows-20260914/report.md)에 네이티브 설치·빌드, TCP/stdio MCP, 권한 거절, 판·원본·결과물 변경 감지 증거를 기록했습니다. `scripts/wiki-windows-surface-test.ts`는 실제 MCP 프로세스 재기동까지 검사하지만 모델과 실제 위임 작업은 실행하지 않습니다. Windows Claude OAuth 만료로 실제 다중 모델 협업과 직원 PTY의 작업 완료는 미완료입니다. stdio MCP 재기동과 ConPTY 실행 파일 기동을 직원 PTY의 도구 호출 성공으로 해석하지 마세요.

### 실제 작업 ID와 인증 재시도

일반 작업·계획·세션 재시도 경로는 큐에서 발급한 실제 job UUID를 adapter에 전달합니다. Wiki 사용 기록의 jobId를 `/api/jobs/:id`와 대조해야 하며, 직원별 고정 문자열을 작업 완료의 증거로 사용하지 않습니다. `node --import tsx scripts/wiki-job-identity-test.ts`는 실제 큐에서 adapter 경계까지 이 연결을 검사하는 합성 회귀 검사입니다.

[Windows 인증 복구 후 재시도 보고서](../verification/windows-live-retry/report.md)는 실제 Claude 응답을 확보했으나 후보 스키마·출력 문제로 정본 반영까지 완료하지 못한 결과를 기록합니다. 앞선 OAuth 실패는 과거 실행 결과이며, 현재 장애와 구분합니다. 실제 직원 인계 및 다중 모델 완료는 여전히 검증되지 않았습니다.

[Windows Sonnet 실제 연속 협업 보고서](../verification/windows-schema-live/report.md)는 후속 수정으로 기존 `WikiResponseSchema`를 Claude CLI structured output에 강제하고, Sonnet IngesTiger → Opus 전문 직원 → Sonnet Corpus Keeper의 실제 연속 협업을 완료한 기록입니다. CLI 2.1.263 호환을 위해 JSON Schema는 draft-07로 직렬화하지만 호스트 Zod/Python 검사는 그대로 유지합니다. 구조화 출력은 형식만 보장하므로 테스트 검토자의 의미 대조와 정본 반영 단계는 생략하지 않습니다.

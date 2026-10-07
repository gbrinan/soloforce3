# Meeting Memory

Soloforce2와 함께 쓰거나 독립적으로 실행하는 회의록 API 서비스. 사용자: 회의를 녹음하고 Drive에 올리는 개인 운영자와 Markdown을 읽는 에이전트. 구조: **Groq/Gemini 전사 → Gemini 요약 → Markdown·온톨로지 저장**.

## 결과물
1. 요약: 배경·결정사항·주요내용·쟁점·컨텍스트 및 회고
2. 각 대상자가 해야 할 일: 담당·할 일·기한·원문 근거
3. 과거 데이터 참조: 실제 자료 ID·링크·인용·연결 이유
4. 전문: 타임스탬프·화자, details로 접기

[회의록 예제](examples/meeting.md) · [온톨로지 예제](examples/ontology.json) · [반영된 작성 스타일](examples/style.md)

사용자가 제공한 샘플의 구성과 회고 문체를 반영했다. 실제 인명·기관·보수 내역은 코드나 테스트 fixture로 복사하지 않았다. 회고는 해석·검토 필요로 표시하고 이름 불일치는 자동으로 통합하지 않는다.

## 실행

```sh
# FFmpeg를 PATH에 설치하거나 FFMPEG_PATH 지정
bun install --frozen-lockfile
# .env.example → .env; SERVICE_TOKEN, GROQ_API_KEY, GEMINI_API_KEY 및 필요한 연동 값 입력
bun start
```

기본 주소 `http://127.0.0.1:8787`. `/docs`, `/swagger`에서 API 확인. 설정은 [인프라 설치 절차](docs/setup.md), 업무 분담은 [워크플로](docs/workflow.md), 통합은 [Soloforce2 연결](docs/soloforce2.md)을 따른다.

## 제공 기능
- GAS 5분 감지·페이지 cursor·잠금, Drive 파일 ID로 작업 등록
- 프로젝트+원본+revision 중복 제거, SQLite 큐와 전사 checkpoint, 최대 3회 재시도
- OAuth refresh와 지정 폴더 검사, 다운로드 전후 버전 검사
- 기본 Groq / 선택 Gemini Developer 전사, Gemini 구조화 요약
- 실제 원문 인용 검증과 프로젝트·날짜 범위의 과거 자료 검색
- 초안 자동 저장, 검수한 회의록만 후속 검색 근거로 승격
- 직접 multipart 녹음 업로드, 작업별 전사 공급자 선택
- 사람·회의·할 일·자료·프로젝트 엔티티와 관계 JSON
- 검수 후 Soloforce2 corpus로 가져오는 CLI

## API 빠른 사용
모든 `/v1` 요청에 `Authorization: Bearer <SERVICE_TOKEN>`을 붙인다.

| 요청 | 동작 |
|---|---|
| POST /v1/uploads | multipart file + metadata로 직접 녹음 등록 |
| POST /v1/meetings | transcript 또는 driveFileId 중 하나로 등록 |
| GET /v1/meetings | 최근 100개 처리·알림 상태 |
| GET /v1/meetings/{id}/markdown | 전체 회의록 |
| GET /v1/meetings/{id}/ontology | 엔티티·관계·검수 상태 |
| POST /v1/sources | 과거 근거 자료 등록 |
| POST /v1/meetings/{id}/review | 사람 검수 완료·검색 색인 |
| POST /v1/meetings/{id}/retry | 원인 해결 후 실패 건 재처리 |

전사문 직접 등록 예제:

```json
{"project":"demo","title":"출시 준비","date":"2026-09-08","sourceId":"recording-01","revision":"1","transcript":[{"start":0,"end":8,"speaker":"담당자A","text":"검토 문서는 제가 작성하겠습니다."}]}
```

Drive 등록은 transcript 대신 `"driveFileId":"실제파일ID"`를 넣는다. revision은 Drive version 값이다. 동일 revision으로 내용이 달라지면 409를 반환한다.

## 인수 조건과 검증
- [x] 독립 실행 가능한 API와 Soloforce2 입력 계약 대응
- [x] 지정된 4섹션 Markdown과 접힌 전문
- [x] 샘플 기반 문체·해석 구분
- [x] 담당자 근거·과거 참조 인용 검증
- [x] 실제 로컬 HTTP 요청 및 SQLite 재개 검증
- [x] 타입 검사·31개 테스트·빌드 통과
- [ ] 실제 Google Drive/GAS 설치와 녹음 감지
- [x] 실제 Groq 전사·Gemini 요약·Markdown/온톨로지 저장 종단 검증
- [x] 운영 서버 배포 및 Soloforce2 실제 인스턴스 가져오기

Drive/GAS 설치와 자동 녹음 감지는 아직 별도 설정과 검증이 필요하다. 운영 서버에서는 실제 녹음의 271개 전사 구간을 사용해 요약과 저장을 검증했다. 근거 불일치 제안은 확인 필요 항목에 보존하고, 근거가 확인된 할 일만 온톨로지에 반영한다. 예제 생성에서만 명시적으로 가상 응답을 사용한다.

검증 명령: `bun run check`, `bun test`, `bun run build`, `bun src/manual-qa.ts`. 마지막 명령은 가상 응답으로 실제 로컬 HTTP 경로를 실행하고 예제 파일을 갱신한다.

## 제한과 다음 담당자의 작업
단일 소유자·단일 서버 프로세스용 SQLite 서비스다. 별도 조직별 ACL, 의미 기반 검색 평가, 동명이인 해소, 그래프 DB 직접 동기화는 포함하지 않는다. 업로드는200MiB·4시간 이하이며 FFmpeg로 16kHz 모노 음성을 준비한다. 3초 이상 이어지는 낮은 음량 구간(-50dB 기준)을 제외하고 최대 3분 구간으로 나눈다. 경계에 0.5초 문맥을 추가하며 원본 타임스탬프로 복원한다. 공급자에 보내는 WAV 구간은 약 5.8MB 이하이다. 작은 목소리나 짧은 발화가 누락될 수 있어 검수는 필요하다. Gemini 화자 표시는 구간별로 구분하며 서로 같은 사람이라고 자동 통합하지 않는다. 완료한 구간 전사는 DATA_DIR/chunks에 보존해 재시도 때 재사용한다. 전체 전문은 SQLite와 Markdown API에 보존한다. 검색은 최대 8개 관련 자료의 키워드 일치 기반으로 시작하며 한국어 품질은 업무 데이터로 평가해야 한다.

직접 업로드 운영 검증은 완료했다. 다음 인프라 작업은 [설치 절차](docs/setup.md)의 Google Drive/GAS 설정과 자동 감지 검증이다. Soloforce2 연결은 [저장소 설치 안내](../../docs/meeting-memory.md)를 따른다.

[에이전트 지침](docs/agent-instructions.md)

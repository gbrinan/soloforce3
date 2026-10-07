# 회의록 서비스 연결

기존 회의 업로드·조회 화면에 독립 서비스인 [Meeting Memory](../services/meeting-memory/README.md)를 연결한다. `MEETING_MEMORY_URL`을 설정하면 새 회의는 **Groq 또는 Gemini 전사 → Gemini 요약 → Markdown·온톨로지 JSON 저장**으로 처리한다. 기존 회의 파일은 이관하거나 덮어쓰지 않는다.

## 실행

1. FFmpeg를 설치한다(예: Ubuntu `sudo apt-get install ffmpeg`). `services/meeting-memory`에서 `bun install --frozen-lockfile`을 실행한다.
2. 해당 폴더의 `.env.example`을 `.env`로 복사하고 `SERVICE_TOKEN`, `GROQ_API_KEY`, `GEMINI_API_KEY`를 설정한다. 토큰은 충분히 긴 무작위 값으로 정한다.
3. 같은 폴더에서 `bun start`로 서비스를 실행한다. 기본 주소는 `http://127.0.0.1:8787`이다.
4. Soloforce2 루트 `.env`에 아래 설정을 추가하고 Soloforce2를 재시작한다.

```dotenv
MEETING_MEMORY_URL=http://127.0.0.1:8787
MEETING_MEMORY_TOKEN=서비스의_SERVICE_TOKEN과_같은_값
MEETING_MEMORY_TRANSCRIBER=groq
```

서비스를 별도 서버에서 실행할 때는 HTTPS 주소를 사용한다. 이 저장소에는 API 키, 실제 녹음, SQLite DB를 포함하지 않는다. 기존 서비스의 개인 `.env`와 `data`는 운영자가 따로 관리한다.

## 사용과 결과 조회

기존 화면에서 녹음을 업로드한 뒤 `Groq 전사·요약`을 실행한다. 정밀 전사가 필요할 때만 `Gemini 전사·요약` 버튼을 선택한다. 제목 입력창에서 공급자와 할당량 사용 안내를 확인한 뒤 실행하며, 취소하면 요청하지 않는다. 두 방식 모두 요약은 Gemini를 사용하므로 Google 할당량을 소비한다. API에서 공급자를 생략하면 항상 Groq를 사용한다. Gemini 전사는 `POST /api/meetings/summarize`에 `"transcriptionProvider":"gemini"`를 명시해야 하며, 환경변수로 암묵적으로 선택하지 않는다.

```json
{"recordingId":"업로드로_받은_ID","title":"회의 제목","language":"ko","transcriptionProvider":"gemini"}
```

새 서비스 연결은 한국어 회의용이다. 다른 언어는 오류로 표시하며 자동으로 기존 파이프라인에 넘기지 않는다. Gemini 모델은 서비스의 환경변수로 지정하며 모델별 품질은 실제 녹음으로 비교해야 한다.

완료 후 기존 HTML 회의록 외에 `HISTORY_DIR/outputs/meetings/<token>.md`와 `<token>.ontology.json`이 저장된다. 에이전트는 다음 소유자 인증 경로를 이용할 수 있다.

- `GET /api/meeting-memory/<token>/markdown`
- `GET /api/meeting-memory/<token>/ontology`

기존 공유 HTML 주소와 달리 두 경로는 Soloforce2의 corpus와 같은 소유자 인증 정책을 적용한다. SSO 사용 시 소유자 세션이 필요하고, SSO 미사용 시 로컬 소켓 요청만 허용한다.

Markdown에는 요약, 담당자별 할 일과 근거, 과거 자료 참조, 접힌 전문이 포함된다. 온톨로지는 인물·프로젝트·회의·할 일·자료의 관계와 근거를 담는다. 결과는 **검수 전 초안**이다. 과거 자료가 없으면 참조를 지어내지 않는다. 회의 날짜는 생성 요청 날짜를 사용하므로 실제 녹음 날짜와 다르면 검수해야 한다.

## Drive와 검수

Drive 감지는 서비스의 [GAS 및 설치 안내](../services/meeting-memory/docs/setup.md)를 따른다. Drive로 직접 등록된 결과는 독립 서비스 API에 저장되며 Soloforce2 목록으로 자동 복제되지는 않는다. 검수 후 corpus 가져오기는 [연동 CLI 안내](../services/meeting-memory/docs/soloforce2.md)를 따른다.

서비스의 `/v1/sources`에 과거 자료를 등록하거나 `/v1/meetings/<id>/review`로 사람 검수를 완료한 회의만 후속 검색 근거로 사용한다. 검수 후 소스 서비스의 Markdown이 정본이며 Soloforce2에 저장한 파일은 생성 시점 스냅샷이다.

## 실패와 운영

인증 오류·할당량 초과는 오류로 표시한다. 다른 공급자나 유료 모델로 자동 전환하지 않는다. `memoryJobId`는 회의 메타데이터에 남으므로 서비스의 상태 API에서 원인을 확인하고 설정 수정 후 `/v1/meetings/<id>/retry`를 호출할 수 있다. 90분 폴링 제한 이후에도 서비스 작업은 보존된다. 재처리 결과를 Soloforce2로 자동 재동기화하는 기능은 아직 없다.

Soloforce2에서 삭제하면 해당 HTML·메타·Markdown·온톨로지 스냅샷을 삭제한다. 독립 서비스의 SQLite 원본과 녹음은 별도 보존되므로 운영자가 보관 정책을 관리한다. `MEETING_MEMORY_URL`을 비우면 기존 회의 처리 방식이 적용된다.

## 검증

`npm run test:meeting-memory`는 로컬 HTTP 서비스로 업로드·공급자 전달·인증·파일 저장·조회·할당량 오류를 검증한다. 외부 모델 품질 검증을 대체하지 않는다. 서비스 자체 검증은 해당 폴더에서 `bun run check`, `bun test`, `bun run build`로 실행한다.

## 요약 검증과 확인 필요 항목

원문과 담당자가 일치하지 않는 항목 하나 때문에 회의록 전체를 다시 생성하지 않는다. 확인되지 않은 담당자는 미정으로 남긴다. 인용문은 원문 그대로 일치해야 하며, 구간 번호만 틀렸고 정확히 일치하는 구간이 하나일 때만 보정한다. 인용이 없거나 여러 구간에 걸쳐 모호하면 해당 제안은 `reviewIssues`와 Markdown의 확인 필요한 항목에 보존하고 검증된 할 일·참조 관계에서 제외한다. 온톨로지에도 같은 검토 항목이 제공된다. 검증된 인용을 바꾸거나 근거 없는 관계를 생성하지 않는다.

`reviewIssues[].candidateIndex`는 모델의 원래 후보 목록 위치이다. 확인이 필요한 초안도 출력이 준비되면 ready지만, 사람 검수 전 reviewed는 false다. 네트워크·인증·할당량·잘못된 JSON 등 실제 처리 오류는 여전히 실패 또는 대기 상태로 구분한다.

기존 `memoryJobId`가 있는 회의는 서버 처리 함수를 재개할 때 해당 결과를 조회하므로 녹음 파일 재업로드를 하지 않는다. 서비스 재처리는 저장된 전사 체크포인트를 재사용한다.

## 긴 녹음과 연결 복구

전사 전에 FFmpeg로 음성을 해독하고 낮은 음량 구간을 제외한 최대 3분 구간을 처리한다. 원본 오디오는 보존하며 타임스탬프를 원본 기준으로 복원한다. 구간별 캐시는 DATA_DIR/chunks에 저장되고 실패 후 재개할 때 이미 완료한 공급자 호출을 반복하지 않는다. 캐시도 개인정보이므로 운영 데이터와 같은 접근·삭제 정책을 적용한다.

상태·결과 GET은 네트워크 오류, 타임아웃 및 일시적 HTTP 오류에 최대 5회 재연결한다. 업로드 POST는 자동 재전송하지 않는다. 영구 인증 오류와 할당량 대기는 정상 결과로 위장하지 않는다. 서비스 설치 절차와 음량 검수 한계는 [서비스 README](../services/meeting-memory/README.md)를 따른다.

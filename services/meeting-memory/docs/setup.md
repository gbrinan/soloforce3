# 설치와 실서비스 연결

## 로컬 서비스
Bun 1.3.3 이상과 FFmpeg를 설치한 뒤 프로젝트 폴더에서:

```sh
bun install --frozen-lockfile
# .env.example을 .env로 복사하고 SERVICE_TOKEN과 ANTHROPIC_API_KEY 입력
bun start
```

SERVICE_TOKEN은 24자 이상의 무작위 값이다. `/health`를 제외한 데이터 API는 Bearer 토큰을 요구한다. API 명세는 `/openapi.json`, 실행 가능한 문서는 `/docs`, `/swagger`다. 단일 소유자·단일 서버 프로세스용이다. 여러 회사가 공유하는 SaaS 인증/ACL은 포함하지 않는다.

## Google Drive / GAS
1. 녹음 전용 Drive 폴더를 만든다. 폴더 ID를 서버 `.env`와 GAS Script Properties의 `DRIVE_FOLDER_ID`에 동일하게 지정한다.
2. Google Cloud 프로젝트에서 Drive API와 OAuth 동의 화면을 설정한다. 서버용 OAuth 클라이언트를 만들고 `drive.readonly` 범위, offline access로 본인 계정의 refresh token을 발급한다. ID·secret·refresh token을 서버 환경변수에만 넣는다. Codex Drive 커넥터 로그인만으로 서버 자격증명이 생기지는 않는다.
3. Apps Script 프로젝트에 `gas/Code.gs`, `gas/appsscript.json`을 복사한다. Advanced Drive v3 서비스를 활성화한다.
4. Script Properties: `SERVICE_URL`(서버의 HTTPS 주소), `SERVICE_TOKEN`, `DRIVE_FOLDER_ID`, `PROJECT_ID`를 넣는다.
5. `scanRecordings`를 한 번 실행해 권한 동의와 등록을 확인하고 `installTrigger`를 실행한다. 5분마다 업로드/수정된 파일을 조회한다. 최초 실행은 지정 폴더의 기존 파일도 가져온다.
6. 실패는 Apps Script 실행 기록과 `/v1/meetings`에서 확인한다. 실패한 페이지는 다시 읽고 서버가 중복을 제거한다. 계정의 트리거·호출 할당량 내에서 운영한다.

GAS는 음성을 내려받지 않는다. 파일 ID만 넘기고 서버가 지정 폴더의 파일을 내려받는다. 폴더 접근 권한을 가진 OAuth 계정을 사용한다.

## Whisper / Gemini
Whisper 기본은 Speaches의 OpenAI 호환 전사 API다. `WHISPER_MODEL=Systran/faster-whisper-small`은 한국어를 포함한 다국어 모델이다. 화자 실명 분리는 하지 않으며 “화자 미상”을 사용한다. 실제 품질 확인 후 모델을 선택한다.

```sh
docker compose up -d --build
```

모델 설치는 [Speaches 공식 절차](https://speaches.ai/usage/speech-to-text/)를 따른다. 컨테이너 내부 8000번 전사 서버는 외부에 공개하지 않는다. 제공한 Compose는 CPU 예제이며 실제 이미지 실행·모델 다운로드는 아직 검증하지 않았다. 운영 시 검증한 이미지 digest로 고정한다.

Gemini를 쓰려면 `TRANSCRIBER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`을 지정한다. 서버 공통 입력은200MiB·4시간 이하이다. FFmpeg로 해독한 음성을 최대 3분 구간으로 나눠 Gemini Files API로 처리하며 타임스탬프를 원본 기준으로 복원한다.

## Claude / 스타일
`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`을 지정한다. 기본 모델 ID의 계정별 사용 가능 여부는 실호출로 확인해야 한다. `STYLE_PATH`가 가리키는 파일을 본인 회의록 샘플로 교체하면 문체만 참고한다. JSON 형식은 코드가 강제하고 인용은 실제 전사·검색 자료와 대조한다. 스키마 준수가 요약 사실성을 보증하지 않으므로 검수가 필요하다.

## Telegram
BotFather에서 봇을 만들고 본인 채팅에 `/start`를 보낸다. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 서버에 지정한다. 실행 중인 다른 봇의 polling/webhook 설정은 바꿀 필요가 없다. 문서 전송만 사용한다.

요약·할 일·참조를 txt 첨부로 전송하며 전문은 제외한다. `uncertain`은 Telegram이 수신했지만 응답이 유실됐을 수도 있다는 뜻이다. 채팅 수신 여부를 직접 확인한다. `disabled`는 토큰/수신자 미설정 상태다. 기존 disabled/uncertain 건의 재전송은 자동 실행하지 않는다.

## 서버 운영
지정한 Linux 서버에서 Compose를 실행하고 HTTPS reverse proxy를 8787번으로 연결한다. `.env`는 배포 서버에서 관리하며 Git에 넣지 않는다. SQLite 데이터 볼륨과 스타일 파일을 백업한다. 백업은 서버 중지 후 볼륨 전체를 복사하거나 SQLite backup API를 사용한다. DB 파일만 실행 중 복사하면 WAL 변경분이 빠질 수 있다.

현재 실배포에 필요한 미제공 항목: 서버 주소/접근 수단·HTTPS 도메인, Google OAuth 설정, Claude API 키, Telegram 봇·수신자, 실제 녹음 샘플. 이 항목 없이 외부 연동이 완료됐다고 표시하지 않는다.

## Google AI 구독 CLI: Gemini 경로 지원 종료

**2026-09-09 정정:** 아래 Gemini CLI 설정은 개인 구독에서 더 이상 동작하지 않는다. Google이 2026-06-18 개인 계정 지원을 종료했다. cli_migration_required 상태는 재로그인으로 해결되지 않는다. Antigravity CLI 이관과 실제 음성 검증이 필요하다. [공식 공지](https://github.com/google-gemini/gemini-cli/discussions/28017)

### 기존 구현 기록

로컬 설정은 TRANSCRIBER=gemini-cli로 전환했다. Node.js와 Gemini CLI가 필요하며 GEMINI_CLI_ENTRY에 설치된 @google/gemini-cli/bundle/gemini.js의 절대 경로를 지정한다. 설치 버전은 0.50.0이다.

1. 프로젝트에서 bun src/login-gemini.ts 실행 후 구독 중인 Google 계정으로 로그인하고 CLI를 종료한다.
2. bun src/check-gemini-cli.ts로 인증을 확인한다.
3. bun start로 서비스를 실행한다.

최초 로그인은 대화형 터미널을 사용하고 자동 전사는 --prompt --output-format json으로 실행한다. 인증은 DATA_DIR/gemini-cli/home에 격리한다. 서버 API 키를 CLI 환경으로 전달하지 않고 별도 .env 탐색 경계를 둔다. 인증 파일과 작업별 음성 사본은 data 아래에 남으므로 비공개로 보관하고 보존 정책에 맞춰 삭제한다.

cli_auth_required 또는 cli_quota_wait 발생 시 작업은 waiting 상태가 된다. 문제 해결 후 POST /v1/meetings/{id}/retry로 명시적으로 재개한다. 유료 API로 자동 전환하지 않는다. 요약은 기존 Claude Sonnet 경로이므로 Anthropic 인증이 별도로 필요하다.

장점은 개인 구독의 CLI 사용량을 활용한다는 점이다. 반대 관점에서는 계정 로그인·CLI 버전·구독 한도에 의존하므로 무인 서버에는 API 방식이 더 관리하기 쉽다. 현재 구독 로그인 및 실제 음성 입력 검증이 남아 있다. Docker 예제에는 Gemini CLI가 포함되지 않는다.

## 현재 운영 경로 (2026-09-09, 이전 Claude/CLI 안내보다 우선)

환경변수:
```
TRANSCRIBER=groq
GROQ_API_KEY=<Groq 콘솔 키>
GROQ_MODEL=whisper-large-v3
GEMINI_API_KEY=<Google AI Studio 키>
GEMINI_MODEL=gemini-2.5-flash
GEMINI_SUMMARY_MODEL=gemini-2.5-flash
```
Claude 키나 구독 CLI 로그인은 현재 흐름에서 사용하지 않는다. API 무료 여부와 실제 한도는 각각의 계정 콘솔에서 확인한다. 결제 계정을 자동으로 켜거나 다른 공급자로 자동 전환하지 않는다. Gemini 무료 데이터 사용 정책을 확인하고 고객 원문 보관 범위를 결정한다.

Drive 등록 JSON에 `transcriptionProvider: "groq"` 또는 `"gemini"`를 지정한다. GAS Script Property `TRANSCRIPTION_PROVIDER`는 생략하면 groq다. 이미 등록된 동일 source/revision을 다른 설정으로 바꾸면409; 재전사는 새 revision으로 등록한다(Drive 다운로드는 실제 Drive version과 일치해야 하므로 다른 공급자로 재실험할 때 직접 업로드를 사용).

직접 업로드: `POST /v1/uploads`, Bearer 인증, multipart 필드 `file`과 `metadata`(JSON 문자열):
```
{"project":"demo","title":"운영 회의","date":"2026-09-09","sourceId":"recording-01","revision":"1","transcriptionProvider":"gemini"}
```
파일명 확장자로 형식을 확인한다. 녹음은200MiB·4시간까지 허용한다. Groq에도 자동 분할된 WAV 구간을 전송하므로 원본 파일을 직접 25MB 미만으로 나눌 필요는 없다. 서버 업로드는 SQLite BLOB에 저장하며 보존 정책은 운영자가 관리한다. Gemini Files API 업로드는 전사 후 삭제를 시도하고 실패하면 경고를 남긴다(공급자 자동 만료48시간).

결과는 `GET /v1/meetings/{id}/markdown`, `/ontology`로 조회한다. 온톨로지는 영속 저장된 회의·요약·참조에서 생성되며 별도 그래프 DB는 아니다. 4개 Markdown 섹션과 접힌 전문은 유지한다.

검증: `bun run check`, `bun test`, `bun run build`. 실제 Gemini 출력은 Git 제외 data/audio-test/gemini-developer 아래에 저장했다. 해당 출력의 날짜는 원본 파일 메타데이터에서 추정한 값이며 확정 회의일이 아니다.

Groq 인증 확인: `bun src/check-groq.ts`. 401이면 키를 재발급/교체한 뒤 waiting 작업에 retry를 호출한다. 키를 로그나 채팅에 출력하지 않는다.

# MyCrew Agent Team

[IngesTiger 역할 반영 확인](docs/ingestiger-role-verification.md): 새 직원 등록, 역할·스킬 연결, Windows Markdown 검사 절차.

> **문서 역할**: 프로젝트 개요·개발자용 안내 (정본 허브). 최종 사용자는 [README-USER.md](README-USER.md), Windows 설치는 [README-WINDOWS.md](README-WINDOWS.md), 소스 zip 배포 설치는 [README-DISTRIBUTION.md](README-DISTRIBUTION.md).

AI 에이전트 팀을 운영하는 개인 비서 시스템입니다.

**마이크루(MyCrew)**가 당신의 전담 AI 비서로서 대화하고, 복잡한 작업은 전문 에이전트 팀에 자동으로 위임합니다.

## 주요 기능

- **마이크루와 대화**: 웹 대시보드에서 자연어로 대화. 마이크루가 맥락을 기억하고 이어갑니다.
- **에이전트 팀 위임**: 코드 작업, 리서치 등을 전문 에이전트에 자동 위임하고 결과를 보고받습니다.
- **영구 기억(위키)**: 중요한 정보를 위키에 자동 저장. 세션이 만료되어도 기억이 유지됩니다.
- **스케줄러**: 반복 알림, 리마인더를 자연어로 등록. 마이크루가 시간에 맞춰 알려줍니다.
- **일일 요약**: 하루 대화를 자동 요약하여 다음 날 빠르게 맥락을 복원합니다.
- **동료 메시지 (B2B 비서 통신)**: 다른 인스턴스와 P2P 파일 첨부를 포함한 메시지 송수신을 지원합니다.
- **cron 스케줄**: cron 표현식으로 반복 스케줄을 관리합니다 (시간 트리거 실행은 외부 LaunchAgent — 아래 운영 정책 참조. 앱 내부 cron 데몬은 없음).
- **승인 시스템**: 민감 작업에 대해 사장님 승인을 요청하며, 부재중 모드를 지원합니다.
- **세션 리셋 시 대화 요약 주입**: 세션이 리셋될 때 오늘 대화 요약을 자동으로 프롬프트에 주입하여 맥락을 유지합니다.
- **자료 수집·분류·검색**: Drive·Notion·로컬 자료의 형식을 먼저 확인하고 본문·표·OCR·전사 경로로 분기합니다. 최대 512 MiB 원본의 분할 접수·분석 재개, 원본·버전 백업, 키워드·업무 분류 연결 검색, 선택적 로컬 벡터 검색을 지원합니다. 분석 한도는 형식별로 다르며 [구조 문맥과 재개 절차](docs/corpus-source-reader.md)를 확인하세요. [설정과 처리 범위](config/corpus/README.md)
- **IngesTiger Wiki**: 선택한 절·표 행의 분석을 실행하고, 후보를 검토해 안정 ID·판·근거를 가진 정본에 반영한 뒤 같은 ID로 재조회합니다. 신규 ingest-crab 요청은 ingestiger로 연결하며, 코퍼스키퍼는 조인·집계 요청에만 사용합니다. [사용법과 현재 범위](config/wiki/README.md)
- **IngesTiger 후속 설계**: 두 공유 세션을 반영해 작업 근거·변경 영향과 Wiki 적재 후 관계 검토·목적별 가치 판별을 설계했습니다. 아직 구현되지 않은 기능과 단계별 검증 기준은 [업무 지식 연결 설계](docs/ingestiger-workflow-design.md)를 확인하세요.

## 사전 요구사항

- **지원 플랫폼**: macOS/Linux 우선 (시간 트리거는 macOS LaunchAgent 기준). Windows는 WSL2로 [README-WINDOWS.md](README-WINDOWS.md) 참조
- **Claude 계정**: Claude Code CLI 로그인 필요 (구독/사용량 과금은 본인 계정 기준)

- **Node.js 24 사용 권장**: 자료 수집 기능은 24.14.0에서 검증했습니다. `package.json`의 기존 `engines.node`는 `>=20`이지만, PDF 추출 의존성의 요구 버전은 Node 22.13 이상 또는 24 이상이므로 Node 20으로 이 기능을 실행하지 마세요.
- **Claude Code CLI** (`claude` 명령어가 PATH에 있어야 합니다)
  - 설치: https://docs.anthropic.com/en/docs/claude-code
  - 설치 후 `claude --version`으로 확인
- **Python 3**: IngesTiger Wiki 후보 기능 사용 시 필요합니다. 표준 라이브러리만 사용하며 [실행 경로 설정](config/wiki/README.md)을 확인하세요.

## 설치

```bash
git clone https://github.com/gbrinan/soloforce2
cd soloforce2
npm ci
npm run build
```

서버는 `tsx`로 소스를 실행하지만, 웹 화면은 빌드 결과를 사용하므로 설치·업데이트 후 `npm run build`를 실행합니다. 기존 Windows 설치의 Git 업데이트와 Mac에서 작성한 `.env` 이전은 [Windows 업데이트 절차](README-WINDOWS.md#update-existing)를 따르세요. 실제 설치 폴더에서 작업하며, `.env`와 개인 데이터는 Git으로 옮기지 않습니다.

## 설정

프로젝트 루트에 `.env` 파일을 생성합니다. `.env.example`을 참고하세요.

```bash
cp .env.example .env
```

필요에 따라 값을 수정합니다. 기본값이 있으므로 대부분의 경우 `.env` 없이도 동작합니다.

이미 `.env`가 있으면 위 복사 명령으로 덮어쓰지 말고 필요한 항목만 병합합니다. `.env`는 실행 소스 루트의 `package.json` 옆에 둡니다. Drive·Notion 계정 연결과 선택적 임베딩 설정은 [자료 수집 안내](config/corpus/README.md)를 참고하세요. 로컬 파일 등록은 클라우드 계정 없이 사용할 수 있습니다.

## 환경변수

환경변수의 정본은 `.env.example`입니다. 아래 표는 주요 키 발췌이며, 전체 목록과 최신 기본값은 `.env.example`을 참조하세요.

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `CLAUDE_PATH` | Claude Code CLI 경로 | `claude` |
| `WORKSPACE_ROOT` | 에이전트 프로젝트 저장 상위 디렉토리 | 자동 감지 |
| `PROJECTS_FOLDER` | WORKSPACE_ROOT 아래 프로젝트 폴더명 | `mycrew-works` |
| `NGROK_URL` | ngrok 외부 접속 도메인 | — |
| `TUNNEL_HOST` | SSH 터널 EC2 IP | — |
| `TUNNEL_KEY` | SSH 키 경로 | — |
| `TUNNEL_REMOTE_PORT` | SSH 터널 리모트 포트 | — |
| `TUNNEL_URL` | SSH 터널 외부 URL | — |
| `APPROVAL_RESOLVE_TOKEN` | 승인 API 보안 토큰 (외부 접속 시 필수) | — |
| `PORT` | 서버 포트 | `3456` |

## 실행

```bash
npm run start
```

브라우저에서 `http://localhost:3456` 을 열면 대시보드가 나타납니다.

처음 실행하면 온보딩 화면이 나타납니다. 사용자 이름, 비서 이름, CTO/CSO/CQO 이름을 입력하면 자동으로 에이전트 팀이 구성되고 프로필이 저장됩니다.

### 옵션

```bash
# 포트 변경
npm run start -- --port 8080
```

### 멀티 인스턴스 테스트

```bash
# 두 번째 인스턴스 (동료 테스트용)
npm run start:b    # PORT=3459, MYCREW_HOME=.mycrew-B
```

## npm scripts

| 스크립트 | 설명 |
|----------|------|
| `npm run start` | 메인 서버 실행 |
| `npm run build` | TypeScript 컴파일 + Vite 클라이언트 빌드 |
| `npm run test:corpus` | 자료 파서·버전 보존·검색·접근 제어 및 Drive/Notion 모의 API 검증 |
| `npm run test:corpus-reader` | 큰 원본·구조 단위·재개·변조·벡터 배치 검증 (`test:corpus`에 포함) |
| `npm run test:wiki-product` | 분석·인간 검토·정본 갱신·ID 조회·저장 실패·권한 회수 검사 |
| `npm run test:wiki` | IngesTiger 실제 코어·후보 인용·범위·원본 변경·접근 제어·저장 검증 |
| `npm run test:google-readonly-connection` | 기존 Drive 읽기 전용 연결 회귀 검증 |
| `npm test` | 전체 테스트 실행 |
| `npm run verify` | 검증 스크립트 실행 |
| `npm run start:b` | 멀티 인스턴스 테스트 (PORT=3459, MYCREW_HOME=.mycrew-B) |
| `npm run mock:external` | 동료 목 서버 실행 |
| `npm run test:two-instance` | 2인스턴스 통합 테스트 |
| `npm run test:partner-request` | 동료 요청 테스트 |
| `npm run health:processes` | LaunchAgent 실가동 점검 (`launchctl list` 대조) |

## 포트 할당

| 포트 | 용도 |
|------|------|
| 3456 | 메인 서버 |
| 3457 | 셀프리스타트 검증 (DRY_RUN) |
| 3458 | npm run verify 검증 서버 |
| 3459 | start:b 멀티 인스턴스 테스트 |
| 4458/4459 | 2인스턴스 통합 테스트 자동화 |

## 사용법

### 마이크루와 대화

대시보드 하단 입력창에 메시지를 입력하면 마이크루가 응답합니다. 이미지 첨부도 가능합니다.

### 작업 위임

마이크루에게 코드 작업을 요청하면 자동으로 에이전트 팀에 위임합니다. 대시보드 우측 상단 "작업" 버튼으로 진행 상황을 확인할 수 있습니다.

### 리마인더 등록

마이크루에게 "내일 오후 2시에 미팅 준비 알려줘" 같이 말하면 스케줄러에 자동 등록됩니다.

## 아키텍처

```
사용자 (웹 대시보드)
    │
    ▼
MyCrew (마이크루) ─── 대화, 기억 관리, 승인 시스템
    │
    ├──▶ Agent Team ─── Developer, Researcher, PM
    │        │
    │        ▼
    │    Claude Code CLI ─── 실제 작업 실행
    │
    ├──▶ Scheduler ─── cron 스케줄, 리마인더
    │
    └──▶ 동료 (B2B) ─── P2P 메시지·파일 송수신
```

- **Orchestrator-Worker 패턴**: 마이크루가 오케스트레이터, 전문 에이전트가 워커
- **Claude Code CLI**: 각 에이전트는 `claude -p` 명령으로 실행되며 세션을 유지합니다
- **위키 시스템**: 마크다운 파일 기반 영구 기억. 100줄 제한으로 자동 정리됩니다
- **Hono 서버**: 경량 웹 프레임워크로 대시보드와 API를 제공합니다
- **승인 시스템**: 민감 작업은 사장님 승인 후 실행. 부재중 모드 지원
- **스케줄러**: cron 표현식 기반 반복 스케줄 + 자연어 리마인더
- **B2B 통신**: 다른 인스턴스와 P2P 파일 첨부 메시지 송수신

## 디렉토리 구조

```
src/
  index.ts          # 엔트리포인트
  agent.ts          # Claude Code CLI 실행기
  config.ts         # 설정
  types.ts          # 타입 정의
  adapters/         # 어댑터 (claude-code)
  agents/           # 에이전트 설정 (마이크루)
  client/           # React 웹 대시보드
  mcp/              # MCP SafeFS 서버 (파일 접근/bash 통제)
  server/           # 웹 서버 (라우트, 대시보드, 채팅, 스케줄러)
config/
  agents-default.json       # 직원 설정 온보딩 템플릿
  genie-config-default.json # 마이크루 설정 온보딩 템플릿
  mcp-base.json             # MCP 기본 설정
  guides/                   # 네트워크 설정 가이드
  role-directives/          # 역할 지시서 온보딩 템플릿
  system-prompt-templates/  # 직원 시스템 프롬프트 직군별 템플릿 (developer/researcher/qa/general)
prompts/            # 마이크루 + 서브에이전트 시스템 프롬프트 (genie.md, sub-agents/)
scripts/            # 검증·테스트 스크립트 (npm test가 호출)
history/            # 런타임 데이터 (대화 기록, 위키, agents.json 등)
```

## 외부 접속

외부에서 대시보드에 접속하려면 `.env.example`을 참고하여 `.env`에 설정합니다. 두 가지 방식을 지원합니다:

- **ngrok**: `NGROK_URL`에 ngrok 무료 도메인을 설정. 간편하지만 무료 플랜은 월간 요청 제한이 있습니다.
- **SSH 터널**: `TUNNEL_HOST`, `TUNNEL_KEY`, `TUNNEL_REMOTE_PORT`, `TUNNEL_URL`을 설정. EC2 + nginx 리버스 프록시 + SSL 구성이 필요하지만 요청 제한이 없습니다.

외부 접속 사용 시 `APPROVAL_RESOLVE_TOKEN`을 반드시 설정하세요.

## 직원 시스템 프롬프트

직원 시스템 프롬프트는 4단 우선순위로 로드됩니다 (높은 우선순위부터):

0. `agents.json`의 인라인 `systemPrompt` 필드 — **디버깅/임시 패치용**. 운영 시는 비워두고 템플릿 시스템을 사용하세요.
1. `history/agents/{id}/system-prompt.md` — 로컬 개인 오버라이드 (git 미추적)
2. `config/system-prompt-templates/{jobType}.md` — 직군 템플릿 (developer/researcher/qa/general)
3. `config/system-prompt-templates/general.md` — 폴백

템플릿에는 다음 플레이스홀더가 자동 치환됩니다: `{{ID}}`, `{{NAME}}`, `{{ROLE}}`, `{{TEAM}}`, `{{MANAGER}}`, `{{COWORKERS}}`, `{{OUTPUT_DIR}}`, `{{WIKI_DIR}}`.

신규 `jobType`이 `config/system-prompt-templates/`에 없으면 `general.md`로 폴백하고, 부팅 시 1회 toast로 사장님에게 *"`{jobType}.md` 신규 템플릿 작성 필요"* 안내가 발송됩니다 (`src/server/index.ts` 부팅 블록 + `consumeUnknownJobTypes()`). 데이브가 새 템플릿을 작성하면 다음 사이클에 자동 적용됩니다.

## 운영 정책

### 스케줄
- **내부 cron 없음** — 본 시스템은 자체 cron/스케줄러를 가동하지 않습니다 (`history/genie/wiki/schedule.md`는 사용자 리마인더 메모용).
- 시간 트리거가 필요한 모든 배치/리포트는 **외부 jarvis LaunchAgent**(`~/Library/LaunchAgents/`)에서 실행됩니다.
- LaunchAgent 가동 상태 점검: `npm run health:processes` (SafeBash에서 `launchctl`이 차단되어 있을 때 사용).

### 감사 로그(`history/audit.jsonl`) retention
- 형식: append-only JSONL. **회전(rotation)·자동 삭제 없음** (의도).
- 회귀 추적 깊이는 파일 수명에 비례합니다. 장기 보관이 필요하면 외부 로그 적재/순환을 별도로 구성하세요.
- 잡 본문/위키 변경/대화는 `history/archive/{jobs,wiki,chat}/<날짜>/` 아래에 별도 보관됩니다 (`src/server/audit.ts` `archiveJob/archiveWikiPage/archiveChatMessage`).

## 라이선스

MIT


## 🧩 플러그인 & 앱

MyCrew는 다양한 플러그인과 앱을 통해 기능을 계속 확장하고 있습니다. 현재 포함된 앱과 연동 기능은 다음과 같으며, **새로운 플러그인·앱이 지속적으로 추가되는 중**입니다.

- **MySign** (`apps/isenssign`) — 전자서명 · 사진/계약 문서 앱 (Next.js)
- **동료(B2B) 통신** — 다른 MyCrew 인스턴스와 P2P 메시지·파일 송수신
- **스케줄러 · 리마인더** — 자연어 기반 반복 작업 등록

> 플러그인/앱 목록은 릴리스마다 갱신됩니다. 최신 추가 항목은 커밋 로그와 릴리스 노트를 참고하세요.

## 독립 회의록 서비스 연결

기본 Groq / 선택 Gemini Developer 전사 → Gemini 요약 → 4섹션 Markdown·온톨로지 저장을 지원합니다. 기존 녹음 업로드·회의록 화면에 연결하며 독립 실행도 가능합니다. [실행 및 연동 안내](docs/meeting-memory.md).

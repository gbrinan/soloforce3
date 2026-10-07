> IngesTiger 포함 소스 배포는 GitHub release의 `soloforce2-ingestiger-source.zip`을 사용합니다. `release:source`는 커밋된 전체 코드에서 만들고 번들·Python bridge·직원·로컬 의존 패키지 포함과 ZIP 해시를 재검증합니다. 기존 `package-dist`의 제한된 목록으로 만든 ZIP과 구분합니다. Windows에서 의존성을 설치하고 빌드하며 `.env`와 history는 포함하지 않습니다.

# mycrew — 소스코드 설치 안내서

> **문서 역할**: 소스코드 zip을 받은 개발자·운영자용 설치 안내. 사용법은 [README-USER.md](README-USER.md), 개발·운영 정보는 [README.md](README.md).

> 대상: 소스코드 zip을 받아 직접 설치·운영하는 개발자/운영자

---

## 최소 요구사항

| 항목 | 버전/조건 |
|------|-----------|
| Node.js | 20 LTS 이상 |
| npm | 10 이상 (Node.js에 포함) |
| Claude Code CLI | 최신 버전 |
| OS | macOS 12+, Ubuntu 20.04+, Windows 11 (WSL2) |

### Claude Code CLI 설치 및 로그인

```bash
npm install -g @anthropic-ai/claude-code
claude   # 브라우저 인증 창 열림
```

---

## 설치 절차

```bash
# 1. 압축 해제
unzip mycrew-system_*.zip && cd mycrew-system

# 2. 환경 변수 설정
cp .env.example .env
# 아래 ENV 키 안내 참고하여 .env 편집

# 3. 패키지 설치
npm install

# 4. 빌드 (선택 — `npm start`는 tsx로 소스를 직접 실행하므로 필수는 아님. 클라이언트 번들 최신화가 필요할 때 실행)
npm run build

# 5. 실행
npm start
```

브라우저에서 `http://localhost:3456` 접속 → 온보딩 화면에서 이름·회사 등록 → 사용 시작.

---

## ENV 키 안내

정본은 `.env.example`입니다(전체 키·기본값·설명 포함). `.env.example`을 복사한 `.env`에서 편집하세요. 아래는 발췌이며 실제 값은 직접 발급·입력.

| 키 | 필수 | 설명 |
|----|------|------|
| `CLAUDE_PATH` | **필수** | `claude` CLI 경로. 기본값 `claude`로 대부분 동작 |
| `WORKSPACE_ROOT` | 선택 | 에이전트 프로젝트 저장 상위 디렉터리 (기본: `~/Documents/projects`) |
| `PROJECTS_FOLDER` | 선택 | WORKSPACE_ROOT 하위 폴더명 (기본: `mycrew-works`). **설정 후 변경 금지** |
| `PORT` | 선택 | 서버 포트 (기본: `3456`) |
| `APPROVAL_RESOLVE_TOKEN` | 선택 | 외부 접속 시 **반드시** 설정. 미설정 시 승인 API 무인증 |
| `NGROK_URL` | 선택 | ngrok 외부 접속 도메인 (외부 접속 A안) |
| `TUNNEL_HOST` / `TUNNEL_KEY` / `TUNNEL_URL` | 선택 | SSH 터널 외부 접속 (B안) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | 선택 | Gmail·Calendar·Drive MCP 연동 |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `GOOGLE_CALLBACK_URL` | 선택 | Google SSO 로그인 |
| `ALLOWED_EMAILS` | 선택 | SSO 활성화 시 허용 이메일 목록 (쉼표 구분) |

---

## 재시작

```bash
npm start   # 멈추려면 Ctrl+C
```

---

## 설치 후 아이콘 실행 (macOS)

`npm start` 대신 데스크톱·Launchpad에서 MyCrew를 더블클릭으로 실행할 수 있습니다.

```bash
# 1. (선택) 아이콘 재생성 — 로고를 바꿨을 때만 필요
bash scripts/make-icons.sh

# 2. /Applications 설치
./install-app.command           # Finder에서 더블클릭 가능
```

- 설치 후 Spotlight·Launchpad에서 **MyCrew** 검색 → 클릭하면
  - 프로젝트 경로(`~/.config/mycrew/project_path` 기록)를 찾아
  - 백그라운드로 `npx tsx src/index.ts` 기동 (필요시 빌드 자동)
  - 브라우저를 `http://localhost:PORT` 로 자동 오픈합니다.
- 이미 서버가 떠 있으면 브라우저만 엽니다.
- 빌드/서버 로그: `/tmp/mycrew-build.log`, `/tmp/mycrew-server.log`

> 참고: 미서명 앱이므로 처음 실행 시 우클릭 → "열기" 를 한 번 거쳐야 macOS Gatekeeper가 허용합니다.

---

## Windows 환경

`README-WINDOWS.md` 참조 — WSL2 기반 자동 설치 스크립트(`setup-windows.ps1`) 안내 포함.

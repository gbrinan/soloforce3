#!/bin/bash
# My Crew 초기 설정 스크립트 (macOS)
# 사용법: chmod +x setup.sh && ./setup.sh

set -e

# 스크립트 파일 위치로 이동
cd "$(dirname "$0")"

echo ""
echo "========================================="
echo "  My Crew - AI 에이전트 팀 설정"
echo "========================================="
echo ""

# 0. nvm/fnm 등 비전역 Node 환경 로드
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
[ -s "$HOME/.fnm/fnm.sh" ] && eval "$(fnm env 2>/dev/null)"
[ -f /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"

# 1. Node.js 확인 (없으면 Homebrew로 설치)
if command -v node &>/dev/null; then
  echo "✅ Node.js $(node -v) 감지"
else
  echo "⚠️  Node.js가 설치되어 있지 않습니다. 자동 설치를 시작합니다."
  if ! command -v brew &>/dev/null; then
    echo "🍺 Homebrew 설치 중..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  fi
  echo "📦 Node.js 설치 중..."
  brew install node
  echo "✅ Node.js $(node -v) 설치 완료"
fi

# 2. npm install — 네트워크 오류에 취약한 대용량 설치라 3회 재시도 + 실패 시 명확한 안내.
#    (--silent로 에러까지 숨겨 조용히 죽던 문제 수정: 진행/에러가 보이도록 기본 출력 유지)
echo ""
echo "📦 패키지 설치 중... (네트워크 상태에 따라 5~30분 걸릴 수 있어요 — 창을 닫지 마세요)"
NPM_OK=false
for NPM_TRY in 1 2 3; do
  if npm install --no-audit --no-fund; then
    NPM_OK=true
    break
  fi
  echo ""
  echo "⚠️  패키지 설치 실패 (시도 ${NPM_TRY}/3) — 네트워크 일시 오류일 수 있어 10초 후 재시도합니다."
  sleep 10
done
if [ "$NPM_OK" != "true" ]; then
  echo ""
  echo "❌ 패키지 설치에 3회 모두 실패했습니다. 설치를 중단합니다."
  echo ""
  echo "   확인해 주세요:"
  echo "   1) 인터넷 연결 상태 (VPN/프록시/방화벽이 npm 레지스트리를 막는지)"
  echo "   2) 디스크 여유 공간 (2GB 이상 권장)"
  echo "   3) 잠시 후 이 파일(setup.command)을 다시 실행하면 이어서 설치됩니다"
  echo ""
  exit 1
fi
echo "✅ 패키지 설치 완료"

# 3. Claude Code CLI 확인
echo ""
if command -v claude &>/dev/null; then
  CLAUDE_BIN=$(which claude)
  echo "✅ Claude Code CLI 감지: $CLAUDE_BIN"

  # 3-1. 로그인 확인
  echo ""
  LOGGED_IN=$(claude auth status 2>/dev/null | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.exit(JSON.parse(d).loggedIn?0:1)}catch{process.exit(1)}})" 2>/dev/null; echo $?)
  if [ "$LOGGED_IN" = "0" ]; then
    echo "✅ Claude Code CLI 로그인 확인"
  else
    echo "⚠️  Claude Code CLI에 로그인되어 있지 않습니다."
    echo ""
    echo "   아래 명령어로 로그인하세요:"
    echo "   $ claude"
    echo ""
    echo "   (브라우저가 열리면 계정으로 로그인 후 이 터미널로 돌아오세요)"
    echo ""
    while true; do
      read -p "로그인 완료 후 Enter를 누르세요 (건너뛰려면 s): " LOGIN_DONE
      if [ "$LOGIN_DONE" = "s" ]; then
        echo "   ⚠️  로그인 없이 계속합니다. 에이전트가 작동하지 않을 수 있습니다."
        break
      fi
      LOGGED_IN=$(claude auth status 2>/dev/null | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.exit(JSON.parse(d).loggedIn?0:1)}catch{process.exit(1)}})" 2>/dev/null; echo $?)
      if [ "$LOGGED_IN" = "0" ]; then
        echo "✅ 로그인 확인됐습니다."
        break
      else
        echo "   아직 로그인이 확인되지 않았습니다. 다시 시도해주세요."
      fi
    done
  fi
else
  echo ""
  echo "⚠️  Claude Code CLI가 설치되어 있지 않습니다."
  read -p "자동 설치하시겠습니까? (Y/n): " INSTALL_CLAUDE
  INSTALL_CLAUDE=${INSTALL_CLAUDE:-Y}
  if [[ "$INSTALL_CLAUDE" =~ ^[Yy]$ ]]; then
    echo "📦 Claude Code CLI 설치 중..."
    npm install -g @anthropic-ai/claude-code
    CLAUDE_BIN=$(which claude)
    echo "✅ Claude Code CLI 설치 완료"
  else
    echo "   나중에 설치: npm install -g @anthropic-ai/claude-code"
    CLAUDE_BIN="claude"
  fi
fi

# 4. .env 생성
if [ -f .env ]; then
  echo ""
  echo "✅ .env 파일이 이미 존재합니다. 건너뜁니다."
else
  echo ""
  echo "─── 환경 설정 ───"
  echo ""

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  DEFAULT_WORKSPACE="$(dirname "$SCRIPT_DIR")"

  # 작업 디렉토리
  echo "작업 디렉토리: 이 서버의 상위 폴더입니다. 에이전트가 작업하는 루트 경로로 사용됩니다."
  read -p "  경로 [$DEFAULT_WORKSPACE]: " WORKSPACE
  WORKSPACE=${WORKSPACE:-$DEFAULT_WORKSPACE}
  echo ""

  # 프로젝트 폴더명
  echo "프로젝트 폴더: 작업 디렉토리 안에 생성되는 프로젝트 집합 폴더입니다. (예: $WORKSPACE/mycrew-works/)"
  read -p "  폴더명 [mycrew-works]: " PROJECTS
  PROJECTS=${PROJECTS:-mycrew-works}
  echo ""

  # 포트
  RESERVED_PORTS="3457 3458 3459 8080"
  while true; do
    read -p "서버 포트 [3456]: " PORT
    PORT=${PORT:-3456}
    CONFLICT=false
    for rp in $RESERVED_PORTS; do
      if [ "$PORT" = "$rp" ]; then
        echo "⚠️  포트 $rp는 시스템 내부용으로 예약되어 있습니다. (3457=검증, 3458=verify, 3459=테스트, 8080=터널)"
        CONFLICT=true
        break
      fi
    done
    if [ "$CONFLICT" = false ]; then break; fi
  done
  echo ""

  # 승인 토큰 자동 생성
  TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  cat > .env << EOF
# My Crew 환경 설정 (자동 생성: $(date '+%Y-%m-%d %H:%M'))
CLAUDE_PATH=$CLAUDE_BIN
WORKSPACE_ROOT=$WORKSPACE
PROJECTS_FOLDER=$PROJECTS
PORT=$PORT
APPROVAL_RESOLVE_TOKEN=$TOKEN

# 외부 접속 (필요 시 지니에게 요청하세요)
# TUNNEL_HOST=
# TUNNEL_KEY=
# TUNNEL_URL=
EOF

  echo ""
  echo "✅ .env 파일 생성 완료"
fi

# 5. 빌드
echo ""
echo "🔨 서버 빌드 중..."
npx tsc 2>/dev/null
if [ $? -ne 0 ]; then
  echo "⚠️  서버 빌드 경고 (계속 진행)"
fi
echo "🔨 클라이언트 빌드 중..."
npx vite build --config src/client/vite.config.ts 2>/dev/null
if [ $? -ne 0 ]; then
  echo "❌ 클라이언트 빌드 실패. 대시보드가 표시되지 않을 수 있습니다."
  exit 1
fi
echo "✅ 빌드 완료"

# 5-1. 서브앱(apps/*) 의존성 설치 — Next.js dev 서버 기동에 필수
# (.next/ 빌드 산출물은 zip에서 제외되므로 첫 진입 시 next dev가 on-demand 컴파일)
if [ -d apps ]; then
  echo ""
  echo "📦 서브앱 의존성 설치 중... (apps/*/)"
  APPS_OK=0
  APPS_FAIL=0
  FAILED_LIST=""
  for app_dir in apps/*/; do
    app_name=$(basename "$app_dir")
    if [ -f "${app_dir}package.json" ]; then
      echo "  → $app_name"
      (cd "$app_dir" && npm install --silent --no-audit --no-fund >/dev/null 2>&1)
      if [ $? -eq 0 ]; then
        APPS_OK=$((APPS_OK + 1))
      else
        APPS_FAIL=$((APPS_FAIL + 1))
        FAILED_LIST="$FAILED_LIST $app_name"
      fi
    fi
  done
  if [ $APPS_FAIL -eq 0 ]; then
    echo "✅ 서브앱 의존성 설치 완료 ($APPS_OK개)"
  else
    echo "⚠️  서브앱 의존성 설치: $APPS_OK개 성공, $APPS_FAIL개 실패 ($FAILED_LIST)"
    echo "   실패한 앱은 진입 시 표시되지 않을 수 있습니다."
    echo "   수동 재시도: (cd apps/<앱명> && npm install)"
  fi
fi

# 6. 서버 시작
echo ""
echo "========================================="
echo "  설정 완료! 서버를 시작합니다."
echo "========================================="
echo ""
echo "  대시보드: http://localhost:${PORT}"
echo ""

# 기존 서버 종료 (포트 충돌 방지)
lsof -ti:${PORT} | xargs kill 2>/dev/null || true
sleep 1
nohup npx tsx src/index.ts > /tmp/teamLGS.log 2>&1 &

# 브라우저 자동 열기 (1.5초 후)
(sleep 1.5 && open "http://localhost:${PORT}") &

echo "✅ 서버가 시작되었습니다. (백그라운드 실행 중)"
echo ""
echo "📋 브라우저에서 온보딩 화면이 열립니다."
echo "   회사명, 사용자 이름, 비서 이름을 입력하고 '시작하기'를 눌러주세요."
echo ""
echo "💡 이 터미널 창은 닫아도 됩니다. 서버는 계속 실행됩니다."
echo "   서버 종료: lsof -ti:${PORT} | xargs kill"
echo "   서버 재시작: npm run start"
echo "   로그 확인: tail -f /tmp/teamLGS.log"
echo ""

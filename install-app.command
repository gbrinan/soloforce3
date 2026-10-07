#!/usr/bin/env bash
# Installs MyCrew.app into /Applications and records the project path
# so the launcher can find it later.

set -e

cd "$(dirname "$0")"
PROJECT="$(pwd)"
APP_SRC="$PROJECT/assets/installer/MyCrew.app"
APP_DST="/Applications/MyCrew.app"

if [ ! -d "$APP_SRC" ]; then
  echo "❌ assets/installer/MyCrew.app 가 없습니다."
  echo "   먼저 'bash scripts/make-icons.sh' 를 실행해 아이콘을 생성하세요."
  exit 1
fi

echo "📦 MyCrew.app 을 /Applications 으로 설치합니다..."
if [ -d "$APP_DST" ]; then
  rm -rf "$APP_DST"
fi
cp -R "$APP_SRC" "$APP_DST"

# Remember where the project lives so the launcher can find it.
mkdir -p "$HOME/.config/mycrew"
printf '%s\n' "$PROJECT" > "$HOME/.config/mycrew/project_path"

# Refresh Finder so the icon appears immediately.
/usr/bin/touch "$APP_DST"
/usr/bin/killall Finder >/dev/null 2>&1 || true

echo "✅ 설치 완료: /Applications/MyCrew.app"
echo "   런처가 사용할 프로젝트 경로: $PROJECT"
echo ""
echo "Launchpad / Spotlight에서 'MyCrew' 로 검색해 실행하세요."

read -p "Enter 키를 누르면 이 창이 닫힙니다..."

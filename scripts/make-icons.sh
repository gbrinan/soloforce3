#!/usr/bin/env bash
# Generates multi-resolution app icons from src/client/assets/mycrew-logo.png.
# - macOS: mycrew.icns via sips + iconutil
# - Windows: mycrew.ico via sips multi-PNG + Node ico encoder
# Outputs land in assets/installer/.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_PNG="$ROOT/src/client/assets/mycrew-logo.png"
OUT_DIR="$ROOT/assets/installer"
APP_RES_DIR="$ROOT/assets/installer/MyCrew.app/Contents/Resources"

if [ ! -f "$SRC_PNG" ]; then
  echo "[make-icons] source logo not found: $SRC_PNG" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "[make-icons] sips not found (macOS-only). Skipping." >&2
  exit 0
fi
if ! command -v iconutil >/dev/null 2>&1; then
  echo "[make-icons] iconutil not found (macOS-only). Skipping." >&2
  exit 0
fi

mkdir -p "$OUT_DIR" "$APP_RES_DIR"

TMP_ICONSET="$(mktemp -d)/mycrew.iconset"
mkdir -p "$TMP_ICONSET"

# Apple-recommended sizes for .icns
declare -a sizes=(16 32 64 128 256 512 1024)
for s in "${sizes[@]}"; do
  sips -z "$s" "$s" "$SRC_PNG" --out "$TMP_ICONSET/icon_${s}x${s}.png" >/dev/null
done
# Retina @2x companions
cp "$TMP_ICONSET/icon_32x32.png"     "$TMP_ICONSET/icon_16x16@2x.png"
cp "$TMP_ICONSET/icon_64x64.png"     "$TMP_ICONSET/icon_32x32@2x.png"
cp "$TMP_ICONSET/icon_256x256.png"   "$TMP_ICONSET/icon_128x128@2x.png"
cp "$TMP_ICONSET/icon_512x512.png"   "$TMP_ICONSET/icon_256x256@2x.png"
cp "$TMP_ICONSET/icon_1024x1024.png" "$TMP_ICONSET/icon_512x512@2x.png"
# Remove non-standard 64/1024 from the iconset (they were only retina sources)
rm -f "$TMP_ICONSET/icon_64x64.png" "$TMP_ICONSET/icon_1024x1024.png"

iconutil -c icns "$TMP_ICONSET" -o "$OUT_DIR/mycrew.icns"
cp "$OUT_DIR/mycrew.icns" "$APP_RES_DIR/mycrew.icns"
echo "[make-icons] wrote $OUT_DIR/mycrew.icns"

# .ico for Windows — build via Node encoder.
ICO_TMP="$(mktemp -d)"
for s in 16 32 48 64 128 256; do
  sips -z "$s" "$s" "$SRC_PNG" --out "$ICO_TMP/icon_${s}.png" >/dev/null
done

node "$ROOT/scripts/encode-ico.mjs" \
  "$ICO_TMP/icon_16.png" \
  "$ICO_TMP/icon_32.png" \
  "$ICO_TMP/icon_48.png" \
  "$ICO_TMP/icon_64.png" \
  "$ICO_TMP/icon_128.png" \
  "$ICO_TMP/icon_256.png" \
  "$OUT_DIR/mycrew.ico"

echo "[make-icons] wrote $OUT_DIR/mycrew.ico"

rm -rf "$TMP_ICONSET" "$ICO_TMP"

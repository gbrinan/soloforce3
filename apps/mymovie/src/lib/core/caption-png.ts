// drawtext 미지원 ffmpeg 환경에서 caption을 굽기 위한 PNG 생성기.
// SVG → PNG (sharp). SVG는 system 폰트로 렌더되며, sharp는 텍스트 렌더링 시
// fontconfig가 가능한 폰트 패밀리를 자동 선택한다. 폰트 미지정으로 sans-serif fallback.

import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import sharp from "sharp";

export interface CaptionPngInput {
  text: string;
  outDir: string;
  // base video resolution — PNG canvas는 동일 해상도로 만들어 overlay 좌표를 (0,0)으로 고정.
  width: number;
  height: number;
  pos: "top" | "bottom" | "center";
  fontSize: number;
  fontColor: string;
  id: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function yForPos(pos: "top" | "bottom" | "center", height: number, fontSize: number): number {
  // y는 텍스트의 baseline 기준. 상자 padding 포함.
  const pad = Math.round(height * 0.08);
  if (pos === "top") return pad + fontSize;
  if (pos === "center") return Math.round(height / 2 + fontSize / 3);
  return height - pad;
}

export async function renderCaptionPng(input: CaptionPngInput): Promise<string> {
  const { text, width, height, pos, fontSize, fontColor, id, outDir } = input;
  const safeText = escapeXml(text);
  const y = yForPos(pos, height, fontSize);
  // 배경 박스: 텍스트 가운데 정렬. SVG <text>는 자동 줄바꿈 없음 — 한 줄로 그린다.
  // 검은 박스 + 흰색 텍스트(또는 지정 색). text-anchor=middle로 가운데 정렬.
  const boxPad = Math.round(fontSize * 0.4);
  const boxH = fontSize + boxPad * 2;
  const boxY = y - fontSize - boxPad;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="${boxY}" width="${width}" height="${boxH}" fill="rgba(0,0,0,0.45)" />
  <text x="${Math.round(width / 2)}" y="${y}"
        font-family="sans-serif" font-size="${fontSize}" font-weight="700"
        fill="${fontColor}" text-anchor="middle" dominant-baseline="alphabetic">${safeText}</text>
</svg>`;
  const out = resolvePath(outDir, `caption_${id}.png`);
  // sharp는 SVG raster 시 fontconfig를 통해 시스템 폰트(예: AppleSDGothicNeo)를 가져온다.
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(out, buf);
  return out;
}

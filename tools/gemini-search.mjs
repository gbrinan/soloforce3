#!/usr/bin/env node
// Gemini 그라운딩 검색 헬퍼 — 워커(SafeBash)에서 사용. [로컬 패치 2026-07-15]
// 사용법: node tools/gemini-search.mjs "검색 질문" [--model gemini-2.5-flash]
// GEMINI_API_KEY는 프로젝트 루트 .env에서 직접 읽는다(워커 env에는 전달되지 않음).
// 출력: 그라운딩된 답변 텍스트 + 출처 URL 목록(JSON).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const query = process.argv[2];
if (!query) {
  console.error("usage: node tools/gemini-search.mjs \"query\" [--model <model>]");
  process.exit(1);
}
const modelIdx = process.argv.indexOf("--model");
const model = modelIdx > 0 ? process.argv[modelIdx + 1] : "gemini-2.5-flash";

let apiKey = process.env.GEMINI_API_KEY ?? "";
if (!apiKey) {
  try {
    const env = readFileSync(join(__dirname, "..", ".env"), "utf-8");
    const m = env.match(/^GEMINI_API_KEY=(.+)$/m);
    if (m) apiKey = m[1].trim();
  } catch { /* .env 없음 */ }
}
if (!apiKey) {
  console.error("GEMINI_API_KEY not found (.env)");
  process.exit(2);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const body = {
  contents: [{ parts: [{ text: query }] }],
  tools: [{ google_search: {} }],
};

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
    process.exit(3);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c) => c.web ? { title: c.web.title ?? "", url: c.web.uri ?? "" } : null)
    .filter(Boolean);
  console.log(JSON.stringify({ answer: text, sources }, null, 2));
} catch (err) {
  console.error(`request failed: ${err?.message ?? err}`);
  process.exit(4);
}

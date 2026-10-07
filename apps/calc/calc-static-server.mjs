// 계산기(calc) 정적 서버 — base prefix(/api/apps/calc/proxy) SPA 서빙 + /api/health
// + POST /api/ai/parse(자연어 → 의도·파라미터 분류, 계산은 클라이언트가 수행).
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude, extractJson } from "@mycrew/ai-client/node";

// 이 스크립트 위치 기준 상대경로 — 설치 경로에 무관하게 동작(하드코딩 절대경로 제거).
const DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const PREFIX = "/api/apps/calc/proxy";
const PORT = 13243;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// ── AI 자연어 계산 파싱 — 공용 @mycrew/ai-client 경유(게이트웨이 시 호스트 위임: 인증·레이트리밋·비용집계) ──
const AI_TIMEOUT_MS = 60_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

// 오늘 날짜(YYYY-MM-DD) — 날짜 계산 상대표현(D+100 등) 해석용.
function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// AI는 "어느 계산기 + 어떤 값"만 분류(계산 금지) → 환각 최소화, 실제 계산은 클라이언트가 재사용.
async function handleAiParse(req, res) {
  let input;
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    input = String(body.input ?? "").trim();
  } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
  if (!input) { sendJson(res, 400, { error: "input required" }); return; }

  const prompt = [
    "You route a free-form (Korean/English) calculator request to ONE of five calculators and extract its parameters.",
    "Do NOT perform the calculation — only classify the intent and pull out the input values.",
    `Today is ${todayStr()} (for relative dates like D+100, 오늘부터 30일 후).`,
    "Output ONLY a JSON object (no prose, no code fences) in exactly one of these shapes:",
    '- basic:      {"intent":"basic","params":{"value":<number|null>}}',
    '- scientific: {"intent":"scientific","params":{"value":<number|null>}}',
    '- finance:    {"intent":"finance","params":{"amount":<loan principal in KRW won as integer>,"rate":<annual percent number>,"years":<number>,"method":"annuity"|"principal"|"bullet"}}',
    '- converter:  {"intent":"converter","params":{"category":"length"|"weight"|"data"|"temp","fromUnit":<unit id>,"toUnit":<unit id>,"value":<number>}}',
    '- date:       {"intent":"date","params":{"mode":"diff"|"add","dateA":"YYYY-MM-DD","dateB":"YYYY-MM-DD","baseDate":"YYYY-MM-DD","days":<integer>}}',
    "converter unit ids — length: mm,cm,m,km,in,ft,mi | weight: g,kg,t,oz,lb | data: B,KB,MB,GB,TB | temp: c,f,k.",
    "finance method: annuity(원리금균등), principal(원금균등), bullet(만기일시). Default annuity if unclear.",
    "date mode: diff(두 날짜 차이 → dateA,dateB) or add(기준일+일수 → baseDate,days). D+100 → mode add, baseDate today, days 100.",
    "For amounts: 150만원=1500000, 1.5억=150000000. Omit/param null if a value is genuinely absent.",
    "Optionally add \"explanation\":\"<one short line in the user's language>\".",
    "Request:",
    input.slice(0, 1000),
  ].join("\n");

  let parsed;
  try {
    const raw = await runClaude(prompt, { appId: "calc", feature: "nl-calc", timeoutMs: AI_TIMEOUT_MS });
    parsed = extractJson(raw);
  } catch (e) {
    sendJson(res, 500, { error: "AI 호출 실패", detail: String(e?.message ?? e).slice(0, 200) });
    return;
  }
  const VALID = new Set(["basic", "scientific", "finance", "converter", "date"]);
  if (!parsed || typeof parsed !== "object" || !VALID.has(parsed.intent)) {
    sendJson(res, 500, { error: "AI 응답 파싱 실패" });
    return;
  }
  sendJson(res, 200, {
    intent: parsed.intent,
    params: parsed.params && typeof parsed.params === "object" ? parsed.params : {},
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : undefined,
  });
}

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length);
  if (req.method === "POST" && p === "/api/ai/parse") { await handleAiParse(req, res); return; }
  if (p === "/api/health" || p === "") {
    if (p === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, app: "calc" }));
      return;
    }
  }
  if (p === "" || p === "/") p = "/index.html";
  const rel = normalize(p).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(DIST, rel);
  try {
    const st = await stat(filePath);
    const fp = st.isDirectory() ? join(filePath, "index.html") : filePath;
    const data = await readFile(fp);
    res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream", "cache-control": extname(fp) === ".html" ? "no-cache" : "public, max-age=3600" });
    res.end(data);
  } catch {
    if (extname(rel)) { res.writeHead(404); res.end("not found"); return; }
    try {
      const data = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(data);
    } catch { res.writeHead(404); res.end("not found"); }
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`calc-static on http://127.0.0.1:${PORT} prefix=${PREFIX} dist=${DIST}`));

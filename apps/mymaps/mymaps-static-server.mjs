// 내 지도(mymaps) 정적 서버 — base prefix(/api/apps/mymaps/proxy) SPA 서빙.
// vite preview의 trailing-slash 엄격함(no-slash 루트 404 → mycrew 프록시 경유 빈 화면)을
// 회피. 호스트 app-proxy가 슬래시 없이 전달하는 루트도 index.html로 응답.
import http from "node:http";
import { runClaude as runShared } from "@mycrew/ai-client/node";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 이 스크립트 위치 기준 상대경로 — 설치 경로에 무관하게 동작(하드코딩 절대경로 제거).
const DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const PREFIX = "/api/apps/mymaps/proxy";
const PORT = 13211;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".csv": "text/csv",
};

// --- AI endpoints — 공용 @mycrew/ai-client 경유(게이트웨이 모드 시 호스트 위임: 인증·레이트리밋·비용집계) ---
const AI_TIMEOUT_MS = 90_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// 공용 클라이언트로 위임 — appId "mymaps"로 비용 귀속, feature로 라우트 구분.
function runClaude(prompt, feature) {
  return runShared(prompt, { appId: "mymaps", feature, timeoutMs: AI_TIMEOUT_MS });
}

// Extract JSON from a CLI answer that may include code fences or surrounding prose.
function extractJson(raw) {
  let text = String(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const endChar = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(endChar);
  if (end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function handleAi(p, req, res) {
  let body;
  try { body = JSON.parse((await readBody(req)) || "{}"); }
  catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }

  try {
    if (p === "/ai/places") {
      const query = String(body.query ?? "").trim();
      if (!query) { sendJson(res, 400, { error: "query required" }); return; }
      const prompt = [
        "You are a map assistant. A user asked (likely in Korean):",
        `"${query}"`,
        "Suggest real-world places matching the request. Honor the count in the request (default 3, max 10).",
        "Answer with ONLY a JSON array, no prose, in this exact shape:",
        '[{"name":"place name in the user\'s language","lat":0.0,"lng":0.0,"note":"one-line description in the user\'s language","geocode":"official or English place name plus city/country, for geocoding"}]',
        "Use your best knowledge for approximate coordinates (decimal degrees, WGS84).",
      ].join("\n");
      const raw = await runClaude(prompt, "places");
      const arr = extractJson(raw);
      if (!Array.isArray(arr)) { sendJson(res, 502, { error: "AI 응답 파싱 실패" }); return; }
      const places = arr
        .filter((x) => x && typeof x.name === "string" && Number.isFinite(+x.lat) && Number.isFinite(+x.lng))
        .slice(0, 10)
        .map((x) => ({
          name: x.name,
          lat: +x.lat,
          lng: +x.lng,
          note: typeof x.note === "string" ? x.note : "",
          geocode: typeof x.geocode === "string" ? x.geocode : "",
        }));
      sendJson(res, 200, { places });
      return;
    }
    if (p === "/ai/layer") {
      // Parse a natural-language layer request into { layerName, region, color, queries }.
      // Geocoding runs client-side (search.ts) — this endpoint only decomposes the request.
      const query = String(body.query ?? "").trim();
      if (!query) { sendJson(res, 400, { error: "query required" }); return; }
      const lang = ["ko", "en", "ja"].includes(body.lang) ? body.lang : "ko"; // mirror search.ts clamp
      const prompt = [
        "You are a map assistant. Parse this natural-language request for a new map layer:",
        `"${query}"`,
        `Write layerName and queries in this language: ${lang}.`,
        "If the request names a category (e.g. 5-star hotels in Seoul), list individual real,",
        "well-known places by name. Honor any count in the request (default 5, max 10).",
        "Each query must be a geocodable search string: place name plus city/region.",
        "Answer with ONLY a JSON object, no prose, in this exact shape:",
        '{"layerName":"short layer title","region":"city or region, may be empty","color":"#RRGGBB hex fitting the theme","queries":["place name + region", ...]}',
      ].join("\n");
      const raw = await runClaude(prompt, "layer");
      const obj = extractJson(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) { sendJson(res, 502, { error: "AI 응답 파싱 실패" }); return; }
      const queries = (Array.isArray(obj.queries) ? obj.queries : [])
        .filter((q) => typeof q === "string" && q.trim())
        .map((q) => q.trim())
        .slice(0, 10);
      if (!queries.length) { sendJson(res, 502, { error: "AI가 검색 항목을 만들지 못했습니다" }); return; }
      sendJson(res, 200, {
        layerName: typeof obj.layerName === "string" && obj.layerName.trim() ? obj.layerName.trim().slice(0, 60) : query.slice(0, 60),
        region: typeof obj.region === "string" ? obj.region.trim() : "",
        color: typeof obj.color === "string" && /^#[0-9a-fA-F]{6}$/.test(obj.color.trim()) ? obj.color.trim() : "#6366F1",
        queries,
      });
      return;
    }
    if (p === "/ai/note") {
      const name = String(body.name ?? "").trim();
      if (!name) { sendJson(res, 400, { error: "name required" }); return; }
      const address = String(body.address ?? "").trim();
      const lat = +body.lat;
      const lng = +body.lng;
      const loc = Number.isFinite(lat) && Number.isFinite(lng) ? ` located near lat ${lat}, lng ${lng}` : "";
      const prompt = [
        `Describe the place "${name}"${address ? ` (address: ${address})` : ""}${loc}.`,
        "Write a short Korean memo (3-5 sentences): key features, what it is known for, commonly known opening hours if any, and one visit tip.",
        "Answer with ONLY the memo text, no preamble, no markdown.",
      ].join("\n");
      const raw = await runClaude(prompt, "note");
      if (!raw) { sendJson(res, 502, { error: "AI 응답이 비어 있음" }); return; }
      sendJson(res, 200, { note: `${raw}\n\n(AI 생성 — 영업시간은 부정확할 수 있음)` });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    const timedOut = err && (err.killed || err.code === "ETIMEDOUT");
    sendJson(res, 502, { error: timedOut ? "AI 응답 시간 초과" : "AI 실행 실패" });
  }
}

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length);
  if (req.method === "POST" && p.startsWith("/ai/")) { await handleAi(p, req, res); return; }
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
server.listen(PORT, "127.0.0.1", () => console.log(`mymaps-static on http://127.0.0.1:${PORT} prefix=${PREFIX} dist=${DIST}`));

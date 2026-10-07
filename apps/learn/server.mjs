// 학습(learn) 서버 — base prefix(/api/apps/learn/proxy) SPA 서빙
// + 덱 CRUD(data/learn.json) + SM-2 간격반복(SRS) + AI 학습 자료 생성 + 책장 소스 연동.
import http from "node:http";
import { readFile, stat, mkdir, writeFile, rename } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runClaude, extractJson } from "@mycrew/ai-client/node";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const DATA_DIR = join(ROOT, "data");
const DATA_FILE = join(DATA_DIR, "learn.json");
// 책장 앱 데이터 직접 읽기 (읽기 전용) — 없으면 빈 배열 폴백
const BOOKS_FILE = join(ROOT, "..", "bookshelf", "data", "books.json");
const PREFIX = "/api/apps/learn/proxy";
// 기본 13247 (manifest.ports.http) — PORT env로 오버라이드 가능 (프리뷰·테스트용)
const PORT = Number(process.env.PORT) || 13247;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// ── 저장소: data/learn.json (atomic write) ──────────────────────────────
// { decks: Deck[], reviews: { cardId, deckId, grade, at }[] }
let db = { decks: [], reviews: [] };
async function loadDb() {
  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, "utf-8"));
    db = {
      decks: Array.isArray(parsed.decks) ? parsed.decks : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
    };
  } catch {
    db = { decks: [], reviews: [] };
  }
}
async function saveDb() {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), "utf-8");
  await rename(tmp, DATA_FILE);
}

// ── SM-2 간격반복 ─────────────────────────────────────────────────────────
// due 계산은 KST(UTC+9) 날짜 기준 — 자정 경계가 한국 시간에 맞도록.
const DAY_MS = 86_400_000;
function kstToday(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3_600_000 + offsetDays * DAY_MS).toISOString().slice(0, 10);
}
const GRADES = new Set(["again", "hard", "good", "easy"]);

// 표준 SM-2 변형 (Anki식 4단계):
// - again: reps 리셋, interval 0(오늘 재출제), ease -0.2 (하한 1.3), lapses +1
// - hard : interval ×1.2, ease -0.15 (하한 1.3)
// - good : interval ×ease (신규 1회차 1일, 2회차 3일)
// - easy : interval ×ease×1.3, ease +0.15 (신규는 4일)
function applySm2(card, grade) {
  const ease = typeof card.ease === "number" ? card.ease : 2.5;
  if (grade === "again") {
    card.reps = 0;
    card.lapses = (card.lapses ?? 0) + 1;
    card.intervalDays = 0;
    card.ease = Math.max(1.3, Math.round((ease - 0.2) * 100) / 100);
  } else if (grade === "hard") {
    card.ease = Math.max(1.3, Math.round((ease - 0.15) * 100) / 100);
    card.intervalDays = card.reps === 0 ? 1 : Math.max(1, Math.ceil(card.intervalDays * 1.2));
    card.reps = (card.reps ?? 0) + 1;
  } else if (grade === "good") {
    card.intervalDays = card.reps === 0 ? 1 : card.reps === 1 ? 3 : Math.max(1, Math.round(card.intervalDays * ease));
    card.reps = (card.reps ?? 0) + 1;
  } else { // easy
    card.ease = Math.round((ease + 0.15) * 100) / 100;
    card.intervalDays = card.reps === 0 ? 4 : Math.max(1, Math.round(card.intervalDays * card.ease * 1.3));
    card.reps = (card.reps ?? 0) + 1;
  }
  card.due = kstToday(card.intervalDays);
  card.lastReviewedAt = new Date().toISOString();
  return card;
}

function newCard(front, back) {
  return {
    id: randomUUID(),
    front: String(front).slice(0, 1000),
    back: String(back).slice(0, 2000),
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    due: kstToday(), // 신규 카드는 오늘부터 출제
    lastReviewedAt: null,
  };
}

// ── 덱 생성 (수동/AI 공용 — 페이로드 검증·정규화) ─────────────────────────
function buildDeck(payload, source) {
  const cards = (Array.isArray(payload.flashcards) ? payload.flashcards : [])
    .filter((c) => c && c.front && c.back)
    .slice(0, 50)
    .map((c) => newCard(c.front, c.back));
  const quiz = (Array.isArray(payload.quiz) ? payload.quiz : [])
    .filter((q) => q && q.question && Array.isArray(q.choices) && q.choices.length >= 2)
    .slice(0, 20)
    .map((q) => ({
      question: String(q.question).slice(0, 1000),
      choices: q.choices.slice(0, 4).map((c) => String(c).slice(0, 500)),
      answerIndex: Math.max(0, Math.min(3, Number(q.answerIndex) || 0)),
      explanation: String(q.explanation ?? "").slice(0, 1000),
    }))
    .filter((q) => q.answerIndex < q.choices.length);
  const keyConcepts = (Array.isArray(payload.keyConcepts) ? payload.keyConcepts : [])
    .filter((k) => k && k.term)
    .slice(0, 30)
    .map((k) => ({ term: String(k.term).slice(0, 200), explanation: String(k.explanation ?? "").slice(0, 2000) }));
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: String(payload.title ?? "").slice(0, 200) || "(제목 없음)",
    summary: String(payload.summary ?? "").slice(0, 8000),
    keyConcepts,
    cards,
    quiz,
    source: {
      type: ["paste", "book", "note", "file", "link"].includes(source?.type) ? source.type : "paste",
      title: String(source?.title ?? "").slice(0, 300),
    },
    createdAt: now,
    updatedAt: now,
  };
}

function deckSummary(d) {
  const today = kstToday();
  return {
    id: d.id,
    title: d.title,
    summary: d.summary,
    source: d.source,
    cardCount: d.cards.length,
    dueCount: d.cards.filter((c) => c.reps > 0 && c.due <= today).length,
    newCount: d.cards.filter((c) => c.reps === 0).length,
    quizCount: d.quiz.length,
    createdAt: d.createdAt,
  };
}

// ── AI: Claude CLI (학습 자료 생성) — 공용 @mycrew/ai-client 사용 ──────────
const AI_TIMEOUT_MS = 180_000; // 카드 10~20장 + 퀴즈 생성이라 여유 있게

function classifyClaudeError(err) {
  if (err?.killed || err?.code === "ETIMEDOUT") {
    return { status: 504, message: `AI 응답이 ${AI_TIMEOUT_MS / 1000}초 내에 오지 않았습니다. 잠시 후 다시 시도해주세요.` };
  }
  const out = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}\n${err?.message ?? ""}`;
  if (/hit your limit|usage limit|out of (?:usage|credit)|한도/i.test(out)) {
    const reset = out.match(/resets?\s+([0-9]{1,2}[:.][0-9]{2}\s*(?:am|pm)?(?:\s*\([^)]+\))?)/i);
    return {
      status: 429,
      message: `AI 사용량 한도에 도달했습니다${reset ? ` (리셋: ${reset[1].trim()})` : ""}. 잠시 후 다시 시도해주세요.`,
    };
  }
  if (/overloaded|rate.?limit|\b429\b|\b529\b|too many requests/i.test(out)) {
    return { status: 429, message: "AI 서버가 혼잡합니다. 잠시 후 다시 시도해주세요." };
  }
  return { status: 502, message: "AI 학습 자료를 생성하지 못했습니다. 잠시 후 다시 시도해주세요." };
}

async function generateDeck(text, model) {
  const prompt = `당신은 학습 자료 제작 전문가입니다. 아래 텍스트를 분석해 학습 덱을 JSON으로 생성하세요.

<source>
${text.slice(0, 16_000)}
</source>

요구사항:
- title: 학습 주제를 나타내는 간결한 제목
- summary: 핵심 내용 요약 (한국어, 3~6문장)
- keyConcepts: 핵심 개념 5~10개 [{ "term": "용어", "explanation": "설명 1~3문장" }]
- flashcards: 암기 카드 10~20장 [{ "front": "질문/용어", "back": "답/설명" }] — front는 짧은 질문, back은 명확한 답
- quiz: 4지선다 퀴즈 5~10문 [{ "question": "문제", "choices": ["보기1","보기2","보기3","보기4"], "answerIndex": 0, "explanation": "해설 1~2문장" }] — choices는 정확히 4개, answerIndex는 0~3

소스 텍스트에 실제로 담긴 내용만 사용하고, 한국어로 작성하세요.
응답 형식 (JSON만 출력):
{
  "title": "...",
  "summary": "...",
  "keyConcepts": [...],
  "flashcards": [...],
  "quiz": [...]
}`;
  const out = await runClaude(prompt, {
    timeoutMs: AI_TIMEOUT_MS,
    model: model || "claude-sonnet-4-6",
    appId: "learn",
    feature: "generate-deck",
  });
  const parsed = extractJson(out);
  if (!parsed || !parsed.title || !Array.isArray(parsed.flashcards) || parsed.flashcards.length === 0) return null;
  return parsed;
}

// ── 책장 소스: apps/bookshelf/data/books.json 직접 읽기 (없으면 빈 배열) ──
async function loadBookSources() {
  try {
    const books = JSON.parse(await readFile(BOOKS_FILE, "utf-8"));
    if (!Array.isArray(books)) return [];
    return books.map((b) => ({
      id: b.id,
      title: b.title ?? "(제목 없음)",
      authors: Array.isArray(b.authors) ? b.authors : [],
      publisher: b.publisher ?? "",
      description: b.description ?? "",
      memo: b.memo ?? "",
      thumbnail: b.thumbnail ?? "",
      status: b.status ?? "todo",
    }));
  } catch {
    return [];
  }
}

// ── 링크 소스: URL → 본문 텍스트 추출 (서버 fetch — CORS 우회) ────────────
const HTML_ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
async function extractUrlText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; MyCrewLearn/1.0)", "accept": "text/html,application/xhtml+xml,text/plain,*/*" },
    });
    if (!r.ok) return { error: `페이지를 불러오지 못했습니다 (HTTP ${r.status}).`, status: 502 };
    const ct = r.headers.get("content-type") ?? "";
    const raw = (await r.text()).slice(0, 3_000_000);
    let text, title;
    if (/text\/html|application\/xhtml/i.test(ct) || /^\s*<(?:!doctype|html)/i.test(raw)) {
      title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
      text = htmlToText(raw);
    } else {
      title = "";
      text = raw;
    }
    text = text.slice(0, 16_000);
    if (text.trim().length < 30) return { error: "페이지에서 충분한 텍스트를 찾지 못했습니다.", status: 422 };
    return { text, title: title || url };
  } finally {
    clearTimeout(timer);
  }
}

// ── HTTP 유틸 ─────────────────────────────────────────────────────────────
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (d) => {
      size += d.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(d);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// 복습 큐: 오늘 due(again 포함) + 신규 카드. 오래된 due 먼저, 신규는 뒤에.
function reviewQueue(deckId) {
  const today = kstToday();
  const due = [];
  const fresh = [];
  for (const d of db.decks) {
    if (deckId && d.id !== deckId) continue;
    for (const c of d.cards) {
      if (c.due > today) continue;
      const item = { ...c, deckId: d.id, deckTitle: d.title };
      (c.reps === 0 ? fresh : due).push(item);
    }
  }
  due.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return [...due, ...fresh];
}

function stats() {
  const today = kstToday();
  const todayReviews = db.reviews.filter((r) => r.date === today).length;
  const dates = new Set(db.reviews.map((r) => r.date));
  // streak: 오늘(복습했으면) 또는 어제부터 연속 복습일 수
  let streak = 0;
  let d = dates.has(today) ? today : kstToday(-1);
  while (dates.has(d)) {
    streak++;
    d = new Date(new Date(`${d}T00:00:00Z`).getTime() - DAY_MS).toISOString().slice(0, 10);
  }
  let totalCards = 0;
  for (const deck of db.decks) totalCards += deck.cards.length;
  return {
    todayReviews,
    dueCount: reviewQueue().length,
    totalCards,
    deckCount: db.decks.length,
    streak,
  };
}

async function handleApi(req, res, p, query) {
  if (p === "/api/health") return json(res, 200, { ok: true, app: "learn" });

  // ── 학습 소스: 책장 ──
  if (p === "/api/sources/books" && req.method === "GET") {
    return json(res, 200, { items: await loadBookSources() });
  }

  // ── 학습 소스: 링크(URL) → 본문 텍스트 추출 ──
  if (p === "/api/sources/extract-url" && req.method === "POST") {
    const b = await readBody(req);
    const url = String(b.url ?? "").trim();
    if (!/^https?:\/\/.+/i.test(url)) return json(res, 400, { error: "유효한 URL(http/https)이 아닙니다." });
    try {
      const out = await extractUrlText(url);
      if (out.error) return json(res, out.status, { error: out.error });
      return json(res, 200, { text: out.text, title: out.title });
    } catch (e) {
      const msg = e?.name === "AbortError" ? "페이지 요청이 시간 내에 완료되지 않았습니다." : "페이지를 불러오는 중 오류가 발생했습니다.";
      return json(res, 504, { error: msg });
    }
  }

  // ── AI: 텍스트 → 학습 덱 생성 ──
  if (p === "/api/ai/generate-deck" && req.method === "POST") {
    const b = await readBody(req, 2_000_000);
    const text = String(b.text ?? "").trim();
    if (text.length < 30) return json(res, 400, { error: "text (30자 이상) required" });
    try {
      const payload = await generateDeck(text, typeof b.model === "string" ? b.model : undefined);
      if (!payload) return json(res, 422, { error: "AI 응답에서 학습 덱을 추출하지 못했습니다. 다시 시도해주세요." });
      const deck = buildDeck(payload, { type: b.sourceType, title: b.sourceTitle });
      if (deck.cards.length === 0) return json(res, 422, { error: "생성된 카드가 없습니다. 다시 시도해주세요." });
      db.decks.unshift(deck);
      await saveDb();
      return json(res, 201, { item: deck });
    } catch (e) {
      const { status, message } = classifyClaudeError(e);
      return json(res, status, { error: message });
    }
  }

  // ── 덱 CRUD ──
  if (p === "/api/decks" && req.method === "GET") {
    return json(res, 200, { items: db.decks.map(deckSummary) });
  }

  // 수동 덱 생성 (AI 없이 — 시드/테스트·직접 입력용): { title, summary?, keyConcepts?, flashcards, quiz? }
  if (p === "/api/decks" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.title) return json(res, 400, { error: "title required" });
    const deck = buildDeck(b, b.source);
    if (deck.cards.length === 0) return json(res, 400, { error: "flashcards ([{front, back}]) required" });
    db.decks.unshift(deck);
    await saveDb();
    return json(res, 201, { item: deck });
  }

  const m = p.match(/^\/api\/decks\/([0-9a-f-]{36})(\/cards)?$/);
  if (m) {
    const deck = db.decks.find((d) => d.id === m[1]);
    if (!deck) return json(res, 404, { error: "not found" });
    if (m[2] === "/cards" && req.method === "GET") {
      return json(res, 200, { items: deck.cards });
    }
    if (!m[2] && req.method === "GET") return json(res, 200, { item: deck });
    if (!m[2] && req.method === "PATCH") {
      const b = await readBody(req);
      if (b.title !== undefined) deck.title = String(b.title).slice(0, 200) || deck.title;
      deck.updatedAt = new Date().toISOString();
      await saveDb();
      return json(res, 200, { item: deck });
    }
    if (!m[2] && req.method === "DELETE") {
      db.decks = db.decks.filter((d) => d.id !== deck.id);
      db.reviews = db.reviews.filter((r) => r.deckId !== deck.id);
      await saveDb();
      return json(res, 200, { item: deck });
    }
  }

  // ── SRS 복습 ──
  if (p === "/api/review/queue" && req.method === "GET") {
    const deckId = query.get("deckId") ?? undefined;
    return json(res, 200, { items: reviewQueue(deckId), today: kstToday() });
  }

  if (p === "/api/review/answer" && req.method === "POST") {
    const b = await readBody(req);
    const grade = String(b.grade ?? "");
    if (!GRADES.has(grade)) return json(res, 400, { error: "grade (again|hard|good|easy) required" });
    let card = null;
    let deck = null;
    for (const d of db.decks) {
      const c = d.cards.find((x) => x.id === b.cardId);
      if (c) { card = c; deck = d; break; }
    }
    if (!card) return json(res, 404, { error: "card not found" });
    applySm2(card, grade);
    deck.updatedAt = new Date().toISOString();
    db.reviews.push({ cardId: card.id, deckId: deck.id, grade, at: new Date().toISOString(), date: kstToday() });
    if (db.reviews.length > 20_000) db.reviews = db.reviews.slice(-20_000);
    await saveDb();
    return json(res, 200, { item: card });
  }

  // ── 통계 ──
  if (p === "/api/stats" && req.method === "GET") {
    return json(res, 200, stats());
  }

  return json(res, 404, { error: "unknown api" });
}

const server = http.createServer(async (req, res) => {
  const raw = req.url || "/";
  let p = decodeURIComponent(raw.split("?")[0]);
  const query = new URLSearchParams(raw.split("?")[1] ?? "");
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length);

  if (p.startsWith("/api/")) {
    try {
      await handleApi(req, res, p, query);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
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

await loadDb();
server.listen(PORT, "127.0.0.1", () => console.log(`learn on http://127.0.0.1:${PORT} prefix=${PREFIX} dist=${DIST} decks=${db.decks.length}`));

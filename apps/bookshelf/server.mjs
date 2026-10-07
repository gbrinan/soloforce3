// 내 책장(bookshelf) 서버 — base prefix(/api/apps/bookshelf/proxy) SPA 서빙
// + 책장 CRUD(data/books.json) + 도서 검색 프록시(Google Books, 키 불필요).
import http from "node:http";
import { readFile, stat, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { runClaude, extractJson } from "@mycrew/ai-client/node";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const DATA_DIR = join(ROOT, "data");
const BOOKS_FILE = join(DATA_DIR, "books.json");
const PREFIX = "/api/apps/bookshelf/proxy";
// 기본 13244 (manifest.ports.http) — PORT env로 오버라이드 가능 (프리뷰·테스트용)
const PORT = Number(process.env.PORT) || 13244;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// ── 저장소: data/books.json (atomic write) ──────────────────────────────
let books = [];
async function loadBooks() {
  try {
    books = JSON.parse(await readFile(BOOKS_FILE, "utf-8"));
    if (!Array.isArray(books)) books = [];
  } catch {
    books = [];
  }
  // 마이그레이션: events 없는 기존 도서에 추가 이벤트 합성 (캘린더 표시용)
  for (const b of books) {
    if (!Array.isArray(b.events)) b.events = [{ type: "added", at: b.addedAt }];
  }
}
async function saveBooks() {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${BOOKS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(books, null, 2), "utf-8");
  await rename(tmp, BOOKS_FILE);
}

// ── 도서 검색: 공급자 체인 ────────────────────────────────────────────────
// NAVER_CLIENT_ID/SECRET 있으면 네이버(한국어 최적) 우선 → 카카오(KAKAO_REST_KEY)
// → Google Books → Open Library 폴백. Google 무키 호출은 네트워크에 따라 429가 잦아 폴백 필수.
// 키 주입: apps/bookshelf/.env.local (app-registry가 스폰 시 자동 주입).
function stripTags(s) {
  return String(s ?? "")
    .replace(/<\/?b>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function searchNaver(q, id, secret) {
  const res = await fetch(`https://openapi.naver.com/v1/search/book.json?query=${encodeURIComponent(q)}&display=20`, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`naver ${res.status}`);
  const body = await res.json();
  return (body.items ?? []).map((d) => {
    const isbn = stripTags(d.isbn).trim().split(" ").pop() || null;
    const pub = String(d.pubdate ?? "");
    return {
      sourceId: isbn || d.link,
      title: stripTags(d.title) || "(제목 없음)",
      authors: stripTags(d.author).split(/[|^]/).map((a) => a.trim()).filter(Boolean),
      publisher: stripTags(d.publisher),
      publishedDate: /^\d{8}$/.test(pub) ? `${pub.slice(0, 4)}-${pub.slice(4, 6)}-${pub.slice(6, 8)}` : pub,
      description: stripTags(d.description),
      categories: [],
      isbn,
      thumbnail: String(d.image ?? "").replace(/^http:/, "https:"),
      pageCount: null,
    };
  });
}
async function searchKakao(q, key) {
  const res = await fetch(`https://dapi.kakao.com/v3/search/book?query=${encodeURIComponent(q)}&size=20`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`kakao ${res.status}`);
  const body = await res.json();
  return (body.documents ?? []).map((d) => ({
    sourceId: d.isbn?.split(" ").pop() || d.url,
    title: d.title ?? "(제목 없음)",
    authors: d.authors ?? [],
    publisher: d.publisher ?? "",
    publishedDate: (d.datetime ?? "").slice(0, 10),
    description: d.contents ?? "",
    categories: [],
    isbn: d.isbn?.split(" ").pop() ?? null,
    thumbnail: (d.thumbnail ?? "").replace(/^http:/, "https:"),
    pageCount: null,
  }));
}

async function searchGoogle(q) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`google books ${res.status}`);
  const body = await res.json();
  return (body.items ?? []).map((it) => {
    const v = it.volumeInfo ?? {};
    const isbn = (v.industryIdentifiers ?? []).find((x) => x.type === "ISBN_13")?.identifier
      ?? (v.industryIdentifiers ?? []).find((x) => x.type === "ISBN_10")?.identifier ?? null;
    return {
      sourceId: it.id,
      title: v.title ?? "(제목 없음)",
      authors: v.authors ?? [],
      publisher: v.publisher ?? "",
      publishedDate: v.publishedDate ?? "",
      description: v.description ?? "",
      categories: v.categories ?? [],
      isbn,
      thumbnail: (v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? "").replace(/^http:/, "https:"),
      pageCount: v.pageCount ?? null,
    };
  });
}

async function searchOpenLibrary(q) {
  const fields = "key,title,author_name,publisher,first_publish_year,isbn,cover_i,subject,number_of_pages_median";
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=20&fields=${fields}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`openlibrary ${res.status}`);
  const body = await res.json();
  return (body.docs ?? []).map((d) => ({
    sourceId: d.key,
    title: d.title ?? "(제목 없음)",
    authors: d.author_name ?? [],
    publisher: (d.publisher ?? [])[0] ?? "",
    publishedDate: d.first_publish_year ? String(d.first_publish_year) : "",
    description: "",
    categories: (d.subject ?? []).slice(0, 5),
    isbn: (d.isbn ?? [])[0] ?? null,
    thumbnail: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "",
    pageCount: d.number_of_pages_median ?? null,
  }));
}

async function searchBooks(q) {
  const providers = [];
  if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
    providers.push(() => searchNaver(q, process.env.NAVER_CLIENT_ID, process.env.NAVER_CLIENT_SECRET));
  }
  if (process.env.KAKAO_REST_KEY) providers.push(() => searchKakao(q, process.env.KAKAO_REST_KEY));
  providers.push(() => searchGoogle(q), () => searchOpenLibrary(q));
  let lastErr;
  for (const p of providers) {
    try {
      const items = await p();
      if (items.length > 0) return items;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

// ── ISBN → 서지 정보 (키 불필요: Google Books → Open Library 폴백) ────────
// 바코드 스캔·비전 추출 ISBN의 폼 프리필/보강용. 서버 경유로 CORS 회피.
// Google 무키 호출은 429가 잦아(위 검색 체인 주석 참조) Open Library 폴백 필수.
async function lookupIsbnGoogle(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`google books ${res.status}`);
  const body = await res.json();
  const v = body.items?.[0]?.volumeInfo;
  if (!v?.title) return null;
  return {
    title: String(v.title).slice(0, 300),
    author: (v.authors ?? []).join(", ").slice(0, 200),
    publisher: String(v.publisher ?? "").slice(0, 120),
    isbn,
  };
}
async function lookupIsbnOpenLibrary(isbn) {
  const url = `https://openlibrary.org/search.json?q=isbn:${encodeURIComponent(isbn)}&fields=title,author_name,publisher&limit=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`openlibrary ${res.status}`);
  const body = await res.json();
  const d = body.docs?.[0];
  if (!d?.title) return null;
  return {
    title: String(d.title).slice(0, 300),
    author: (d.author_name ?? []).join(", ").slice(0, 200),
    publisher: String((d.publisher ?? [])[0] ?? "").slice(0, 120),
    isbn,
  };
}
async function lookupIsbn(isbn) {
  // 검색 체인과 동일 순서: 키 있으면 네이버(한국서 최적)·카카오 우선, 무키 폴백은 Google → Open Library
  // 텍스트 검색 API라 ISBN 정확 일치만 인정 — 무관한 책 오매칭 프리필 방지
  const fromSearch = (items) => {
    const d = items.find((x) => x.isbn === isbn);
    if (!d?.title) return null;
    return {
      title: d.title.slice(0, 300),
      author: (d.authors ?? []).join(", ").slice(0, 200),
      publisher: String(d.publisher ?? "").slice(0, 120),
      isbn,
    };
  };
  const providers = [];
  if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
    providers.push(async () => fromSearch(await searchNaver(isbn, process.env.NAVER_CLIENT_ID, process.env.NAVER_CLIENT_SECRET)));
  }
  if (process.env.KAKAO_REST_KEY) {
    providers.push(async () => fromSearch(await searchKakao(isbn, process.env.KAKAO_REST_KEY)));
  }
  providers.push(() => lookupIsbnGoogle(isbn), () => lookupIsbnOpenLibrary(isbn));
  let lastErr;
  for (const p of providers) {
    try {
      const item = await p();
      if (item) return item;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ── AI: Claude CLI (비전 표지 인식 + 다음 책 추천) ─────────────────────────
// 비전 호출 방식은 src/server/businesscard-vision.ts(-p 프롬프트 + -f 이미지 파일),
// AI 호출은 공용 @mycrew/ai-client(runClaude)로 실행 — sonnet 고정 + usage/cost 자동 집계.
// JSON 추출(extractJson)도 공용 패키지에서 import.
const AI_TIMEOUT_MS = 60_000;

// Claude CLI 실패를 사용자용 메시지 + HTTP 상태로 분류.
// - 사용량 한도/서버 혼잡 = 일시적(429), 그 외 = 502.
// err.message에는 전체 프롬프트가 붙어 나오므로(로그 노출 방지) stdout/stderr에서 원인만 추출한다.
function classifyClaudeError(err) {
  if (err?.killed || err?.code === "ETIMEDOUT") {
    return { status: 504, message: `AI 응답이 ${AI_TIMEOUT_MS / 1000}초 내에 오지 않았습니다. 잠시 후 다시 시도해주세요.` };
  }
  const out = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}\n${err?.message ?? ""}`;
  // 사용량 한도 — 리셋 시각이 있으면 함께 안내.
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
  return { status: 502, message: "AI 추천을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." };
}

// 표지 이미지(base64) → { title, author, publisher?, isbn? }
async function scanCover(imageBase64, mime) {
  const ext = /png/i.test(mime ?? "") ? "png" : "jpg";
  const tempPath = join(tmpdir(), `bookshelf-cover-${Date.now()}.${ext}`);
  await writeFile(tempPath, Buffer.from(imageBase64, "base64"));
  try {
    // 현재 설치된 claude CLI는 -f(이미지 첨부) 미지원 → 프롬프트에 파일 경로를 넣어
    // 내장 Read 도구(비전)로 이미지를 읽게 한다 (-p 모드에서 Read는 기본 허용).
    const prompt = `${tempPath} 경로의 책 표지 이미지를 읽고 서지 정보를 JSON 형식으로 추출하세요.

응답 형식:
{
  "title": "책 제목",
  "author": "저자명 (여러 명이면 쉼표로 구분)",
  "publisher": "출판사",
  "isbn": "ISBN (표지에 보이는 경우만)"
}

없는 필드는 생략하세요. JSON만 출력하세요.`;
    const out = await runClaude(prompt, { timeoutMs: AI_TIMEOUT_MS, model: "claude-sonnet-4-6", appId: "bookshelf" });
    const parsed = extractJson(out);
    if (!parsed?.title) return null;
    return {
      title: String(parsed.title).slice(0, 300),
      author: parsed.author ? String(parsed.author).slice(0, 200) : "",
      publisher: parsed.publisher ? String(parsed.publisher).slice(0, 120) : "",
      isbn: parsed.isbn ? String(parsed.isbn).replace(/[^0-9Xx-]/g, "").slice(0, 20) : "",
    };
  } finally {
    try { await unlink(tempPath); } catch { /* */ }
  }
}

// 읽은 책 목록 → 다음 읽을 책 3권 추천 [{ title, author, reason }]
const REC_LANG = { ko: "한국어", en: "English", ja: "日本語" };
async function recommendNext(lang) {
  const read = books.filter((b) => b.status === "done");
  const basis = (read.length > 0 ? read : books).slice(0, 30).map((b) => ({
    title: b.title,
    authors: b.authors,
    rating: b.rating,
    memo: (b.memo || "").slice(0, 200),
  }));
  const owned = books.map((b) => b.title).slice(0, 100);
  const prompt = `당신은 도서 추천 전문가입니다. 아래는 사용자의 독서 기록입니다 (제목/저자/별점 0~5/메모).

${JSON.stringify(basis, null, 2)}

이 취향을 바탕으로 다음에 읽을 책 5권을 추천하세요.
- 이미 책장에 있는 책은 제외: ${JSON.stringify(owned)}
- 실존하는 책만 추천하세요.
- reason은 ${REC_LANG[lang] ?? REC_LANG.ko}로 1~2문장.

응답 형식 (JSON만 출력):
[
  { "title": "책 제목", "author": "저자", "reason": "추천 이유" }
]`;
  const out = await runClaude(prompt, { timeoutMs: AI_TIMEOUT_MS, model: "claude-sonnet-4-6", appId: "bookshelf" });
  const parsed = extractJson(out);
  if (!Array.isArray(parsed)) return null;
  const recs = parsed
    .filter((r) => r && r.title)
    .slice(0, 5)
    .map((r) => ({
      title: String(r.title).slice(0, 300),
      author: String(r.author ?? "").slice(0, 200),
      reason: String(r.reason ?? "").slice(0, 500),
    }));
  // 표지 썸네일 보강 — searchBooks(네이버 우선→구글 폴백).
  // (1) 5개를 병렬(Promise.all)로 치면 네이버 순간 호출 한도에 걸려 빈 결과가 잦으므로 순차 호출.
  // (2) LLM 제목은 "한글 (English 부제)" 형태라 그대로 검색하면 네이버 매칭률이 낮음 → 끝의 (부제) 제거.
  // (3) 제목만으로 0건이면 저자를 붙여 재시도. 최종 실패는 빈 썸네일(프론트 📖 폴백).
  for (const r of recs) {
    try {
      const q = r.title.replace(/\s*\([^)]*\)\s*$/, "").trim() || r.title;
      let hits = await searchBooks(q);
      if (!hits.length && r.author) hits = await searchBooks(`${q} ${r.author}`.trim());
      r.thumbnail = (hits[0]?.thumbnail ?? "").slice(0, 500);
    } catch {
      r.thumbnail = "";
    }
  }
  return recs;
}

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

const VALID_STATUS = new Set(["todo", "reading", "done"]);

async function handleApi(req, res, p, query) {
  if (p === "/api/health") return json(res, 200, { ok: true, app: "bookshelf" });

  if (p === "/api/search" && req.method === "GET") {
    const q = (query.get("q") ?? "").trim();
    if (!q) return json(res, 400, { error: "q required" });
    try {
      return json(res, 200, { items: await searchBooks(q) });
    } catch (e) {
      return json(res, 502, { error: `검색 실패: ${e.message}` });
    }
  }

  // AI: 표지 이미지 → 서지 정보 추출 (base64, 최대 10MB)
  if (p === "/api/ai/scan-cover" && req.method === "POST") {
    const b = await readBody(req, 10_000_000);
    let image = String(b.image ?? "");
    let mime = String(b.mime ?? "image/jpeg");
    const dataUrl = image.match(/^data:(image\/[\w.+-]+);base64,(.*)$/s);
    if (dataUrl) { mime = dataUrl[1]; image = dataUrl[2]; }
    if (!image) return json(res, 400, { error: "image (base64) required" });
    try {
      const item = await scanCover(image, mime);
      if (!item) return json(res, 422, { error: "표지에서 정보를 추출하지 못했습니다" });
      return json(res, 200, { item });
    } catch (e) {
      const { status, message } = classifyClaudeError(e);
      return json(res, status, { error: `표지 인식 실패 — ${message}` });
    }
  }

  // ISBN → 서지 정보 조회 (Google Books) — 실패/0건은 404 JSON
  if (p === "/api/ai/lookup-isbn" && req.method === "GET") {
    const isbn = (query.get("isbn") ?? "").replace(/[^0-9Xx]/g, "");
    if (!/^(\d{9}[\dXx]|\d{13})$/.test(isbn)) return json(res, 400, { error: "isbn (10 or 13 digits) required" });
    try {
      const item = await lookupIsbn(isbn);
      if (!item) return json(res, 404, { error: "책 정보를 찾지 못했습니다" });
      return json(res, 200, { item });
    } catch (e) {
      return json(res, 404, { error: `ISBN 조회 실패: ${e.message}` });
    }
  }

  // AI: 다음 읽을 책 최대 5권 추천 (표지 썸네일 보강 포함)
  if (p === "/api/ai/recommend" && req.method === "GET") {
    if (books.length === 0) return json(res, 400, { error: "no books on shelf" });
    const lang = query.get("lang") ?? "ko";
    try {
      const items = await recommendNext(lang);
      if (!items || items.length === 0) return json(res, 502, { error: "추천 결과를 생성하지 못했습니다. 잠시 후 다시 시도해주세요." });
      return json(res, 200, { items });
    } catch (e) {
      const { status, message } = classifyClaudeError(e);
      return json(res, status, { error: message });
    }
  }

  if (p === "/api/books" && req.method === "GET") {
    return json(res, 200, { items: books });
  }

  if (p === "/api/books" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.title) return json(res, 400, { error: "title required" });
    // 중복 방지: 같은 sourceId 또는 ISBN이면 기존 항목 반환
    const dup = books.find(
      (x) => (b.sourceId && x.sourceId === b.sourceId) || (b.isbn && x.isbn === b.isbn),
    );
    if (dup) return json(res, 200, { item: dup, duplicated: true });
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      sourceId: b.sourceId ?? null,
      title: String(b.title).slice(0, 300),
      authors: Array.isArray(b.authors) ? b.authors.slice(0, 10) : [],
      publisher: String(b.publisher ?? "").slice(0, 120),
      publishedDate: String(b.publishedDate ?? "").slice(0, 20),
      description: String(b.description ?? "").slice(0, 5000),
      categories: Array.isArray(b.categories) ? b.categories.slice(0, 10) : [],
      isbn: b.isbn ?? null,
      thumbnail: String(b.thumbnail ?? "").slice(0, 500),
      pageCount: typeof b.pageCount === "number" ? b.pageCount : null,
      status: VALID_STATUS.has(b.status) ? b.status : "todo",
      liked: Boolean(b.liked),
      rating: 0,
      memo: "",
      addedAt: now,
      updatedAt: now,
      // 캘린더용 이벤트 이력 — 추가·상태 변경 시각
      events: [{ type: "added", at: now }],
    };
    books.unshift(item);
    await saveBooks();
    return json(res, 201, { item });
  }

  const m = p.match(/^\/api\/books\/([0-9a-f-]{36})$/);
  if (m) {
    const idx = books.findIndex((x) => x.id === m[1]);
    if (idx === -1) return json(res, 404, { error: "not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      const cur = books[idx];
      if (b.status !== undefined && VALID_STATUS.has(b.status) && b.status !== cur.status) {
        cur.status = b.status;
        // 상태 실변경만 이벤트 기록 (같은 상태 재클릭·메모/별점 수정은 제외), 최대 50건
        if (!Array.isArray(cur.events)) cur.events = [{ type: "added", at: cur.addedAt }];
        cur.events.push({ type: "status", status: b.status, at: new Date().toISOString() });
        if (cur.events.length > 50) cur.events = cur.events.slice(-50);
      }
      if (b.liked !== undefined) cur.liked = Boolean(b.liked);
      if (b.rating !== undefined) cur.rating = Math.max(0, Math.min(5, Number(b.rating) || 0));
      if (b.memo !== undefined) cur.memo = String(b.memo).slice(0, 3000);
      cur.updatedAt = new Date().toISOString();
      await saveBooks();
      return json(res, 200, { item: cur });
    }
    if (req.method === "DELETE") {
      const [removed] = books.splice(idx, 1);
      await saveBooks();
      return json(res, 200, { item: removed });
    }
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

await loadBooks();
server.listen(PORT, "127.0.0.1", () => console.log(`bookshelf on http://127.0.0.1:${PORT} prefix=${PREFIX} dist=${DIST} books=${books.length}`));

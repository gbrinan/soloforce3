// 내 일기(diary) 서버 — base prefix(/api/apps/diary/proxy) SPA 서빙
// + 일기 CRUD(data/diary.json) + AI 감정 분석/글감/데일리 회고 + 인앱 스케줄러(KST).
// 모든 데이터는 로컬 data/*.json에만 저장 (외부 전송 없음 — 프라이버시 우선).
import http from "node:http";
import { readFile, stat, mkdir, writeFile, rename, readdir } from "node:fs/promises";
import { join, extname, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runClaude, extractJson } from "@mycrew/ai-client/node";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const DATA_DIR = join(ROOT, "data");
const DIARY_FILE = join(DATA_DIR, "diary.json");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const PROMPTS_FILE = join(DATA_DIR, "prompts.json");
const RETROS_FILE = join(DATA_DIR, "retros.json");
const PREFIX = "/api/apps/diary/proxy";
// 기본 13246 (manifest.ports.http) — PORT env로 오버라이드 가능 (프리뷰·테스트용)
const PORT = Number(process.env.PORT) || 13246;

// 크로스앱 데이터 소스 (데일리 회고용, 읽기 전용 — 없으면 조용히 생략)
const MYCREW_ROOT = resolve(ROOT, "..", "..");
const TODOS_FILE = join(MYCREW_ROOT, "history", "genie-todos.json");
const MEETINGS_DIR = join(MYCREW_ROOT, "history", "outputs", "meetings");
const LEDGER_FILE = join(MYCREW_ROOT, "apps", "ledger", "data", "ledger.json");
const BOOKS_FILE = join(MYCREW_ROOT, "apps", "bookshelf", "data", "books.json");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// ── 저장소: data/*.json (atomic write: tmp → rename) ─────────────────────
async function loadJson(file, fallback) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8"));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
async function saveJson(file, value) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await rename(tmp, file);
}

/** @type {Array<{id:string,date:string,content:string,mood:string,template?:string,sections?:object|null,aiReflection:object|null,createdAt:string,updatedAt:string}>} */
let entries = [];
/** @type {Array<{id:string,date:string,prompt:string,createdAt:string}>} */
let prompts = [];
/** @type {Array<{id:string,date:string,markdown:string,sources:object,createdAt:string}>} */
let retros = [];

const VALID_TEMPLATES = new Set(["basic", "quad", "kpt", "3l"]);
const DEFAULT_QUAD_TITLES = ["오전", "오후", "저녁", "감사한 일"];
const DEFAULT_SETTINGS = {
  dailyTime: "21:00",
  autoGenerate: true,
  template: "basic",
  quadTitles: DEFAULT_QUAD_TITLES,
  // 스케줄러 중복 실행 방지 상태 (같은 날짜 슬롯 재생성 금지)
  lastDailyDate: "",
};
let settings = { ...DEFAULT_SETTINGS };

function sanitizeQuadTitles(v) {
  const arr = Array.isArray(v) ? v : [];
  return DEFAULT_QUAD_TITLES.map((def, i) => {
    const s = String(arr[i] ?? "").trim().slice(0, 30);
    return s || def;
  });
}
// 저장된 설정 → 알려진 필드만 방어적으로 채택 (구버전 weekly* 필드는 버린다)
function sanitizeSettings(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  return {
    dailyTime: TIME_RE.test(String(s.dailyTime ?? "")) ? String(s.dailyTime) : DEFAULT_SETTINGS.dailyTime,
    autoGenerate: s.autoGenerate === undefined ? true : Boolean(s.autoGenerate),
    template: VALID_TEMPLATES.has(s.template) ? s.template : "basic",
    quadTitles: sanitizeQuadTitles(s.quadTitles),
    lastDailyDate: typeof s.lastDailyDate === "string" ? s.lastDailyDate : "",
  };
}
// 섹션 본문 방어적 정제 — 객체 아니면 null, 키 8개·본문 10k자 제한
function sanitizeSections(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const [k, val] of Object.entries(v).slice(0, 8)) {
    out[String(k).slice(0, 24)] = String(val ?? "").slice(0, 10_000);
  }
  return Object.keys(out).length ? out : null;
}

async function loadAll() {
  entries = await loadJson(DIARY_FILE, []);
  if (!Array.isArray(entries)) entries = [];
  prompts = await loadJson(PROMPTS_FILE, []);
  if (!Array.isArray(prompts)) prompts = [];
  retros = await loadJson(RETROS_FILE, []);
  if (!Array.isArray(retros)) retros = [];
  // 방어적 마이그레이션: 구 주간 회고(weekStart)는 date로 승격, date 없는 항목은 제외
  retros = retros
    .map((r) => ({ ...r, date: r?.date ?? r?.weekStart ?? "" }))
    .filter((r) => r.date && r.markdown);
  settings = sanitizeSettings(await loadJson(SETTINGS_FILE, {}));
}
const saveEntries = () => saveJson(DIARY_FILE, entries);
const savePrompts = () => saveJson(PROMPTS_FILE, prompts);
const saveRetros = () => saveJson(RETROS_FILE, retros);
const saveSettings = () => saveJson(SETTINGS_FILE, settings);

// ── KST(Asia/Seoul) 시간 헬퍼 ────────────────────────────────────────────
function kstNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${hour}:${get("minute")}`,
  };
}
/** 하루 범위 (데일리 회고 수집용 — inRange 재사용) */
const dayRange = (date) => ({ start: date, end: date });
/** ISO 시각 문자열 → KST 날짜(YYYY-MM-DD). 파싱 실패 시 null */
function isoToKstDate(iso) {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(t));
  const get = (x) => parts.find((p) => p.type === x)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const inRange = (date, range) => Boolean(date) && date >= range.start && date <= range.end;

// ── AI 호출 공통 ──────────────────────────────────────────────────────────
const AI_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = "claude-sonnet-4-6";

// Claude CLI 실패 → 사용자 메시지 + HTTP 상태 분류 (bookshelf 컨벤션)
function classifyClaudeError(err) {
  if (err?.killed || err?.code === "ETIMEDOUT") {
    return { status: 504, message: `AI 응답이 ${AI_TIMEOUT_MS / 1000}초 내에 오지 않았습니다. 잠시 후 다시 시도해주세요.` };
  }
  const out = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}\n${err?.message ?? ""}`;
  if (/hit your limit|usage limit|out of (?:usage|credit)|한도/i.test(out)) {
    return { status: 429, message: "AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도해주세요." };
  }
  if (/overloaded|rate.?limit|\b429\b|\b529\b|too many requests/i.test(out)) {
    return { status: 429, message: "AI 서버가 혼잡합니다. 잠시 후 다시 시도해주세요." };
  }
  return { status: 502, message: "AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." };
}

// ── 호스트 알림 (실패해도 앱 동작에 영향 없음) ────────────────────────────
async function notifyHost(title, body, route = "/") {
  try {
    const base = process.env.MYCREW_API_URL || "http://127.0.0.1:3456";
    const res = await fetch(`${base}/api/notifications/app-inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.MYCREW_AI_GATEWAY_TOKEN ?? ""}`,
      },
      body: JSON.stringify({ appId: "diary", title, body, route }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.warn(`[diary] notify failed: HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[diary] notify failed: ${e?.message ?? e}`);
  }
}

// ── AI 기능 1: 감정 분석 + 성찰 질문 ─────────────────────────────────────
async function generateReflection(entry, model) {
  const prompt = `당신은 따뜻하고 통찰력 있는 저널링 코치입니다. 아래는 사용자가 ${entry.date}에 쓴 일기입니다.
${entry.mood ? `사용자가 선택한 오늘의 무드: ${entry.mood}` : ""}

--- 일기 시작 ---
${String(entry.content).slice(0, 6000)}
--- 일기 끝 ---

이 일기를 분석해 아래 JSON만 출력하세요 (다른 텍스트 금지):
{
  "emotions": [ { "label": "감정 이름 (한국어, 예: 뿌듯함)", "intensity": 1~5 정수 } ],
  "comment": "공감 코멘트 2~3문장 (한국어, 판단하지 않고 따뜻하게)",
  "questions": [ "성찰을 돕는 열린 질문 (한국어)" ]
}

규칙:
- emotions는 2~4개, intensity는 1(약함)~5(강함) 정수.
- questions는 2~3개, 일기 내용에 구체적으로 연결된 질문.`;
  const out = await runClaude(prompt, {
    timeoutMs: AI_TIMEOUT_MS,
    model: model || DEFAULT_MODEL,
    appId: "diary",
    feature: "reflect",
  });
  const parsed = extractJson(out);
  if (!parsed || !Array.isArray(parsed.emotions) || !parsed.comment) return null;
  return {
    emotions: parsed.emotions
      .filter((e) => e && e.label)
      .slice(0, 4)
      .map((e) => ({
        label: String(e.label).slice(0, 40),
        intensity: Math.max(1, Math.min(5, Math.round(Number(e.intensity) || 3))),
      })),
    comment: String(parsed.comment).slice(0, 1000),
    questions: (Array.isArray(parsed.questions) ? parsed.questions : [])
      .filter(Boolean)
      .slice(0, 3)
      .map((q) => String(q).slice(0, 300)),
    createdAt: new Date().toISOString(),
  };
}

// ── AI 기능 2: 오늘의 글감 ────────────────────────────────────────────────
async function generateWritingPrompt(date, model) {
  const recent = entries
    .filter((e) => e.date < date)
    .slice(0, 5)
    .map((e) => `- ${e.date}${e.mood ? ` (${e.mood})` : ""}: ${String(e.content).slice(0, 120)}`);
  const prompt = `당신은 저널링 코치입니다. 사용자가 오늘(${date}) 아직 일기를 쓰지 않았습니다.
${recent.length ? `최근 일기 요약:\n${recent.join("\n")}` : "최근 일기 기록이 없습니다."}

오늘 일기를 시작할 수 있는 글감(writing prompt)을 하나 제안하세요.
- 한국어 1~2문장, 구체적이고 부담 없는 질문/제안.
- 최근 일기와 겹치지 않는 새로운 주제.

JSON만 출력: { "prompt": "글감 문장" }`;
  const out = await runClaude(prompt, {
    timeoutMs: AI_TIMEOUT_MS,
    model: model || DEFAULT_MODEL,
    appId: "diary",
    feature: "writing-prompt",
  });
  const parsed = extractJson(out);
  if (!parsed?.prompt) return null;
  return String(parsed.prompt).slice(0, 500);
}

// ── AI 기능 3: 데일리 회고 (크로스앱 데이터 수집) ────────────────────────
// 각 소스는 파일이 없거나 파싱 실패 시 조용히 생략한다.
async function collectDayData(date) {
  const range = dayRange(date);
  const sources = {};

  // 1) 일기 (오늘)
  const dayEntries = entries.filter((e) => inRange(e.date, range));
  sources.diary = dayEntries
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      date: e.date,
      mood: e.mood || null,
      excerpt: String(e.content).slice(0, 1500),
      emotions: e.aiReflection?.emotions?.map((x) => x.label) ?? [],
    }));

  // 2) 할일 (history/genie-todos.json — done 상태, 오늘 완료분)
  try {
    const todos = JSON.parse(await readFile(TODOS_FILE, "utf-8"));
    if (Array.isArray(todos)) {
      const done = todos.filter((t) => {
        if (t?.status !== "done" && t?.state !== "done") return false;
        const doneAt = t.reportedAt
          ?? (Array.isArray(t.stateHistory) ? t.stateHistory.find((h) => h.state === "done")?.at : null)
          ?? t.createdAt;
        return inRange(isoToKstDate(doneAt), range);
      });
      if (done.length) {
        sources.todos = done.slice(0, 30).map((t) => String(t.instruction ?? "").slice(0, 150));
      }
    }
  } catch { /* 조용히 생략 */ }

  // 3) 회의 (history/outputs/meetings/*.meta.json — 오늘분)
  try {
    const files = (await readdir(MEETINGS_DIR)).filter((f) => f.endsWith(".meta.json"));
    const metas = [];
    for (const f of files.slice(0, 200)) {
      try {
        const m = JSON.parse(await readFile(join(MEETINGS_DIR, f), "utf-8"));
        if (inRange(isoToKstDate(m?.createdAt), range)) {
          metas.push({
            title: String(m.title ?? "회의").slice(0, 150),
            date: isoToKstDate(m.createdAt),
            durationMin: m.durationSec ? Math.round(m.durationSec / 60) : null,
          });
        }
      } catch { /* 개별 파일 파싱 실패 생략 */ }
    }
    if (metas.length) sources.meetings = metas;
  } catch { /* 조용히 생략 */ }

  // 4) 재무 (apps/ledger/data/ledger.json — 오늘 지출 합계·상위 카테고리)
  try {
    const ledger = JSON.parse(await readFile(LEDGER_FILE, "utf-8"));
    const catName = new Map((ledger?.categories ?? []).map((c) => [c.id, c?.name?.ko ?? c.id]));
    const dayTx = (ledger?.transactions ?? []).filter(
      (t) => t?.type === "expense" && inRange(String(t.date ?? ""), range),
    );
    if (dayTx.length) {
      const total = dayTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const byCat = new Map();
      for (const t of dayTx) {
        const key = catName.get(t.categoryId) ?? t.categoryId ?? "기타";
        byCat.set(key, (byCat.get(key) ?? 0) + (Number(t.amount) || 0));
      }
      const top = [...byCat.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, amount]) => ({ category: name, amount }));
      sources.finance = { totalExpense: total, count: dayTx.length, topCategories: top };
    }
  } catch { /* 조용히 생략 */ }

  // 5) 독서 (apps/bookshelf/data/books.json — 오늘 events)
  try {
    const books = JSON.parse(await readFile(BOOKS_FILE, "utf-8"));
    if (Array.isArray(books)) {
      const evs = [];
      for (const b of books) {
        for (const ev of Array.isArray(b.events) ? b.events : []) {
          const d = isoToKstDate(ev?.at);
          if (inRange(d, range)) {
            evs.push({
              title: String(b.title ?? "").slice(0, 100),
              event: ev.type === "status" ? String(ev.status ?? "") : "added",
              date: d,
            });
          }
        }
      }
      if (evs.length) sources.reading = evs.slice(0, 20);
    }
  } catch { /* 조용히 생략 */ }

  return sources;
}

async function generateDailyRetro(date, model) {
  const sources = await collectDayData(date);
  const prompt = `당신은 사려 깊은 데일리 회고 작성자입니다. 아래는 사용자의 오늘(${date}) 기록 데이터입니다.

${JSON.stringify(sources, null, 2)}

이 데이터를 바탕으로 짧은 데일리 회고를 마크다운으로 작성하세요.

규칙:
- 한국어, 따뜻하고 담백한 1인칭 회고 톤.
- 구조: "# 오늘의 회고 (${date})" 제목 → "## 하루 요약" → "## 오늘의 의미" (있었던 일에 짧게 의미 부여) → "## 내일을 위한 한마디" (1~2문장).
- 데이터가 없는 항목은 언급·생략하고 지어내지 말 것. 기록이 적으면 그만큼 짧게.
- 금액은 천 단위 콤마 + "원" 표기.
- 전체 200~450자 내외, 마크다운만 출력 (코드펜스 금지).`;
  const out = await runClaude(prompt, {
    timeoutMs: AI_TIMEOUT_MS,
    model: model || DEFAULT_MODEL,
    appId: "diary",
    feature: "daily-retro",
  });
  const markdown = String(out ?? "").trim().replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
  if (!markdown) return null;
  const item = {
    id: randomUUID(),
    date,
    markdown: markdown.slice(0, 20_000),
    sources: {
      diary: sources.diary?.length ?? 0,
      todos: sources.todos?.length ?? 0,
      meetings: sources.meetings?.length ?? 0,
      finance: sources.finance ? sources.finance.count : 0,
      reading: sources.reading?.length ?? 0,
    },
    createdAt: new Date().toISOString(),
  };
  // 같은 날짜 회고는 최신본으로 교체 (날짜당 1건)
  retros = retros.filter((r) => r.date !== item.date);
  retros.unshift(item);
  if (retros.length > 400) retros = retros.slice(0, 400);
  await saveRetros();
  return item;
}

// ── 인앱 스케줄러 (60초 tick, KST 기준) ──────────────────────────────────
let schedulerBusy = false;
async function schedulerTick() {
  if (schedulerBusy || !settings.autoGenerate) return;
  schedulerBusy = true;
  try {
    const now = kstNow();

    // 매일 dailyTime: 데일리 회고 자동 생성 (+ 오늘 일기가 없으면 글감 생성 — 기존 유지)
    if (now.hhmm >= settings.dailyTime && settings.lastDailyDate !== now.date) {
      settings.lastDailyDate = now.date; // 실패해도 같은 날짜 슬롯 무한 재시도 금지 (다음 날 재개)
      await saveSettings();

      // (a) 오늘의 글감 — 오늘 일기가 없을 때만
      try {
        if (!entries.find((e) => e.date === now.date)) {
          const text = await generateWritingPrompt(now.date);
          if (text) {
            prompts = prompts.filter((p) => p.date !== now.date);
            prompts.unshift({ id: randomUUID(), date: now.date, prompt: text, createdAt: new Date().toISOString() });
            if (prompts.length > 60) prompts = prompts.slice(0, 60);
            await savePrompts();
            await notifyHost("📔 오늘의 글감", text.slice(0, 120));
          }
        }
      } catch (e) {
        console.warn(`[diary] daily prompt failed: ${e?.message ?? e}`);
      }

      // (b) 데일리 회고 — 오늘 하루 기록(일기·할일·회의·지출·독서)으로 작성, 날짜당 1건
      try {
        const item = await generateDailyRetro(now.date);
        if (item) {
          await notifyHost("📔 오늘의 회고가 도착했어요", `${item.date} 하루의 기록을 모아 회고를 작성했어요.`);
        }
      } catch (e) {
        console.warn(`[diary] daily retro failed: ${e?.message ?? e}`);
      }
    }
  } finally {
    schedulerBusy = false;
  }
}

// ── HTTP 유틸 ─────────────────────────────────────────────────────────────
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 1_000_000) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (d) => {
      size += d.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(d);
    });
    req.on("end", () => {
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── API 라우팅 ────────────────────────────────────────────────────────────
async function handleApi(req, res, p, query) {
  if (p === "/api/health") return json(res, 200, { ok: true, app: "diary" });

  // 일기 목록 (날짜 내림차순)
  if (p === "/api/entries" && req.method === "GET") {
    const items = entries.slice().sort((a, b) => b.date.localeCompare(a.date));
    return json(res, 200, { items });
  }

  // 일기 생성 — 하루 1편 (같은 날짜 존재 시 409)
  if (p === "/api/entries" && req.method === "POST") {
    const b = await readBody(req);
    const date = String(b.date ?? "");
    if (!DATE_RE.test(date)) return json(res, 400, { error: "date (YYYY-MM-DD) required" });
    if (!b.content || !String(b.content).trim()) return json(res, 400, { error: "content required" });
    const dup = entries.find((e) => e.date === date);
    if (dup) return json(res, 409, { error: "이 날짜에는 이미 일기가 있습니다", item: dup });
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      date,
      content: String(b.content).slice(0, 20_000),
      mood: String(b.mood ?? "").slice(0, 16),
      template: VALID_TEMPLATES.has(b.template) ? b.template : "basic",
      sections: sanitizeSections(b.sections),
      aiReflection: null,
      createdAt: now,
      updatedAt: now,
    };
    entries.unshift(item);
    await saveEntries();
    return json(res, 201, { item });
  }

  const m = p.match(/^\/api\/entries\/([0-9a-f-]{36})$/);
  if (m) {
    const idx = entries.findIndex((e) => e.id === m[1]);
    if (idx === -1) return json(res, 404, { error: "not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      const cur = entries[idx];
      if (b.content !== undefined) cur.content = String(b.content).slice(0, 20_000);
      if (b.mood !== undefined) cur.mood = String(b.mood ?? "").slice(0, 16);
      if (b.template !== undefined && VALID_TEMPLATES.has(b.template)) cur.template = b.template;
      if (b.sections !== undefined) cur.sections = sanitizeSections(b.sections);
      cur.updatedAt = new Date().toISOString();
      await saveEntries();
      return json(res, 200, { item: cur });
    }
    if (req.method === "DELETE") {
      const [removed] = entries.splice(idx, 1);
      await saveEntries();
      return json(res, 200, { item: removed });
    }
  }

  // AI: 감정 분석 + 성찰 질문 → 해당 entry에 저장
  if (p === "/api/ai/reflect" && req.method === "POST") {
    const b = await readBody(req);
    const entry = b.id
      ? entries.find((e) => e.id === b.id)
      : entries.find((e) => e.date === String(b.date ?? ""));
    if (!entry) return json(res, 404, { error: "일기를 찾을 수 없습니다" });
    try {
      const reflection = await generateReflection(entry, b.model ? String(b.model) : undefined);
      if (!reflection) return json(res, 502, { error: "AI 회고를 생성하지 못했습니다. 잠시 후 다시 시도해주세요." });
      entry.aiReflection = reflection;
      entry.updatedAt = new Date().toISOString();
      await saveEntries();
      return json(res, 200, { item: entry });
    } catch (e) {
      const { status, message } = classifyClaudeError(e);
      return json(res, status, { error: message });
    }
  }

  // AI: 오늘의 글감 수동 생성
  if (p === "/api/ai/prompt" && req.method === "POST") {
    const b = await readBody(req);
    const date = DATE_RE.test(String(b.date ?? "")) ? String(b.date) : kstNow().date;
    try {
      const text = await generateWritingPrompt(date, b.model ? String(b.model) : undefined);
      if (!text) return json(res, 502, { error: "글감을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." });
      prompts = prompts.filter((x) => x.date !== date);
      const item = { id: randomUUID(), date, prompt: text, createdAt: new Date().toISOString() };
      prompts.unshift(item);
      if (prompts.length > 60) prompts = prompts.slice(0, 60);
      await savePrompts();
      return json(res, 200, { item });
    } catch (e) {
      const { status, message } = classifyClaudeError(e);
      return json(res, status, { error: message });
    }
  }

  // 글감 조회 (?date= 미지정 시 오늘 KST)
  if (p === "/api/prompts" && req.method === "GET") {
    const date = query.get("date") ?? kstNow().date;
    return json(res, 200, { item: prompts.find((x) => x.date === date) ?? null });
  }

  // 데일리 회고 목록 (날짜 내림차순)
  if (p === "/api/retros" && req.method === "GET") {
    const items = retros.slice().sort((a, b) => b.date.localeCompare(a.date));
    return json(res, 200, { items });
  }

  // 수동 트리거: 즉시 데일리 회고 생성/재생성 (date 미지정 시 오늘 KST)
  if (p === "/api/retro/daily" && req.method === "POST") {
    const b = await readBody(req).catch(() => ({}));
    try {
      const date = DATE_RE.test(String(b.date ?? "")) ? String(b.date) : kstNow().date;
      const item = await generateDailyRetro(date, b.model ? String(b.model) : undefined);
      if (!item) return json(res, 502, { error: "데일리 회고를 생성하지 못했습니다. 잠시 후 다시 시도해주세요." });
      await notifyHost("📔 오늘의 회고가 도착했어요", `${item.date} 하루의 기록을 모아 회고를 작성했어요.`);
      return json(res, 200, { item });
    } catch (e) {
      const { status, message } = classifyClaudeError(e);
      return json(res, status, { error: message });
    }
  }

  // 설정 (스케줄러 내부 상태는 노출하되 수정은 화이트리스트 필드만)
  if (p === "/api/settings" && req.method === "GET") {
    return json(res, 200, { item: settings });
  }
  if (p === "/api/settings" && req.method === "PUT") {
    const b = await readBody(req);
    if (b.dailyTime !== undefined) {
      if (!TIME_RE.test(String(b.dailyTime))) return json(res, 400, { error: "dailyTime must be HH:MM" });
      settings.dailyTime = String(b.dailyTime);
    }
    if (b.template !== undefined) {
      if (!VALID_TEMPLATES.has(String(b.template))) return json(res, 400, { error: "template must be basic|quad|kpt|3l" });
      settings.template = String(b.template);
    }
    if (b.quadTitles !== undefined) {
      if (!Array.isArray(b.quadTitles)) return json(res, 400, { error: "quadTitles must be string[4]" });
      settings.quadTitles = sanitizeQuadTitles(b.quadTitles);
    }
    if (b.autoGenerate !== undefined) settings.autoGenerate = Boolean(b.autoGenerate);
    await saveSettings();
    return json(res, 200, { item: settings });
  }

  return json(res, 404, { error: "unknown api" });
}

// ── 서버 (SPA 서빙 + API) ─────────────────────────────────────────────────
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

await loadAll();
setInterval(() => { schedulerTick().catch((e) => console.warn(`[diary] tick error: ${e?.message ?? e}`)); }, 60_000);
server.listen(PORT, "127.0.0.1", () =>
  console.log(`diary on http://127.0.0.1:${PORT} prefix=${PREFIX} dist=${DIST} entries=${entries.length} retros=${retros.length}`),
);

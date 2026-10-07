// 가계부(ledger) 서버 — base prefix(/api/apps/ledger/proxy) SPA 서빙
// + 거래/자산/카테고리/예산/구독 CRUD(data/ledger.json) + 구독 결제일 자동 기입 + CSV 내보내기.
import http from "node:http";
import { readFile, stat, mkdir, writeFile, rename } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { runClaude, extractJson } from "@mycrew/ai-client/node";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const DATA_DIR = join(ROOT, "data");
const DB_FILE = join(DATA_DIR, "ledger.json");
const PREFIX = "/api/apps/ledger/proxy";
const PORT = Number(process.env.PORT) || 13245;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// ── 기본 카테고리 시드 (사용자 추가/삭제 가능, id 고정 문자열로 예산 키 안정성 확보) ──
const DEFAULT_CATEGORIES = [
  { id: "food", kind: "expense", emoji: "🍚", name: { ko: "식비", en: "Food", ja: "食費" } },
  { id: "cafe", kind: "expense", emoji: "☕", name: { ko: "카페·간식", en: "Cafe & Snacks", ja: "カフェ・間食" } },
  { id: "alcohol", kind: "expense", emoji: "🍻", name: { ko: "음주·유흥", en: "Alcohol & Nightlife", ja: "飲酒・娯楽" } },
  { id: "transport", kind: "expense", emoji: "🚌", name: { ko: "교통", en: "Transport", ja: "交通" } },
  { id: "shopping", kind: "expense", emoji: "🛍️", name: { ko: "쇼핑", en: "Shopping", ja: "買い物" } },
  { id: "housing", kind: "expense", emoji: "🏠", name: { ko: "주거·통신", en: "Housing & Telecom", ja: "住居・通信" } },
  { id: "health", kind: "expense", emoji: "💊", name: { ko: "의료·건강", en: "Health", ja: "医療・健康" } },
  { id: "leisure", kind: "expense", emoji: "🎬", name: { ko: "문화·여가", en: "Leisure", ja: "文化・余暇" } },
  { id: "subscription", kind: "expense", emoji: "🔁", name: { ko: "구독", en: "Subscriptions", ja: "サブスク" } },
  { id: "education", kind: "expense", emoji: "📚", name: { ko: "교육", en: "Education", ja: "教育" } },
  { id: "gift", kind: "expense", emoji: "🎁", name: { ko: "경조·선물", en: "Gifts & Events", ja: "冠婚葬祭・贈り物" } },
  { id: "utilities", kind: "expense", emoji: "🏛️", name: { ko: "공과금·세금", en: "Utilities & Tax", ja: "公共料金・税金" } },
  { id: "etc-expense", kind: "expense", emoji: "📎", name: { ko: "기타", en: "Others", ja: "その他" } },
  { id: "salary", kind: "income", emoji: "💼", name: { ko: "급여", en: "Salary", ja: "給与" } },
  { id: "allowance", kind: "income", emoji: "💵", name: { ko: "용돈", en: "Allowance", ja: "お小遣い" } },
  { id: "finance-income", kind: "income", emoji: "📈", name: { ko: "금융수입", en: "Financial Income", ja: "金融収入" } },
  { id: "etc-income", kind: "income", emoji: "➕", name: { ko: "기타수입", en: "Other Income", ja: "その他収入" } },
];

// ── 저장소: data/ledger.json (atomic write) ─────────────────────────────
let db = null;
async function loadDb() {
  try {
    db = JSON.parse(await readFile(DB_FILE, "utf-8"));
  } catch {
    db = null;
  }
  if (!db || typeof db !== "object") db = {};
  if (!Array.isArray(db.assets)) db.assets = [];
  if (!Array.isArray(db.categories) || db.categories.length === 0) db.categories = DEFAULT_CATEGORIES;
  // Migrate: insert missing categories in correct position
  if (!db.categories.find((c) => c.id === "utilities")) {
    const etcIdx = db.categories.findIndex((c) => c.id === "etc-expense");
    const newCat = { id: "utilities", kind: "expense", emoji: "🏛️", name: { ko: "공과금·세금", en: "Utilities & Tax", ja: "公共料金・税金" } };
    if (etcIdx >= 0) db.categories.splice(etcIdx, 0, newCat);
    else db.categories.push(newCat);
  }
  if (!Array.isArray(db.transactions)) db.transactions = [];
  if (!db.budgets || typeof db.budgets !== "object") db.budgets = {};
  if (!Array.isArray(db.subscriptions)) db.subscriptions = [];
  if (!Array.isArray(db.smsImported)) db.smsImported = []; // 처리(추가/무시)한 문자 guid
  if (!Array.isArray(db.holdings)) db.holdings = []; // 자산관리: 예금/적금/주식/ETF/코인/외환/금
  if (!Array.isArray(db.snapshots)) db.snapshots = []; // 일별 순자산 스냅샷 (추이 차트)
}
async function saveDb() {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), "utf-8");
  await rename(tmp, DB_FILE);
}

// ── 구독 결제일 자동 기입 ────────────────────────────────────────────────
// 활성 구독의 결제 도래분(startedAt 이후 ~ 오늘)을 거래로 생성한다.
// chargedPeriods("YYYY-MM" | "YYYY")로 중복 기입을 막고, 최초 적용 시점 이전
// 과거분을 소급 기입하지 않도록 등록/활성화 시점부터만 계산한다.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function clampDay(year, monthIdx, day) {
  const last = new Date(year, monthIdx + 1, 0).getDate();
  return Math.min(day, last);
}
function applyDueSubscriptions() {
  const today = todayStr();
  let changed = false;
  for (const sub of db.subscriptions) {
    if (!sub.active) continue;
    if (!Array.isArray(sub.chargedPeriods)) sub.chargedPeriods = [];
    const start = sub.startedAt?.slice(0, 10) || today;
    const [sy, sm] = [Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1];
    const now = new Date();
    if (sub.cycle === "monthly") {
      // 시작 월부터 이번 달까지 순회하며 결제일이 [start, today] 범위인 기간 기입
      for (let y = sy, m = sm; y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth()); m === 11 ? (y++, m = 0) : m++) {
        const period = `${y}-${String(m + 1).padStart(2, "0")}`;
        if (sub.chargedPeriods.includes(period)) continue;
        const day = clampDay(y, m, sub.billingDay || 1);
        const dateStr = `${period}-${String(day).padStart(2, "0")}`;
        if (dateStr < start || dateStr > today) continue;
        db.transactions.unshift({
          id: randomUUID(), type: "expense", amount: sub.amount,
          categoryId: sub.categoryId || "subscription", assetId: sub.assetId || null,
          toAssetId: null, memo: sub.name, date: dateStr,
          createdAt: new Date().toISOString(), subscriptionId: sub.id,
        });
        sub.chargedPeriods.push(period);
        changed = true;
      }
    } else {
      // yearly: billingMonth(1-12)/billingDay 기준 연 1회
      for (let y = sy; y <= now.getFullYear(); y++) {
        const period = String(y);
        if (sub.chargedPeriods.includes(period)) continue;
        const mIdx = (sub.billingMonth || 1) - 1;
        const day = clampDay(y, mIdx, sub.billingDay || 1);
        const dateStr = `${y}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (dateStr < start || dateStr > today) continue;
        db.transactions.unshift({
          id: randomUUID(), type: "expense", amount: sub.amount,
          categoryId: sub.categoryId || "subscription", assetId: sub.assetId || null,
          toAssetId: null, memo: sub.name, date: dateStr,
          createdAt: new Date().toISOString(), subscriptionId: sub.id,
        });
        sub.chargedPeriods.push(period);
        changed = true;
      }
    }
  }
  return changed;
}

let lastSubCheck = 0;
async function maybeApplySubscriptions() {
  if (Date.now() - lastSubCheck < 60 * 60 * 1000) return; // 1시간 스로틀
  lastSubCheck = Date.now();
  if (applyDueSubscriptions()) await saveDb();
}

// ── 외부 프로세스 실행 (claude CLI / sqlite3) ───────────────────────────
function runCmd(cmd, args, { input = null, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
    if (input !== null) child.stdin.write(input);
    child.stdin.end();
  });
}

// ── AI 자연어 파싱 (claude CLI, haiku — 로컬 인증 재사용) ────────────────
// 공용 @mycrew/ai-client(runClaude)로 실행 — 모델 고정(haiku) + usage/cost 자동 집계.
function extractJsonArray(text) {
  const s = text.indexOf("["), e = text.lastIndexOf("]");
  if (s === -1 || e === -1 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}
// claude -p 공용 실행 → result 텍스트 (haiku 고정, appId=ledger 비용 귀속)
async function runClaudeText(prompt, timeoutMs = 90_000) {
  return runClaude(prompt, { timeoutMs, model: "claude-haiku-4-5-20251001", appId: "ledger" });
}
async function aiParse(text) {
  const catList = db.categories.map((c) => `${c.id}(${c.name.ko},${c.kind})`).join(", ");
  const prompt = [
    "You convert free-form Korean/English/Japanese expense notes or Korean card-approval SMS into ledger transactions.",
    `Today is ${todayStr()}. Resolve relative dates (어제/그저께/yesterday/昨日 etc).`,
    `Categories: ${catList}`,
    'Output ONLY a JSON array (no prose, no fences). Each item: {"type":"expense"|"income","amount":<positive integer KRW>,"categoryId":"<id from list>","date":"YYYY-MM-DD","memo":"<short merchant/description>"}.',
    "9천원=9000, 1.5만원=15000, 만원=10000. If a currency amount is missing, skip that item. Cancelled/취소 SMS → skip.",
    "Input:",
    text.slice(0, 4000),
  ].join("\n");
  const result = await runClaudeText(prompt, 90_000);
  const arr = extractJsonArray(result);
  if (!arr) throw new Error("ai parse failed");
  return arr
    .filter((x) => x && (x.type === "expense" || x.type === "income"))
    .map((x) => ({
      type: x.type,
      amount: sanitizeAmount(x.amount) ?? 0,
      categoryId: db.categories.some((c) => c.id === x.categoryId) ? x.categoryId
        : x.type === "income" ? "etc-income" : "etc-expense",
      date: DATE_RE.test(String(x.date ?? "")) ? x.date : todayStr(),
      memo: String(x.memo ?? "").slice(0, 200),
    }))
    .filter((x) => x.amount > 0)
    .slice(0, 20);
}

// ── AI 거래 자동 분류: 메모·가맹점명·금액 → 기존 카테고리 id 태깅 ────────
async function aiCategorize({ memo, amount, kind }) {
  const k = kind === "income" ? "income" : "expense";
  const cats = db.categories.filter((c) => c.kind === k);
  const prompt = [
    "You tag a personal-ledger transaction with exactly one category id from the list.",
    `Categories (${k}): ${cats.map((c) => `${c.id}(${c.name.ko}/${c.name.en})`).join(", ")}`,
    `Transaction: memo="${String(memo).slice(0, 200)}", amount=${amount ?? "unknown"} KRW`,
    'Output ONLY JSON (no prose, no fences): {"categoryId":"<id from the list>"}',
  ].join("\n");
  const obj = extractJson(await runClaudeText(prompt, 60_000));
  const id = obj && typeof obj.categoryId === "string" ? obj.categoryId : null;
  if (!id || !cats.some((c) => c.id === id)) throw new Error("ai categorize failed");
  return id;
}

// ── AI 월간 지출 인사이트: 해당 월 + 직전 3개월 집계 → 자연어 3~5개 ──────
// 아침 브리핑 서버 등 외부에서도 GET으로 호출 — 결과는 (월, 언어)별 1시간 캐시.
const AI_LANGS = new Set(["ko", "en", "ja"]);
async function aiInsights(month, lang) {
  const cacheKey = `insights:${month}:${lang}`;
  const hit = cacheGet(cacheKey, 3600_000);
  if (hit) return hit;
  const [ty, tm] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
  const months = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(ty, tm - (3 - i), 1); // target-3 … target
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const catName = (id) => {
    const c = db.categories.find((x) => x.id === id);
    return c ? (c.name[lang] ?? c.name.ko) : "etc";
  };
  const summary = months.map((ym) => {
    const txs = db.transactions.filter((t) => ymOfStr(t.date) === ym);
    const byCategory = {};
    for (const t of txs) {
      if (t.type !== "expense") continue;
      const n = catName(t.categoryId ?? "etc-expense");
      byCategory[n] = (byCategory[n] ?? 0) + t.amount;
    }
    return {
      month: ym,
      income: txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0),
      expense: txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0),
      byCategory,
    };
  });
  const budgets = {};
  for (const [id, v] of Object.entries(db.budgets)) budgets[catName(id)] = v;
  const langName = { ko: "Korean", en: "English", ja: "Japanese" }[lang];
  const prompt = [
    "You are a personal finance analyst. Amounts are in KRW.",
    `Target month: ${month}. Earlier months are context for trend detection (e.g. "subscriptions rose 3 months in a row").`,
    `Monthly budgets by category: ${JSON.stringify(budgets)}`,
    `Monthly summary: ${JSON.stringify(summary)}`,
    `Write 3-5 short, specific insights about the target month in ${langName}. Mention concrete amounts or percentages where useful. Skip generic advice.`,
    "Output ONLY a JSON array of strings (no prose, no fences).",
  ].join("\n");
  const arr = extractJson(await runClaudeText(prompt, 120_000));
  if (!Array.isArray(arr)) throw new Error("ai insights failed");
  const insights = arr.filter((x) => typeof x === "string" && x.trim()).slice(0, 5);
  if (insights.length === 0) throw new Error("ai insights failed");
  const result = { month, lang, insights, generatedAt: new Date().toISOString() };
  cacheSet(cacheKey, result);
  return result;
}

// runClaude with feature attribution (cost/usage 귀속용) — 신규 심화 AI 전용
async function runClaudeFeatureText(prompt, feature, timeoutMs = 120_000) {
  return runClaude(prompt, { timeoutMs, model: "claude-haiku-4-5-20251001", appId: "ledger", feature });
}

// ── 심화 AI ①: 현금흐름 예측·월말잔액 전망 ────────────────────────────────
// 로컬 통계(지출 런레이트 + 예정 구독)를 코드로 계산하고, AI는 위험도·경고 서술만 담당(환각 최소화).
// 반환: { month, lang, predictedSpend, predictedBalance, riskLevel, warnings[], byCategory[], generatedAt }
async function aiForecast(month, lang) {
  const cacheKey = `forecast:${month}:${lang}`;
  const hit = cacheGet(cacheKey, 3600_000);
  if (hit) return hit;
  const today = todayStr();
  const [ty, tmIdx] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
  const daysInMonth = new Date(ty, tmIdx + 1, 0).getDate();
  const isCurrentMonth = month === today.slice(0, 7);
  const dayOfMonth = isCurrentMonth ? Number(today.slice(8, 10)) : (month < today.slice(0, 7) ? daysInMonth : 1);
  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth);
  const catName = (id) => {
    const c = db.categories.find((x) => x.id === id);
    return c ? (c.name[lang] ?? c.name.ko) : "etc";
  };
  // 이번 달 지출·수입 집계 (카테고리별)
  const monthTxs = db.transactions.filter((t) => ymOfStr(t.date) === month);
  const spentByCat = {};
  let spentSoFar = 0;
  for (const t of monthTxs) {
    if (t.type !== "expense") continue;
    const n = catName(t.categoryId ?? "etc-expense");
    spentByCat[n] = (spentByCat[n] ?? 0) + t.amount;
    spentSoFar += t.amount;
  }
  const incomeSoFar = monthTxs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  // 이번 달 남은 기간에 예정된 구독 결제 (아직 미기입)
  const upcomingSubs = [];
  let upcomingSubTotal = 0;
  for (const sub of db.subscriptions) {
    if (!sub.active) continue;
    const nb = nextBillingOf(sub);
    if (ymOfStr(nb) === month && nb > today) {
      upcomingSubs.push({ name: sub.name, amount: sub.amount, date: nb });
      upcomingSubTotal += sub.amount;
    }
  }
  // 런레이트 투영: 일평균 지출 × 남은 일수 + 예정 구독
  const dailyRate = dayOfMonth > 0 ? spentSoFar / dayOfMonth : 0;
  const projectedRemaining = Math.round(dailyRate * daysRemaining) + upcomingSubTotal;
  const predictedSpend = Math.round(spentSoFar + projectedRemaining);
  const predictedBalance = Math.round(incomeSoFar - predictedSpend); // 이번 달 순현금흐름(수입-지출) 전망
  const factor = dayOfMonth > 0 ? daysInMonth / dayOfMonth : 1;
  const byCategory = Object.entries(spentByCat)
    .map(([category, spent]) => ({ category, projected: Math.round(spent * factor) }))
    .sort((a, b) => b.projected - a.projected);
  const budgets = {};
  for (const [id, v] of Object.entries(db.budgets)) budgets[catName(id)] = v;
  const langName = { ko: "Korean", en: "English", ja: "Japanese" }[lang];
  const prompt = [
    "You are a personal cash-flow forecaster. Amounts are in KRW. All numbers are PRECOMPUTED — do NOT recompute or invent any number.",
    `Month ${month}: day ${dayOfMonth} of ${daysInMonth} (${daysRemaining} days remaining).`,
    `Spent so far: ${spentSoFar}. Income so far: ${incomeSoFar}. Projected month-end spend: ${predictedSpend}. Projected month-end net (income-spend): ${predictedBalance}.`,
    `Upcoming subscription charges before month end: ${JSON.stringify(upcomingSubs)} (total ${upcomingSubTotal}).`,
    `Projected spend by category (month end): ${JSON.stringify(byCategory)}.`,
    `Monthly budgets by category: ${JSON.stringify(budgets)}.`,
    `Assess overspend risk: compare projected category spend against budgets and check whether month-end net is negative.`,
    `Output ONLY JSON (no prose, no fences): {"riskLevel":"low"|"medium"|"high","warnings":["<short specific warning in ${langName}>", ...]}.`,
    `Warnings: mention concrete categories/amounts where projected exceeds budget, or if net cash flow is negative. 0-4 items, empty array if all healthy. Skip generic advice.`,
  ].join("\n");
  const obj = extractJson(await runClaudeFeatureText(prompt, "forecast", 120_000));
  const riskLevel = obj && ["low", "medium", "high"].includes(obj.riskLevel) ? obj.riskLevel : "medium";
  const warnings = Array.isArray(obj?.warnings)
    ? obj.warnings.filter((x) => typeof x === "string" && x.trim()).slice(0, 4)
    : [];
  const result = { month, lang, predictedSpend, predictedBalance, riskLevel, warnings, byCategory, generatedAt: new Date().toISOString() };
  cacheSet(cacheKey, result);
  return result;
}

// ── 심화 AI ②: 이상거래·중복결제 탐지 ─────────────────────────────────────
// 카테고리별 평균/편차·최근 대형지출·구독 목록을 코드로 계산 → AI가 판정·서술만.
// 반환: { lang, anomalies:[{type, description, amount?, severity}], duplicateSubs:[], generatedAt }
async function aiAnomalies(lang) {
  const cacheKey = `anomalies:${lang}`;
  const hit = cacheGet(cacheKey, 1800_000);
  if (hit) return hit;
  const today = todayStr();
  const cutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const cutoff30 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const catName = (id) => {
    const c = db.categories.find((x) => x.id === id);
    return c ? (c.name[lang] ?? c.name.ko) : "etc";
  };
  const recent = db.transactions.filter((t) => t.type === "expense" && String(t.date) >= cutoff);
  // 카테고리별 통계 (평균/편차/건수)
  const byCat = {};
  for (const t of recent) {
    const n = catName(t.categoryId ?? "etc-expense");
    (byCat[n] ??= []).push(t.amount);
  }
  const catStats = {};
  const catStatsList = Object.entries(byCat).map(([category, arr]) => {
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
    const std = Math.sqrt(variance);
    const st = { category, count: arr.length, mean: Math.round(mean), std: Math.round(std) };
    catStats[category] = { mean, std, count: arr.length };
    return st;
  });
  // 최근 30일 대형 지출 후보 (카테고리 z-score 동반)
  const recentLarge = recent
    .filter((t) => String(t.date) >= cutoff30)
    .map((t) => {
      const n = catName(t.categoryId ?? "etc-expense");
      const st = catStats[n];
      const z = st && st.std > 0 ? (t.amount - st.mean) / st.std : 0;
      return { date: t.date, memo: String(t.memo ?? "").slice(0, 60), amount: t.amount, category: n, z: Math.round(z * 10) / 10 };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15);
  // 신규 가맹점 후보: 메모 최초 등장이 최근 14일 이내
  const cutoff14 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const firstSeen = {};
  for (const t of db.transactions) {
    if (t.type !== "expense") continue;
    const m = String(t.memo ?? "").trim().toLowerCase();
    if (!m) continue;
    if (!firstSeen[m] || String(t.date) < firstSeen[m].date) firstSeen[m] = { date: String(t.date), memo: String(t.memo).slice(0, 60), amount: t.amount };
  }
  const newMerchants = Object.values(firstSeen).filter((x) => x.date >= cutoff14).slice(0, 12);
  // 활성 구독 + 중복 후보 (동일 금액 또는 유사 이름)
  const subs = db.subscriptions.filter((s) => s.active).map((s) => ({ name: s.name, amount: s.amount, cycle: s.cycle, category: catName(s.categoryId ?? "subscription") }));
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s\-_.]/g, "");
  const dupCandidates = [];
  for (let i = 0; i < subs.length; i++) {
    for (let j = i + 1; j < subs.length; j++) {
      const a = subs[i], b = subs[j];
      const na = norm(a.name), nb = norm(b.name);
      const nameHit = na && nb && (na === nb || na.includes(nb) || nb.includes(na));
      const amtHit = a.amount === b.amount && a.cycle === b.cycle;
      if (nameHit || amtHit) dupCandidates.push([a.name, b.name]);
    }
  }
  const langName = { ko: "Korean", en: "English", ja: "Japanese" }[lang];
  const prompt = [
    "You are a personal-finance anomaly detector. Amounts are in KRW. Stats are PRECOMPUTED — do NOT invent transactions or numbers, only classify and describe what is given.",
    `Category stats (last 90d, mean/std/count): ${JSON.stringify(catStatsList)}`,
    `Recent large expenses (last 30d, z = category z-score): ${JSON.stringify(recentLarge)}`,
    `Possible new merchants (first seen within 14d): ${JSON.stringify(newMerchants)}`,
    `Active subscriptions: ${JSON.stringify(subs)}`,
    `Possible duplicate subscription pairs (same amount+cycle or similar name): ${JSON.stringify(dupCandidates)}`,
    "Flag genuinely unusual items only: abnormally high amounts (z>2), suspicious/unexpected new merchants, and truly redundant/duplicate subscriptions. Be conservative.",
    `Output ONLY JSON (no prose, no fences): {"anomalies":[{"type":"high_amount"|"new_merchant"|"duplicate","description":"<short in ${langName}>","amount":<number optional>,"severity":"low"|"medium"|"high"}],"duplicateSubs":["<subscription name>", ...]}`,
    "Empty arrays if nothing notable.",
  ].join("\n");
  const obj = extractJson(await runClaudeFeatureText(prompt, "anomalies", 120_000));
  const ANO_TYPES = new Set(["high_amount", "new_merchant", "duplicate"]);
  const SEV = new Set(["low", "medium", "high"]);
  const anomalies = Array.isArray(obj?.anomalies)
    ? obj.anomalies
        .filter((a) => a && typeof a.description === "string" && a.description.trim())
        .map((a) => ({
          type: ANO_TYPES.has(a.type) ? a.type : "high_amount",
          description: String(a.description).slice(0, 300),
          ...(Number.isFinite(Number(a.amount)) ? { amount: Math.round(Number(a.amount)) } : {}),
          severity: SEV.has(a.severity) ? a.severity : "medium",
        }))
        .slice(0, 12)
    : [];
  const duplicateSubs = Array.isArray(obj?.duplicateSubs)
    ? obj.duplicateSubs.filter((x) => typeof x === "string" && x.trim()).slice(0, 10)
    : [];
  const result = { lang, anomalies, duplicateSubs, generatedAt: new Date().toISOString() };
  cacheSet(cacheKey, result);
  return result;
}

// ── 카드 승인 문자 정규식 파서 (KB/신한/삼성/현대/롯데/우리/하나 공통 패턴) ──
// 반환: { amount, date, memo } | null. 취소 문자는 제외.
function parseCardSms(text) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || /취소|거절|승인취소/.test(t)) return null;
  if (!/승인|사용|출금|결제/.test(t)) return null;
  const amtM = t.match(/([\d,]+)\s*원/);
  if (!amtM) return null;
  const amount = Number(amtM[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // 날짜: MM/DD 또는 MM월DD일 (연도는 올해로, 미래면 작년)
  let date = todayStr();
  const dM = t.match(/(\d{1,2})\/(\d{1,2})/) || t.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (dM) {
    const y = new Date().getFullYear();
    const cand = `${y}-${String(Number(dM[1])).padStart(2, "0")}-${String(Number(dM[2])).padStart(2, "0")}`;
    date = cand > todayStr() ? `${y - 1}${cand.slice(4)}` : cand;
  }
  // 가맹점: 시각(HH:MM) 뒤 텍스트 → 없으면 금액 뒤 "일시불/체크" 제거 후 잔여 텍스트
  let memo = "";
  const afterTime = t.match(/\d{1,2}:\d{2}\s+(.+)$/);
  if (afterTime) memo = afterTime[1];
  else {
    const afterAmt = t.slice(t.indexOf(amtM[0]) + amtM[0].length);
    memo = afterAmt.replace(/일시불|체크|누적.*$|잔액.*$|\(.*?\)/g, " ").trim();
  }
  memo = memo.replace(/누적\s*[\d,]+\s*원.*$/, "").replace(/잔액.*$/, "").trim().slice(0, 60);
  return { amount, date, memo: memo || "카드 승인" };
}

// 여러 문자 블록(붙여넣기) → 초안 목록. 정규식 실패분은 호출부에서 AI 폴백.
function parseSmsBlocks(text) {
  const blocks = text.split(/\n{2,}|(?=\[Web발신\])/).map((b) => b.trim()).filter(Boolean);
  const drafts = [], failed = [];
  for (const b of blocks) {
    const r = parseCardSms(b);
    if (r) drafts.push({ type: "expense", categoryId: "etc-expense", ...r });
    else if (b.length > 8) failed.push(b);
  }
  return { drafts, failed };
}

// ── Messages(chat.db) 스캔 — 아이폰 '문자 전달' 사용 시 카드 문자 자동 수집 ──
// sqlite3 CLI(-json)로 읽기 전용 조회. Full Disk Access 없으면 no_access 반환.
async function scanMessagesDb(days = 30) {
  const dbPath = join(homedir(), "Library", "Messages", "chat.db");
  const q = `SELECT m.guid, m.text, datetime(m.date/1000000000+978307200,'unixepoch','localtime') AS at
    FROM message m WHERE m.text IS NOT NULL AND m.text != ''
    AND m.date/1000000000+978307200 > strftime('%s','now')-${Math.min(365, Math.max(1, days))}*86400
    AND (m.text LIKE '%승인%' OR m.text LIKE '%출금%') AND m.text LIKE '%원%'
    ORDER BY m.date DESC LIMIT 200`;
  const { code, out, err } = await runCmd("sqlite3", ["-json", "-readonly", dbPath, q], { timeoutMs: 15_000 });
  if (code !== 0) {
    const msg = err.toLowerCase();
    throw new Error(msg.includes("unable to open") || msg.includes("authorization") ? "no_access" : `scan failed: ${err.slice(0, 120)}`);
  }
  let rows = [];
  try { rows = out.trim() ? JSON.parse(out) : []; } catch { rows = []; }
  const seen = new Set(db.smsImported);
  const items = [];
  for (const r of rows) {
    if (seen.has(r.guid)) continue;
    const parsed = parseCardSms(r.text ?? "");
    if (!parsed) continue;
    items.push({ guid: r.guid, receivedAt: r.at, type: "expense", categoryId: "etc-expense", ...parsed, raw: String(r.text).slice(0, 300) });
  }
  return items;
}
function ymOfStr(date) {
  return String(date ?? "").slice(0, 7);
}
// 다음 결제일 — 이미 기입된 기간(chargedPeriods)은 건너뛴다 (클라이언트 util과 동일 규칙)
function nextBillingOf(sub) {
  const now = new Date();
  const charged = new Set(sub.chargedPeriods ?? []);
  if (sub.cycle === "monthly") {
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (charged.has(period)) continue;
      const day = clampDay(d.getFullYear(), d.getMonth(), sub.billingDay || 1);
      const cand = `${period}-${String(day).padStart(2, "0")}`;
      if (cand >= todayStr()) return cand;
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const y = now.getFullYear() + i;
      if (charged.has(String(y))) continue;
      const mIdx = (sub.billingMonth || 1) - 1;
      const day = clampDay(y, mIdx, sub.billingDay || 1);
      const cand = `${y}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (cand >= todayStr()) return cand;
    }
  }
  return todayStr();
}
function markSmsHandled(guid) {
  if (!guid || db.smsImported.includes(guid)) return;
  db.smsImported.push(guid);
  if (db.smsImported.length > 2000) db.smsImported = db.smsImported.slice(-2000);
}

// ── 유틸 ────────────────────────────────────────────────────────────────
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (d) => {
      size += d.length;
      if (size > 1_000_000) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(d);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const TX_TYPES = new Set(["expense", "income", "transfer"]);
const ASSET_TYPES = new Set(["cash", "bank", "card"]);
const CYCLES = new Set(["monthly", "yearly"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/;

function sanitizeAmount(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100_000_000_000) : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 자산관리(재무설계) — 시세 연동 모듈
// 한투(KIS): 조회 전용(현재가·잔고). 주문 API는 의도적으로 미탑재.
// 업비트: public 시세(무인증) + 계좌 조회(JWT). 환율: frankfurter. 금: gold-api.
// ═══════════════════════════════════════════════════════════════════════
const KIS_ENV_FILE = join(homedir(), "claude/jarvis-trading/.env");
const UPBIT_ENV_FILE = join(homedir(), "claude/jarvis-crypto/.env");
const KIS_TOKEN_FILE = join(DATA_DIR, "kis-token.json");
const OZ_TO_GRAM = 31.1034768;

async function readEnvFile(path) {
  try {
    const out = {};
    for (const line of (await readFile(path, "utf-8")).split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

// ── 간단 TTL 캐시 (시세 5분) ──
const quoteCache = new Map();
function cacheGet(key, ttlMs = 300_000) {
  const hit = quoteCache.get(key);
  return hit && Date.now() - hit.ts < ttlMs ? hit.value : null;
}
function cacheSet(key, value) {
  quoteCache.set(key, { value, ts: Date.now() });
}

async function fetchJson(url, init = {}, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ── KIS(한국투자증권) — 조회 전용 클라이언트 ──
async function kisConfig() {
  const env = await readEnvFile(KIS_ENV_FILE);
  if (!env.KIS_APP_KEY || !env.KIS_APP_SECRET) return null;
  const paper = (env.KIS_IS_PAPER || "true").toLowerCase() === "true";
  return {
    key: env.KIS_APP_KEY, secret: env.KIS_APP_SECRET,
    account: env.KIS_ACCOUNT_NO || "", paper,
    base: paper ? "https://openapivts.koreainvestment.com:29443" : "https://openapi.koreainvestment.com:9443",
  };
}
async function kisToken(cfg) {
  try {
    const cached = JSON.parse(await readFile(KIS_TOKEN_FILE, "utf-8"));
    if (cached.token && cached.expiresAt > Date.now()) return cached.token;
  } catch { /* 캐시 없음 → 신규 발급 */ }
  const data = await fetchJson(`${cfg.base}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: cfg.key, appsecret: cfg.secret }),
  });
  if (!data.access_token) throw new Error("KIS token issue failed");
  await mkdir(DATA_DIR, { recursive: true });
  // 23시간 캐시 (KIS 토큰 24h 유효, 재요청 시 동일 토큰 반환되어 jarvis-trading과 충돌 없음)
  await writeFile(KIS_TOKEN_FILE, JSON.stringify({ token: data.access_token, expiresAt: Date.now() + 23 * 3600_000 }), "utf-8");
  return data.access_token;
}
async function kisGet(cfg, path, trId, params) {
  const token = await kisToken(cfg);
  const qs = new URLSearchParams(params).toString();
  // 초당 거래건수 초과(EGW00201) 시 백오프 재시도 — 다건 시세 조회·타 프로세스 동시 사용 대비
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchJson(`${cfg.base}${path}?${qs}`, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey: cfg.key, appsecret: cfg.secret, tr_id: trId, custtype: "P",
        },
      });
    } catch (e) {
      if (attempt < 4 && e.message.includes("EGW00201")) {
        await new Promise((r) => setTimeout(r, 350 * attempt));
        continue;
      }
      throw e;
    }
  }
}
async function kisPrice(cfg, code) {
  const data = await kisGet(cfg, "/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
    fid_cond_mrkt_div_code: "J", fid_input_iscd: code,
  });
  const o = data.output;
  if (!o || !o.stck_prpr) throw new Error(`KIS price failed: ${code}`);
  return { price: Number(o.stck_prpr), changePct: Number(o.prdy_ctrt) || 0, name: o.rprs_mrkt_kor_name || "" };
}

// ── KIS 해외주식 현재가 (현지통화 기준) ──
const OVERSEAS_EXCHANGES = new Set(["NAS", "NYS", "AMS", "HKS", "TSE", "SHS", "SZS"]);
const EXCHANGE_CURRENCY = { NAS: "USD", NYS: "USD", AMS: "USD", HKS: "HKD", TSE: "JPY", SHS: "CNY", SZS: "CNY" };
async function kisOverseasPrice(cfg, excd, symb) {
  const data = await kisGet(cfg, "/uapi/overseas-price/v1/quotations/price", "HHDFS00000300", {
    AUTH: "", EXCD: excd, SYMB: symb,
  });
  const o = data.output;
  if (!o || !Number(o.last)) throw new Error(`KIS overseas price failed: ${excd}:${symb}`);
  return { price: Number(o.last), changePct: Number(o.rate) || 0, currency: EXCHANGE_CURRENCY[excd] || "USD" };
}
async function kisBalance(cfg) {
  const [cano, prdt] = cfg.account.includes("-") ? cfg.account.split("-") : [cfg.account.slice(0, 8), cfg.account.slice(8) || "01"];
  const trId = cfg.paper ? "VTTC8434R" : "TTTC8434R";
  const data = await kisGet(cfg, "/uapi/domestic-stock/v1/trading/inquire-balance", trId, {
    CANO: cano, ACNT_PRDT_CD: prdt, AFHR_FLPR_YN: "N", OFL_YN: "", INQR_DVSN: "02",
    UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00",
    CTX_AREA_FK100: "", CTX_AREA_NK100: "",
  });
  if (data.rt_cd !== "0") throw new Error(`KIS balance failed: ${data.msg1 || data.rt_cd}`);
  return (data.output1 || [])
    .filter((r) => Number(r.hldg_qty) > 0)
    .map((r) => ({ ticker: r.pdno, name: r.prdt_name, qty: Number(r.hldg_qty), avgPrice: Number(r.pchs_avg_pric) }));
}

// ── KIS 해외주식 잔고 (미국 통합, 조회 전용) ──
const OVRS_EXCG_TO_EXCD = { NASD: "NAS", NYSE: "NYS", AMEX: "AMS", SEHK: "HKS", TKSE: "TSE", SHAA: "SHS", SZAA: "SZS" };
async function kisBalanceOverseas(cfg) {
  const [cano, prdt] = cfg.account.includes("-") ? cfg.account.split("-") : [cfg.account.slice(0, 8), cfg.account.slice(8) || "01"];
  const trId = cfg.paper ? "VTTS3012R" : "TTTS3012R";
  const data = await kisGet(cfg, "/uapi/overseas-stock/v1/trading/inquire-balance", trId, {
    CANO: cano, ACNT_PRDT_CD: prdt, OVRS_EXCG_CD: "NASD", TR_CRCY_CD: "USD",
    CTX_AREA_FK200: "", CTX_AREA_NK200: "",
  });
  if (data.rt_cd !== "0") throw new Error(`KIS overseas balance failed: ${data.msg1 || data.rt_cd}`);
  return (data.output1 || [])
    .filter((r) => Number(r.ovrs_cblc_qty) > 0)
    .map((r) => ({
      ticker: r.ovrs_pdno, name: r.ovrs_item_name,
      qty: Number(r.ovrs_cblc_qty), avgPrice: Number(r.pchs_avg_pric),
      exchange: OVRS_EXCG_TO_EXCD[r.ovrs_excg_cd] || "NAS",
    }));
}

// ── 업비트 — public 시세 + 계좌 조회(JWT HS256) ──
async function upbitTicker(markets) {
  if (markets.length === 0) return {};
  const data = await fetchJson(`https://api.upbit.com/v1/ticker?markets=${markets.join(",")}`);
  const out = {};
  for (const r of data) out[r.market] = { price: r.trade_price, changePct: (r.signed_change_rate || 0) * 100 };
  return out;
}
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function upbitAccounts() {
  const env = await readEnvFile(UPBIT_ENV_FILE);
  if (!env.UPBIT_ACCESS_KEY || !env.UPBIT_SECRET_KEY) throw new Error("Upbit keys not configured");
  const { createHmac } = await import("node:crypto");
  const header = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({ access_key: env.UPBIT_ACCESS_KEY, nonce: randomUUID() })));
  const sig = base64url(createHmac("sha256", env.UPBIT_SECRET_KEY).update(`${header}.${payload}`).digest());
  const data = await fetchJson("https://api.upbit.com/v1/accounts", {
    headers: { Authorization: `Bearer ${header}.${payload}.${sig}` },
  });
  return data
    .filter((a) => a.currency !== "KRW" && Number(a.balance) + Number(a.locked || 0) > 0)
    .map((a) => ({
      market: `${a.unit_currency || "KRW"}-${a.currency}`,
      currency: a.currency,
      qty: Number(a.balance) + Number(a.locked || 0),
      avgPrice: Number(a.avg_buy_price) || 0,
    }));
}

// ── 환율(frankfurter, ECB) — KRW 기준 역산 ──
async function fxRates(currencies) {
  if (currencies.length === 0) return {};
  const data = await fetchJson(`https://api.frankfurter.app/latest?from=KRW&to=${currencies.join(",")}`);
  const out = {};
  for (const [cur, rate] of Object.entries(data.rates || {})) {
    if (rate > 0) out[cur] = 1 / rate; // 1 {cur} = ? KRW
  }
  return out;
}

// ── KIS 적용 환율 (해외주식 매수가능금액조회 output.exrt — 조회 전용, 주문 아님) ──
// 계좌의 체결기준현재잔고 output2가 비어 있어(외화예수금 0) 통화별 대표 심볼로 exrt만 읽는다.
const KIS_FX_PROBE = { USD: ["NASD", "AAPL"], HKD: ["SEHK", "00700"], JPY: ["TKSE", "7203"], CNY: ["SHAA", "600519"] };
async function kisFxRates(cfg, currencies) {
  const [cano, prdt] = cfg.account.includes("-") ? cfg.account.split("-") : [cfg.account.slice(0, 8), cfg.account.slice(8) || "01"];
  const trId = cfg.paper ? "VTTS3007R" : "TTTS3007R";
  const out = {};
  for (const cur of currencies) {
    const probe = KIS_FX_PROBE[cur];
    if (!probe) continue;
    const data = await kisGet(cfg, "/uapi/overseas-stock/v1/trading/inquire-psamount", trId, {
      CANO: cano, ACNT_PRDT_CD: prdt, OVRS_EXCG_CD: probe[0], OVRS_ORD_UNPR: "0", ITEM_CD: probe[1],
    });
    const rate = Number(data.output?.exrt);
    if (data.rt_cd === "0" && rate > 0) out[cur] = rate;
  }
  return out;
}

// ── 환율 통합 조회: 한투 고시환율 우선(실계좌와 일치), 미제공 통화는 ECB 폴백 ──
async function resolveFxRates(currencies) {
  if (currencies.length === 0) return { rates: {}, source: "" };
  const key = `fxres:${[...currencies].sort().join(",")}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  let kisRates = {};
  try {
    const cfg = await kisConfig();
    if (cfg) kisRates = await kisFxRates(cfg, currencies);
  } catch { /* KIS 실패 → ECB 폴백 */ }
  const rates = {};
  let usedKis = false, usedEcb = false;
  for (const c of currencies) {
    if (kisRates[c] > 0) { rates[c] = kisRates[c]; usedKis = true; }
  }
  const missing = currencies.filter((c) => !rates[c]);
  if (missing.length > 0) {
    try {
      const ecb = await fxRates(missing);
      for (const [c, r] of Object.entries(ecb)) { rates[c] = r; usedEcb = true; }
    } catch (e) {
      if (!usedKis) throw e; // 둘 다 실패 시에만 에러
    }
  }
  const result = { rates, source: usedKis && usedEcb ? "KIS+ECB" : usedKis ? "KIS" : "ECB" };
  cacheSet(key, result);
  return result;
}

// ── 금 시세 (gold-api.com 무인증, USD/oz → KRW/g) ──
async function goldKrwPerGram() {
  const [gold, fx] = await Promise.all([
    fetchJson("https://api.gold-api.com/price/XAU"),
    resolveFxRates(["USD"]),
  ]);
  const usdPerOz = Number(gold.price);
  const usdKrw = fx.rates.USD;
  if (!usdPerOz || !usdKrw) throw new Error("gold quote failed");
  return { krwPerGram: Math.round((usdPerOz / OZ_TO_GRAM) * usdKrw), usdPerOz };
}

// ── 배당금: 국내 = KIS 예탁원 배당일정(금액·지급일), 해외 = 야후 이력(금액) ──
function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
async function kisDividendsDomestic(cfg, code) {
  const now = new Date();
  const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const data = await kisGet(cfg, "/uapi/domestic-stock/v1/ksdinfo/dividend", "HHKDB669102C0", {
    CTS: "", GB1: "0", F_DT: ymd(from), T_DT: `${now.getFullYear()}1231`, SHT_CD: code, HIGH_GB: "",
  });
  if (data.rt_cd !== "0") throw new Error(`KIS dividend failed: ${code}`);
  return (data.output1 || []).map((r) => ({
    // divi_pay_dt "2026/06/17" → "2026-06-17" (미지급 예정 건은 빈 값)
    payDate: (r.divi_pay_dt || "").replaceAll("/", "-") || null,
    recordDate: r.record_date ? `${r.record_date.slice(0, 4)}-${r.record_date.slice(4, 6)}-${r.record_date.slice(6, 8)}` : null,
    perShare: Number(r.per_sto_divi_amt) || 0, // 0 = 미공시(예정)
  }));
}
async function yahooDividends(symbol) {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1mo&events=div`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  const divs = data?.chart?.result?.[0]?.events?.dividends || {};
  return Object.values(divs)
    .filter((d) => Number(d.amount) > 0 && Number(d.date) > 0)
    .map((d) => {
      const dt = new Date(Number(d.date) * 1000);
      return { payDate: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`, recordDate: null, perShare: Number(d.amount) };
    });
}
async function collectDividends() {
  const holdings = db.holdings.filter((h) => (h.kind === "stock" || h.kind === "etf") && h.ticker && (h.qty ?? 0) > 0);
  const out = { items: [], errors: [], fetchedAt: new Date().toISOString() };
  if (holdings.length === 0) return out;
  const cfg = await kisConfig();
  const overseas = holdings.filter((h) => OVERSEAS_EXCHANGES.has(h.exchange));
  const fx = overseas.length > 0
    ? await resolveFxRates([...new Set(overseas.map((h) => EXCHANGE_CURRENCY[h.exchange] || "USD"))]).catch(() => ({ rates: {} }))
    : { rates: {} };
  for (const h of holdings) {
    const isOverseas = OVERSEAS_EXCHANGES.has(h.exchange);
    const cacheKey = `div:${isOverseas ? `${h.exchange}:` : ""}${h.ticker}`;
    let events = cacheGet(cacheKey, 3600_000);
    if (!events) {
      try {
        if (isOverseas) {
          events = await yahooDividends(h.ticker);
        } else {
          if (!cfg) throw new Error("KIS keys not configured");
          events = await kisDividendsDomestic(cfg, h.ticker);
        }
        cacheSet(cacheKey, events);
      } catch (e) {
        out.errors.push(`${h.ticker}: ${e.message.slice(0, 80)}`);
        continue;
      }
    }
    const currency = isOverseas ? EXCHANGE_CURRENCY[h.exchange] || "USD" : "KRW";
    const rate = isOverseas ? fx.rates[currency] || 0 : 1;
    out.items.push({
      holdingId: h.id, name: h.name, ticker: h.ticker, exchange: h.exchange ?? "KRX",
      qty: h.qty, currency,
      events: events.map((ev) => ({
        ...ev,
        perShare: ev.perShare,
        // 보유수량 기준 추정 지급액 (원화, 세전). 해외 환율 미확보 시 0 → 클라이언트에서 현지통화만 표시
        amountKrw: Math.round(ev.perShare * (h.qty ?? 0) * rate),
      })),
    });
  }
  return out;
}

// ── 보유 자산 전체 시세 일괄 조회 (소스별 캐시·부분 실패 허용) ──
async function collectQuotes() {
  const stockHoldings = db.holdings.filter((h) => (h.kind === "stock" || h.kind === "etf") && h.ticker);
  const domestic = [...new Set(stockHoldings.filter((h) => !OVERSEAS_EXCHANGES.has(h.exchange)).map((h) => h.ticker))];
  const overseas = [...new Map(
    stockHoldings.filter((h) => OVERSEAS_EXCHANGES.has(h.exchange)).map((h) => [`${h.exchange}:${h.ticker}`, h]),
  ).values()];
  const markets = [...new Set(db.holdings.filter((h) => h.kind === "crypto").map((h) => h.market).filter(Boolean))];
  // 환율: 외환 보유분 + 해외주식 통화 + USD 상시 (표시 통화 원화/달러 변환용)
  const currencies = [...new Set([
    "USD",
    ...db.holdings.filter((h) => h.kind === "fx").map((h) => h.currency).filter(Boolean),
    ...overseas.map((h) => EXCHANGE_CURRENCY[h.exchange] || "USD"),
  ])];
  const needGold = db.holdings.some((h) => h.kind === "gold");
  const out = { stocks: {}, crypto: {}, fx: {}, gold: null, errors: [], fetchedAt: new Date().toISOString() };

  const jobs = [];
  if (domestic.length > 0 || overseas.length > 0) {
    jobs.push((async () => {
      const cfg = await kisConfig();
      if (!cfg) { out.errors.push("kis: keys not configured"); return; }
      for (const code of domestic) {
        const key = `kis:${code}`;
        const hit = cacheGet(key);
        if (hit) { out.stocks[code] = hit; continue; }
        try {
          const q = await kisPrice(cfg, code);
          out.stocks[code] = q;
          cacheSet(key, q);
        } catch (e) {
          out.errors.push(`kis ${code}: ${e.message.slice(0, 80)}`);
        }
      }
      for (const h of overseas) {
        const mapKey = `${h.exchange}:${h.ticker}`;
        const key = `kis-ovrs:${mapKey}`;
        const hit = cacheGet(key);
        if (hit) { out.stocks[mapKey] = hit; continue; }
        try {
          const q = await kisOverseasPrice(cfg, h.exchange, h.ticker);
          out.stocks[mapKey] = q;
          cacheSet(key, q);
        } catch (e) {
          out.errors.push(`kis ${mapKey}: ${e.message.slice(0, 80)}`);
        }
      }
    })());
  }
  if (markets.length > 0) {
    jobs.push((async () => {
      const key = `upbit:${markets.sort().join(",")}`;
      const hit = cacheGet(key);
      if (hit) { out.crypto = hit; return; }
      try {
        out.crypto = await upbitTicker(markets);
        cacheSet(key, out.crypto);
      } catch (e) {
        out.errors.push(`upbit: ${e.message.slice(0, 80)}`);
      }
    })());
  }
  if (currencies.length > 0) {
    jobs.push((async () => {
      try {
        const r = await resolveFxRates(currencies); // 한투 고시 우선, ECB 폴백 (자체 캐시)
        out.fx = r.rates;
        out.fxSource = r.source;
      } catch (e) {
        out.errors.push(`fx: ${e.message.slice(0, 80)}`);
      }
    })());
  }
  if (needGold) {
    jobs.push((async () => {
      const hit = cacheGet("gold");
      if (hit) { out.gold = hit; return; }
      try {
        out.gold = await goldKrwPerGram();
        cacheSet("gold", out.gold);
      } catch (e) {
        out.errors.push(`gold: ${e.message.slice(0, 80)}`);
      }
    })());
  }
  await Promise.all(jobs);
  return out;
}

const HOLDING_KINDS = new Set(["deposit", "savings", "stock", "etf", "crypto", "fx", "gold", "loan", "receivable", "payable"]);
function sanitizeHolding(b, cur = {}) {
  const kind = HOLDING_KINDS.has(b.kind) ? b.kind : cur.kind;
  if (!kind) return null;
  const num = (v, fb = 0) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fb);
  const h = {
    ...cur,
    kind,
    name: String(b.name ?? cur.name ?? "").slice(0, 60),
    memo: String(b.memo ?? cur.memo ?? "").slice(0, 200),
  };
  if (kind === "deposit" || kind === "savings") {
    h.principal = num(b.principal, cur.principal ?? 0);
    h.ratePct = num(b.ratePct, cur.ratePct ?? 0);
    h.startDate = DATE_RE.test(String(b.startDate ?? "")) ? b.startDate : (cur.startDate ?? todayStr());
    h.maturityDate = DATE_RE.test(String(b.maturityDate ?? "")) ? b.maturityDate : (cur.maturityDate ?? null);
    if (kind === "savings") h.monthlyDeposit = num(b.monthlyDeposit, cur.monthlyDeposit ?? 0);
  } else if (kind === "stock" || kind === "etf") {
    h.ticker = String(b.ticker ?? cur.ticker ?? "").replace(/[^0-9A-Za-z.]/g, "").slice(0, 12);
    const ex = String(b.exchange ?? cur.exchange ?? "KRX").toUpperCase();
    h.exchange = OVERSEAS_EXCHANGES.has(ex) ? ex : "KRX";
    h.qty = num(b.qty, cur.qty ?? 0);
    h.avgPrice = num(b.avgPrice, cur.avgPrice ?? 0);
  } else if (kind === "crypto") {
    const mkt = String(b.market ?? cur.market ?? "").toUpperCase().replace(/[^0-9A-Z-]/g, "").slice(0, 20);
    h.market = mkt.includes("-") ? mkt : (mkt ? `KRW-${mkt}` : "");
    h.qty = num(b.qty, cur.qty ?? 0);
    h.avgPrice = num(b.avgPrice, cur.avgPrice ?? 0);
  } else if (kind === "fx") {
    h.currency = String(b.currency ?? cur.currency ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    h.amount = num(b.amount, cur.amount ?? 0);
    h.avgRate = num(b.avgRate, cur.avgRate ?? 0);
  } else if (kind === "gold") {
    h.grams = num(b.grams, cur.grams ?? 0);
    h.avgPricePerGram = num(b.avgPricePerGram, cur.avgPricePerGram ?? 0);
  } else if (kind === "loan" || kind === "receivable" || kind === "payable") {
    h.principal = num(b.principal ?? b.amount, cur.principal ?? 0);
    h.currency = (String(b.currency ?? cur.currency ?? "KRW").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3)) || "KRW";
    const rate = Number(b.interestRate);
    if (Number.isFinite(rate) && rate > 0) h.interestRate = Math.round(rate * 100) / 100;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (kind === "loan" && dateRe.test(b.loanDate ?? "")) h.loanDate = b.loanDate;
    else if (kind === "receivable" && dateRe.test(b.lentDate ?? "")) h.lentDate = b.lentDate;
    else if (kind === "payable" && dateRe.test(b.borrowedDate ?? "")) h.borrowedDate = b.borrowedDate;
  }
  return h;
}

// ── API ─────────────────────────────────────────────────────────────────
async function handleApi(req, res, p, query) {
  if (p === "/api/health") return json(res, 200, { ok: true, app: "ledger" });

  if (p === "/api/state" && req.method === "GET") {
    await maybeApplySubscriptions();
    return json(res, 200, {
      assets: db.assets, categories: db.categories, transactions: db.transactions,
      budgets: db.budgets, subscriptions: db.subscriptions,
      holdings: db.holdings, snapshots: db.snapshots,
    });
  }

  // ── 거래 ──
  if (p === "/api/transactions" && req.method === "POST") {
    const b = await readBody(req);
    const amount = sanitizeAmount(b.amount);
    if (!TX_TYPES.has(b.type)) return json(res, 400, { error: "invalid type" });
    if (amount === null || amount === 0) return json(res, 400, { error: "invalid amount" });
    if (!DATE_RE.test(String(b.date ?? ""))) return json(res, 400, { error: "invalid date" });
    const item = {
      id: randomUUID(), type: b.type, amount,
      categoryId: b.type === "transfer" ? null : String(b.categoryId ?? "") || null,
      assetId: b.assetId ? String(b.assetId) : null,
      toAssetId: b.type === "transfer" && b.toAssetId ? String(b.toAssetId) : null,
      memo: String(b.memo ?? "").slice(0, 200),
      date: b.date, createdAt: new Date().toISOString(), subscriptionId: null,
    };
    db.transactions.unshift(item);
    if (b.smsGuid) markSmsHandled(String(b.smsGuid)); // 문자 제안에서 추가 시 재제안 방지
    await saveDb();
    return json(res, 201, { item });
  }
  let m = p.match(/^\/api\/transactions\/([0-9a-f-]{36})$/);
  if (m) {
    const idx = db.transactions.findIndex((x) => x.id === m[1]);
    if (idx === -1) return json(res, 404, { error: "not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      const cur = db.transactions[idx];
      if (b.type !== undefined && TX_TYPES.has(b.type)) cur.type = b.type;
      if (b.amount !== undefined) {
        const a = sanitizeAmount(b.amount);
        if (a === null || a === 0) return json(res, 400, { error: "invalid amount" });
        cur.amount = a;
      }
      if (b.categoryId !== undefined) cur.categoryId = b.categoryId ? String(b.categoryId) : null;
      if (b.assetId !== undefined) cur.assetId = b.assetId ? String(b.assetId) : null;
      if (b.toAssetId !== undefined) cur.toAssetId = b.toAssetId ? String(b.toAssetId) : null;
      if (b.memo !== undefined) cur.memo = String(b.memo).slice(0, 200);
      if (b.date !== undefined && DATE_RE.test(String(b.date))) cur.date = b.date;
      await saveDb();
      return json(res, 200, { item: cur });
    }
    if (req.method === "DELETE") {
      const [removed] = db.transactions.splice(idx, 1);
      await saveDb();
      return json(res, 200, { item: removed });
    }
  }

  // ── 자산 ──
  if (p === "/api/assets" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.name) return json(res, 400, { error: "name required" });
    const item = {
      id: randomUUID(), name: String(b.name).slice(0, 60),
      type: ASSET_TYPES.has(b.type) ? b.type : "bank",
      initialBalance: sanitizeAmount(b.initialBalance) ?? 0,
      createdAt: new Date().toISOString(),
    };
    db.assets.push(item);
    await saveDb();
    return json(res, 201, { item });
  }
  m = p.match(/^\/api\/assets\/([0-9a-f-]{36})$/);
  if (m) {
    const idx = db.assets.findIndex((x) => x.id === m[1]);
    if (idx === -1) return json(res, 404, { error: "not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      const cur = db.assets[idx];
      if (b.name !== undefined) cur.name = String(b.name).slice(0, 60);
      if (b.type !== undefined && ASSET_TYPES.has(b.type)) cur.type = b.type;
      if (b.initialBalance !== undefined) cur.initialBalance = sanitizeAmount(b.initialBalance) ?? cur.initialBalance;
      await saveDb();
      return json(res, 200, { item: cur });
    }
    if (req.method === "DELETE") {
      const used = db.transactions.some((t) => t.assetId === m[1] || t.toAssetId === m[1])
        || db.subscriptions.some((s) => s.assetId === m[1]);
      if (used) return json(res, 409, { error: "asset in use" });
      const [removed] = db.assets.splice(idx, 1);
      await saveDb();
      return json(res, 200, { item: removed });
    }
  }

  // ── 카테고리 ──
  if (p === "/api/categories" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.name) return json(res, 400, { error: "name required" });
    const kind = b.kind === "income" ? "income" : "expense";
    const nm = String(b.name).slice(0, 40);
    const item = {
      id: randomUUID(), kind, emoji: String(b.emoji ?? "🏷️").slice(0, 8),
      name: { ko: nm, en: nm, ja: nm }, custom: true,
    };
    db.categories.push(item);
    await saveDb();
    return json(res, 201, { item });
  }
  m = p.match(/^\/api\/categories\/([0-9a-zA-Z-]{1,40})$/);
  if (m && req.method === "DELETE") {
    const idx = db.categories.findIndex((x) => x.id === m[1]);
    if (idx === -1) return json(res, 404, { error: "not found" });
    const used = db.transactions.some((t) => t.categoryId === m[1])
      || db.subscriptions.some((s) => s.categoryId === m[1]);
    if (used) return json(res, 409, { error: "category in use" });
    const [removed] = db.categories.splice(idx, 1);
    delete db.budgets[m[1]];
    await saveDb();
    return json(res, 200, { item: removed });
  }

  // ── 예산 (카테고리별 월 예산 일괄 설정) ──
  if (p === "/api/budgets" && req.method === "PUT") {
    const b = await readBody(req);
    if (!b || typeof b !== "object" || Array.isArray(b)) return json(res, 400, { error: "invalid body" });
    const next = {};
    for (const [k, v] of Object.entries(b)) {
      const a = sanitizeAmount(v);
      if (a !== null && a > 0 && db.categories.some((c) => c.id === k)) next[k] = a;
    }
    db.budgets = next;
    await saveDb();
    return json(res, 200, { budgets: db.budgets });
  }

  // ── 구독 ──
  if (p === "/api/subscriptions" && req.method === "POST") {
    const b = await readBody(req);
    const amount = sanitizeAmount(b.amount);
    if (!b.name) return json(res, 400, { error: "name required" });
    if (amount === null || amount === 0) return json(res, 400, { error: "invalid amount" });
    const item = {
      id: randomUUID(), name: String(b.name).slice(0, 60), amount,
      cycle: CYCLES.has(b.cycle) ? b.cycle : "monthly",
      billingDay: Math.max(1, Math.min(31, Number(b.billingDay) || 1)),
      billingMonth: Math.max(1, Math.min(12, Number(b.billingMonth) || 1)),
      assetId: b.assetId ? String(b.assetId) : null,
      categoryId: b.categoryId ? String(b.categoryId) : "subscription",
      memo: String(b.memo ?? "").slice(0, 200),
      active: b.active !== false,
      startedAt: DATE_RE.test(String(b.startedAt ?? "")) ? b.startedAt : todayStr(),
      chargedPeriods: [],
      createdAt: new Date().toISOString(),
    };
    db.subscriptions.push(item);
    applyDueSubscriptions();
    await saveDb();
    return json(res, 201, { item });
  }
  m = p.match(/^\/api\/subscriptions\/([0-9a-f-]{36})$/);
  if (m) {
    const idx = db.subscriptions.findIndex((x) => x.id === m[1]);
    if (idx === -1) return json(res, 404, { error: "not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      const cur = db.subscriptions[idx];
      if (b.name !== undefined) cur.name = String(b.name).slice(0, 60);
      if (b.amount !== undefined) {
        const a = sanitizeAmount(b.amount);
        if (a === null || a === 0) return json(res, 400, { error: "invalid amount" });
        cur.amount = a;
      }
      if (b.cycle !== undefined && CYCLES.has(b.cycle)) cur.cycle = b.cycle;
      if (b.billingDay !== undefined) cur.billingDay = Math.max(1, Math.min(31, Number(b.billingDay) || 1));
      if (b.billingMonth !== undefined) cur.billingMonth = Math.max(1, Math.min(12, Number(b.billingMonth) || 1));
      if (b.assetId !== undefined) cur.assetId = b.assetId ? String(b.assetId) : null;
      if (b.categoryId !== undefined) cur.categoryId = b.categoryId ? String(b.categoryId) : "subscription";
      if (b.memo !== undefined) cur.memo = String(b.memo).slice(0, 200);
      if (b.active !== undefined) {
        const on = Boolean(b.active);
        // 재활성화 시 휴면 기간 소급 기입 방지 — 시작일을 오늘로 리셋
        if (on && !cur.active) cur.startedAt = todayStr();
        cur.active = on;
      }
      applyDueSubscriptions();
      await saveDb();
      return json(res, 200, { item: cur });
    }
    if (req.method === "DELETE") {
      const [removed] = db.subscriptions.splice(idx, 1);
      await saveDb();
      return json(res, 200, { item: removed });
    }
  }

  // ── 자산관리: 보유 자산(holdings) CRUD ──
  if (p === "/api/holdings" && req.method === "POST") {
    const b = await readBody(req);
    const h = sanitizeHolding(b);
    if (!h) return json(res, 400, { error: "invalid kind" });
    if (!h.name) return json(res, 400, { error: "name required" });
    const item = { ...h, id: randomUUID(), source: "manual", createdAt: new Date().toISOString() };
    db.holdings.push(item);
    await saveDb();
    return json(res, 201, { item });
  }
  m = p.match(/^\/api\/holdings\/([0-9a-f-]{36})$/);
  if (m) {
    const idx = db.holdings.findIndex((x) => x.id === m[1]);
    if (idx === -1) return json(res, 404, { error: "not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      const next = sanitizeHolding(b, db.holdings[idx]);
      if (!next || !next.name) return json(res, 400, { error: "invalid holding" });
      db.holdings[idx] = next;
      await saveDb();
      return json(res, 200, { item: next });
    }
    if (req.method === "DELETE") {
      const [removed] = db.holdings.splice(idx, 1);
      await saveDb();
      return json(res, 200, { item: removed });
    }
  }

  // ── 자산관리: 시세 일괄 조회 (5분 캐시, 부분 실패 허용) ──
  if (p === "/api/quotes" && req.method === "GET") {
    try {
      return json(res, 200, await collectQuotes());
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ── 자산관리: 배당금 조회 (보유 주식·ETF, 1시간 캐시) ──
  if (p === "/api/dividends" && req.method === "GET") {
    try {
      return json(res, 200, await collectDividends());
    } catch (e) {
      return json(res, 502, { error: e.message.slice(0, 200) });
    }
  }

  // ── 자산관리: 한투 보유종목 동기화 (국내+해외, 조회 전용) ──
  if (p === "/api/sync/kis" && req.method === "POST") {
    try {
      const cfg = await kisConfig();
      if (!cfg) return json(res, 400, { error: "KIS keys not configured" });
      const rows = (await kisBalance(cfg)).map((r) => ({ ...r, exchange: "KRX" }));
      let overseasError = null;
      try {
        const ovrs = await kisBalanceOverseas(cfg);
        if (ovrs.length > 0) {
          // 해외 평단은 USD로 오므로 원화로 환산 저장 (앱의 평단 입력·표시 기준 = 원화)
          const fx = await resolveFxRates(["USD"]);
          if (!fx.rates.USD) throw new Error("USD rate unavailable");
          for (const r of ovrs) r.avgPrice = Math.round(r.avgPrice * fx.rates.USD);
        }
        rows.push(...ovrs);
      } catch (e) {
        overseasError = e.message.slice(0, 120); // 해외 실패는 국내 결과에 영향 없음
      }
      let added = 0, updated = 0;
      for (const r of rows) {
        const existing = db.holdings.find((h) =>
          (h.kind === "stock" || h.kind === "etf") && h.ticker === r.ticker && (h.exchange ?? "KRX") === r.exchange);
        if (existing) {
          existing.qty = r.qty;
          existing.avgPrice = r.avgPrice;
          if (existing.source === "kis") existing.name = r.name;
          updated++;
        } else {
          db.holdings.push({
            id: randomUUID(), kind: "stock", name: r.name, ticker: r.ticker, exchange: r.exchange,
            qty: r.qty, avgPrice: r.avgPrice, memo: "", source: "kis",
            createdAt: new Date().toISOString(),
          });
          added++;
        }
      }
      await saveDb();
      return json(res, 200, { added, updated, count: rows.length, ...(overseasError ? { overseasError } : {}) });
    } catch (e) {
      return json(res, 502, { error: e.message.slice(0, 200) });
    }
  }

  // ── 자산관리: 업비트 보유코인 동기화 ──
  if (p === "/api/sync/upbit" && req.method === "POST") {
    try {
      const rows = await upbitAccounts();
      let added = 0, updated = 0;
      for (const r of rows) {
        const existing = db.holdings.find((h) => h.kind === "crypto" && h.market === r.market);
        if (existing) {
          existing.qty = r.qty;
          existing.avgPrice = r.avgPrice;
          updated++;
        } else {
          db.holdings.push({
            id: randomUUID(), kind: "crypto", name: r.currency, market: r.market,
            qty: r.qty, avgPrice: r.avgPrice, memo: "", source: "upbit",
            createdAt: new Date().toISOString(),
          });
          added++;
        }
      }
      await saveDb();
      return json(res, 200, { added, updated, count: rows.length });
    } catch (e) {
      return json(res, 502, { error: e.message.slice(0, 200) });
    }
  }

  // ── 자산관리: 일별 순자산 스냅샷 (같은 날짜는 최신값으로 갱신) ──
  if (p === "/api/snapshot" && req.method === "POST") {
    const b = await readBody(req);
    if (!DATE_RE.test(String(b.date ?? ""))) return json(res, 400, { error: "invalid date" });
    const total = Math.round(Number(b.total));
    if (!Number.isFinite(total)) return json(res, 400, { error: "invalid total" });
    const byKind = b.byKind && typeof b.byKind === "object" && !Array.isArray(b.byKind) ? b.byKind : {};
    const idx = db.snapshots.findIndex((s) => s.date === b.date);
    const item = { date: b.date, total, byKind };
    if (idx >= 0) db.snapshots[idx] = item;
    else db.snapshots.push(item);
    db.snapshots.sort((a, z) => a.date.localeCompare(z.date));
    if (db.snapshots.length > 730) db.snapshots.splice(0, db.snapshots.length - 730);
    await saveDb();
    return json(res, 200, { item });
  }

  // ── AI 자연어 입력: 텍스트 → 거래 초안 ──
  if (p === "/api/ai-parse" && req.method === "POST") {
    const b = await readBody(req);
    const text = String(b.text ?? "").trim();
    if (!text) return json(res, 400, { error: "text required" });
    try {
      return json(res, 200, { drafts: await aiParse(text) });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ── AI 자동 분류: 메모·금액 → 기존 카테고리 중 하나 제안 ──
  if (p === "/api/ai/categorize" && req.method === "POST") {
    const b = await readBody(req);
    const memo = String(b.memo ?? "").trim();
    const amount = sanitizeAmount(b.amount);
    if (!memo && !amount) return json(res, 400, { error: "memo or amount required" });
    try {
      const categoryId = await aiCategorize({ memo, amount, kind: b.kind ?? b.type });
      return json(res, 200, { categoryId });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ── AI 월간 인사이트 (무인증 로컬 GET — 아침 브리핑 서버에서도 호출) ──
  if (p === "/api/ai/insights" && req.method === "GET") {
    const month = query.get("month") ?? todayStr().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return json(res, 400, { error: "invalid month" });
    const lang = AI_LANGS.has(query.get("lang")) ? query.get("lang") : "ko";
    try {
      return json(res, 200, await aiInsights(month, lang));
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ── 심화 AI: 현금흐름 예측·월말잔액 전망 (입력 없으면 이번 달·db 사용) ──
  if (p === "/api/ai/forecast" && req.method === "POST") {
    const b = await readBody(req);
    const month = /^\d{4}-\d{2}$/.test(String(b.month ?? "")) ? b.month : todayStr().slice(0, 7);
    const lang = AI_LANGS.has(b.lang) ? b.lang : "ko";
    try {
      await maybeApplySubscriptions();
      return json(res, 200, await aiForecast(month, lang));
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ── 심화 AI: 이상거래·중복결제 탐지 (db 자체 데이터 사용) ──
  if (p === "/api/ai/anomalies" && req.method === "POST") {
    const b = await readBody(req);
    const lang = AI_LANGS.has(b.lang) ? b.lang : "ko";
    try {
      return json(res, 200, await aiAnomalies(lang));
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ── AI 자연어 단건 파싱: 문장 → {date, amount, kind, categoryId, memo} ──
  // 상대 날짜(어제 등)는 aiParse가 프롬프트에 오늘 날짜를 주입해 해석한다.
  if (p === "/api/ai/parse-transaction" && req.method === "POST") {
    const b = await readBody(req);
    const text = String(b.text ?? "").trim();
    if (!text) return json(res, 400, { error: "text required" });
    try {
      const drafts = await aiParse(text);
      if (drafts.length === 0) return json(res, 422, { error: "no transaction recognized" });
      const d = drafts[0];
      return json(res, 200, { draft: { date: d.date, amount: d.amount, kind: d.type, categoryId: d.categoryId, memo: d.memo } });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ── SMS 붙여넣기 파싱: 정규식 우선, 실패분 AI 폴백 ──
  if (p === "/api/sms-parse" && req.method === "POST") {
    const b = await readBody(req);
    const text = String(b.text ?? "").trim();
    if (!text) return json(res, 400, { error: "text required" });
    const { drafts, failed } = parseSmsBlocks(text);
    if (failed.length > 0 && b.aiFallback !== false) {
      try { drafts.push(...await aiParse(failed.join("\n\n"))); } catch { /* 정규식 결과만 반환 */ }
    }
    return json(res, 200, { drafts });
  }

  // ── Messages 스캔 (chat.db) ──
  if (p === "/api/sms-scan" && req.method === "GET") {
    try {
      return json(res, 200, { items: await scanMessagesDb(Number(query.get("days")) || 30) });
    } catch (e) {
      return json(res, e.message === "no_access" ? 403 : 502, { error: e.message });
    }
  }
  if (p === "/api/sms-dismiss" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.guid) return json(res, 400, { error: "guid required" });
    markSmsHandled(String(b.guid));
    await saveDb();
    return json(res, 200, { ok: true });
  }

  // ── 데어스 브리핑 요약 (아침 브리핑 스킬이 조회) ──
  if (p === "/api/briefing" && req.method === "GET") {
    await maybeApplySubscriptions();
    const today = todayStr();
    const ym = today.slice(0, 7);
    const yd = new Date();
    yd.setDate(yd.getDate() - 1);
    const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`;
    const catName = (id) => db.categories.find((c) => c.id === id)?.name.ko ?? "기타";
    const yTx = db.transactions.filter((t) => t.date === yesterday && t.type === "expense");
    const yByCat = {};
    for (const t of yTx) yByCat[catName(t.categoryId)] = (yByCat[catName(t.categoryId)] ?? 0) + t.amount;
    const mTx = db.transactions.filter((t) => ymOfStr(t.date) === ym);
    const mExpense = mTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const mIncome = mTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const budgetTotal = Object.values(db.budgets).reduce((s, v) => s + v, 0);
    const overBudget = Object.entries(db.budgets)
      .map(([catId, budget]) => {
        const spent = mTx.filter((t) => t.type === "expense" && t.categoryId === catId).reduce((s, t) => s + t.amount, 0);
        return { category: catName(catId), budget, spent };
      })
      .filter((x) => x.spent > x.budget * 0.8)
      .map((x) => ({ ...x, over: x.spent > x.budget }));
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const weekStr = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`;
    const upcoming = db.subscriptions
      .filter((s) => s.active)
      .map((s) => ({ name: s.name, amount: s.amount, nextBilling: nextBillingOf(s) }))
      .filter((s) => s.nextBilling >= today && s.nextBilling <= weekStr)
      .sort((a, b) => (a.nextBilling < b.nextBilling ? -1 : 1));
    const subMonthly = db.subscriptions.filter((s) => s.active)
      .reduce((s, x) => s + (x.cycle === "monthly" ? x.amount : Math.round(x.amount / 12)), 0);
    return json(res, 200, {
      date: today,
      yesterday: { date: yesterday, expenseTotal: yTx.reduce((s, t) => s + t.amount, 0), byCategory: yByCat, count: yTx.length },
      monthToDate: { ym, expense: mExpense, income: mIncome, budgetTotal, budgetUsedPct: budgetTotal > 0 ? Math.round((mExpense / budgetTotal) * 100) : null },
      budgetAlerts: overBudget,
      upcomingSubscriptions: upcoming,
      subscriptionMonthlyTotal: subMonthly,
    });
  }

  // ── CSV 내보내기 (전체 거래) ──
  if (p === "/api/export.csv" && req.method === "GET") {
    const cat = new Map(db.categories.map((c) => [c.id, c.name?.ko ?? c.id]));
    const asset = new Map(db.assets.map((a) => [a.id, a.name]));
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [["date", "type", "amount", "category", "asset", "toAsset", "memo"].join(",")];
    const sorted = [...db.transactions].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    for (const t of sorted) {
      rows.push([
        t.date, t.type, t.amount,
        esc(cat.get(t.categoryId) ?? ""), esc(asset.get(t.assetId) ?? ""),
        esc(asset.get(t.toAssetId) ?? ""), esc(t.memo),
      ].join(","));
    }
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ledger-${todayStr()}.csv"`,
    });
    return res.end("﻿" + rows.join("\n"));
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
if (applyDueSubscriptions()) await saveDb();
server.listen(PORT, "127.0.0.1", () => console.log(`ledger on http://127.0.0.1:${PORT} prefix=${PREFIX} tx=${db.transactions.length}`));

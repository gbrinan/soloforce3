// AppData MCP 서버 — 앱(ledger/bookshelf/booking/diary/learn) 데이터를 지니가 통합 질의 (읽기 전용)
// 호스트 앱 프록시(/api/apps/:id/proxy/api/...) 경유 GET만 수행 — 쓰기 툴 없음.
// 앱 포트·기동·헬스는 app-registry/app-proxy가 관리하므로 여기선 호스트 베이스만 알면 된다.
// 환경변수:
//   MCP_APPDATA_BASE_URL  호스트 서버 베이스 (예: http://127.0.0.1:3456)
//   MCP_APPDATA_APPS      설치된 앱 id 콤마 목록 — 목록에 없는 앱의 툴은 미등록

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.MCP_APPDATA_BASE_URL || "http://127.0.0.1:3456";
const APPS = new Set(
  (process.env.MCP_APPDATA_APPS || "ledger,bookshelf,booking,diary,learn,projects")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

async function getJson<T>(appId: string, apiPath: string): Promise<T> {
  const url = `${BASE_URL}/api/apps/${appId}/proxy${apiPath}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`GET ${url} → HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `조회 실패: ${e instanceof Error ? e.message : String(e)}` }],
});

const server = new McpServer({ name: "appdata", version: "0.1.0" });

// ── ledger: 가계부 거래/집계 (GET /api/state 후 로컬 필터·집계) ─────────────────
interface LedgerTx { id: string; type: "expense" | "income" | "transfer"; amount: number; categoryId: string | null; memo: string; date: string; }
interface LedgerCategory { id: string; kind: string; emoji?: string; name?: { ko?: string; en?: string; ja?: string }; }
interface LedgerState { transactions: LedgerTx[]; categories: LedgerCategory[]; budgets: Record<string, number>; subscriptions: Array<{ name: string; amount: number; cycle?: string; active?: boolean }>; }

if (APPS.has("ledger")) {
  server.tool(
    "ledger_query",
    {
      month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("조회 월 (YYYY-MM). from/to보다 우선"),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("시작일 (YYYY-MM-DD, 포함)"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("종료일 (YYYY-MM-DD, 포함)"),
      categoryId: z.string().optional().describe("카테고리 id 필터 (예: food, salary)"),
    },
    async ({ month, from, to, categoryId }) => {
      try {
        const state = await getJson<LedgerState>("ledger", "/api/state");
        const catName = new Map(state.categories.map((c) => [c.id, c.name?.ko ?? c.id]));
        let txs = state.transactions;
        if (month) txs = txs.filter((t) => t.date.startsWith(month));
        else {
          if (from) txs = txs.filter((t) => t.date >= from);
          if (to) txs = txs.filter((t) => t.date <= to);
        }
        if (categoryId) txs = txs.filter((t) => t.categoryId === categoryId);
        const sum = (type: LedgerTx["type"]) => txs.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
        const byCategory: Record<string, { name: string; type: string; total: number; count: number }> = {};
        for (const t of txs) {
          if (t.type === "transfer") continue;
          const key = t.categoryId ?? "(없음)";
          const e = byCategory[key] ?? { name: catName.get(key) ?? key, type: t.type, total: 0, count: 0 };
          e.total += t.amount; e.count += 1;
          byCategory[key] = e;
        }
        return ok({
          range: month ?? { from: from ?? null, to: to ?? null },
          totals: { income: sum("income"), expense: sum("expense"), net: sum("income") - sum("expense") },
          byCategory,
          transactionCount: txs.length,
          transactions: txs.slice(0, 200).map((t) => ({
            date: t.date, type: t.type, amount: t.amount,
            category: t.categoryId ? catName.get(t.categoryId) ?? t.categoryId : null, memo: t.memo,
          })),
        });
      } catch (e) { return fail(e); }
    },
  );
}

// ── bookshelf: 책 목록/읽기 상태 (GET /api/books) ──────────────────────────────
interface Book { id: string; title: string; authors: string[]; status: "todo" | "reading" | "done"; rating: number; liked: boolean; memo: string; addedAt: string; }

if (APPS.has("bookshelf")) {
  server.tool(
    "bookshelf_query",
    {
      status: z.enum(["todo", "reading", "done"]).optional().describe("읽기 상태 필터 (todo=읽을 예정, reading=읽는 중, done=완독)"),
      search: z.string().optional().describe("제목·저자 부분 일치 검색어"),
    },
    async ({ status, search }) => {
      try {
        const { items } = await getJson<{ items: Book[] }>("bookshelf", "/api/books");
        let books = items;
        if (status) books = books.filter((b) => b.status === status);
        if (search) {
          const q = search.toLowerCase();
          books = books.filter((b) => b.title.toLowerCase().includes(q) || b.authors.some((a) => a.toLowerCase().includes(q)));
        }
        const byStatus: Record<string, number> = {};
        for (const b of items) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
        return ok({
          total: items.length,
          byStatus,
          matched: books.length,
          items: books.slice(0, 200).map((b) => ({
            title: b.title, authors: b.authors, status: b.status,
            rating: b.rating, liked: b.liked, memo: b.memo, addedAt: b.addedAt,
          })),
        });
      } catch (e) { return fail(e); }
    },
  );
}

// ── booking: 예약 조회 (GET /api/bookings[?date=]) ─────────────────────────────
interface Booking { id: string; date: string; start: string; end: string; name: string; email: string; phone?: string; eventTypeId?: string; }

if (APPS.has("booking")) {
  server.tool(
    "booking_query",
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("조회 날짜 (YYYY-MM-DD). 생략 시 전체"),
    },
    async ({ date }) => {
      try {
        const bookings = await getJson<Booking[]>("booking", `/api/bookings${date ? `?date=${date}` : ""}`);
        return ok({
          count: bookings.length,
          bookings: bookings.slice(0, 200).map((b) => ({
            date: b.date, start: b.start, end: b.end, name: b.name, email: b.email, phone: b.phone ?? null,
          })),
        });
      } catch (e) { return fail(e); }
    },
  );
}

// ── diary: 일기·무드 조회 (GET /api/entries) ──────────────────────────────────
interface DiaryEntry { id: string; date: string; content: string; mood: string; template?: string; aiReflection: { emotions?: Array<{ label: string; intensity: number }>; comment?: string } | null; }

if (APPS.has("diary")) {
  server.tool(
    "diary_query",
    {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("시작일 (YYYY-MM-DD, 포함)"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("종료일 (YYYY-MM-DD, 포함)"),
      mood: z.string().optional().describe("무드 slug 필터 (happy/calm/excited/neutral/thinking/sad/angry/tired)"),
    },
    async ({ from, to, mood }) => {
      try {
        const { items } = await getJson<{ items: DiaryEntry[] }>("diary", "/api/entries");
        let entries = items;
        if (from) entries = entries.filter((e) => e.date >= from);
        if (to) entries = entries.filter((e) => e.date <= to);
        if (mood) entries = entries.filter((e) => e.mood === mood);
        const byMood: Record<string, number> = {};
        for (const e of items) if (e.mood) byMood[e.mood] = (byMood[e.mood] ?? 0) + 1;
        entries = entries.slice().sort((a, b) => b.date.localeCompare(a.date));
        return ok({
          total: items.length,
          byMood,
          matched: entries.length,
          entries: entries.slice(0, 100).map((e) => ({
            date: e.date,
            mood: e.mood || null,
            template: e.template ?? "basic",
            excerpt: String(e.content).replace(/^##\s+/gm, "").slice(0, 300),
            emotions: e.aiReflection?.emotions?.map((x) => x.label) ?? [],
            comment: e.aiReflection?.comment ?? null,
          })),
        });
      } catch (e) { return fail(e); }
    },
  );
}

// ── learn: 학습 덱·통계 조회 (GET /api/decks, /api/stats) ──────────────────────
interface DeckSummary { id: string; title: string; summary: string; cardCount: number; dueCount: number; newCount: number; quizCount: number; createdAt: string; source: { type: string; title: string }; }
interface LearnStats { todayReviews: number; dueCount: number; totalCards: number; deckCount: number; streak: number; }

if (APPS.has("learn")) {
  server.tool(
    "learn_query",
    {
      search: z.string().optional().describe("덱 제목·요약 부분 일치 검색어"),
    },
    async ({ search }) => {
      try {
        const [decksRes, stats] = await Promise.all([
          getJson<{ items: DeckSummary[] }>("learn", "/api/decks"),
          getJson<LearnStats>("learn", "/api/stats"),
        ]);
        let decks = decksRes.items;
        if (search) {
          const q = search.toLowerCase();
          decks = decks.filter((d) => d.title.toLowerCase().includes(q) || d.summary.toLowerCase().includes(q));
        }
        return ok({
          stats,
          deckCount: decksRes.items.length,
          matched: decks.length,
          decks: decks.slice(0, 100).map((d) => ({
            title: d.title,
            summary: d.summary,
            source: d.source,
            cards: d.cardCount,
            due: d.dueCount,
            new: d.newCount,
            quiz: d.quizCount,
            createdAt: d.createdAt,
          })),
        });
      } catch (e) { return fail(e); }
    },
  );
}

// ── projects: 고객사 프로젝트 조회 (GET /api/projects) — 읽기 전용 M1 ──────────
if (APPS.has("projects")) {
  server.tool(
    "projects_query",
    {
      category: z.string().optional().describe("카테고리 필터(education|ax-consulting|ax-research|spf)"),
      search: z.string().optional().describe("고객사·프로젝트명 부분일치"),
    },
    async ({ category, search }) => {
      try {
        const qs = new URLSearchParams();
        if (category) qs.set("category", category);
        if (search) qs.set("search", search);
        const { projects } = await getJson<{ projects: Array<{ category: string; slug: string; name: string; client: string | null; status: string | null; sessions: unknown; domain: string[] }> }>("projects", `/api/projects${qs.toString() ? `?${qs}` : ""}`);
        return ok({ total: projects.length, matched: projects.length, projects: projects.slice(0, 200).map((p) => ({ category: p.category, name: p.name, client: p.client, status: p.status, sessions: p.sessions, domain: p.domain })) });
      } catch (e) { return fail(e); }
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);

// Query bridge for semantic search — CLIP is English-centric, so Korean (or
// other non-English) queries are translated to a short English search phrase
// via the shared @mycrew/ai-client (gateway-aware).
// Translation failure/timeout falls back to the original query.
// Also extracts relative date expressions ("작년", "지난달", "2024년" …) so the
// route can combine semantic similarity with an EXIF taken_at date filter.
// 공용 @mycrew/ai-client 경유 — 게이트웨이 모드 시 호스트 위임(인증·레이트리밋·비용집계).
import { runClaude as runShared } from '@mycrew/ai-client/node';

const TRANSLATE_TIMEOUT_MS = 20_000;

// query → english phrase cache (per process; queries are short + repetitive)
const translateCache = new Map();
const CACHE_MAX = 200;

const NON_ASCII_RE = /[^\x00-\x7F]/;

/** True if the query needs translation before CLIP embedding. */
export function needsTranslation(query) {
  return NON_ASCII_RE.test(query);
}

/**
 * Translate a natural-language query to a short English CLIP search phrase.
 * Falls back to the original query on any failure.
 * @param {string} query
 * @returns {Promise<{ text: string, translated: boolean }>}
 */
export async function toClipQuery(query) {
  const q = query.trim();
  if (!q || !needsTranslation(q)) return { text: q, translated: false };
  if (translateCache.has(q)) return { text: translateCache.get(q), translated: true };

  const prompt = 'Translate this photo search query into a short English phrase suitable '
    + 'for CLIP image search (a few words, no quotes, no explanation). '
    + 'Ignore date words like last year or months — describe only the visual content.\n\n'
    + `Query: ${q}\n\nEnglish phrase:`;

  try {
    const out = await runShared(prompt, {
      appId: 'photos', feature: 'translate-query', timeoutMs: TRANSLATE_TIMEOUT_MS,
    });
    const text = String(out).trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
    if (!text || text.length > 120) return { text: q, translated: false };
    if (translateCache.size >= CACHE_MAX) {
      translateCache.delete(translateCache.keys().next().value);
    }
    translateCache.set(q, text);
    return { text, translated: true };
  } catch (e) {
    console.warn('[query-bridge] translate fallback:', e?.message || e);
    return { text: q, translated: false };
  }
}

function yearRange(year) {
  return {
    startMs: new Date(year, 0, 1).getTime(),
    endMs: new Date(year + 1, 0, 1).getTime() - 1,
  };
}

function monthRange(year, month /* 0-based */) {
  return {
    startMs: new Date(year, month, 1).getTime(),
    endMs: new Date(year, month + 1, 1).getTime() - 1,
  };
}

/**
 * Extract a date range from relative/absolute date words in the query.
 * Recognized tokens are stripped so CLIP only sees the visual description.
 * @param {string} query
 * @param {Date} [now]
 * @returns {{ query: string, startMs: number|null, endMs: number|null }}
 */
export function extractDateRange(query, now = new Date()) {
  let q = query;
  let range = null;
  const y = now.getFullYear();

  const rules = [
    { re: /재작년|the year before last/i, get: () => yearRange(y - 2) },
    { re: /작년|last year/i, get: () => yearRange(y - 1) },
    { re: /올해|this year/i, get: () => yearRange(y) },
    {
      re: /지난\s?달|last month/i,
      get: () => monthRange(now.getMonth() === 0 ? y - 1 : y, (now.getMonth() + 11) % 12),
    },
    { re: /이번\s?달|this month/i, get: () => monthRange(y, now.getMonth()) },
    { re: /(20\d{2})년/, get: (m) => yearRange(Number(m[1])) },
  ];

  for (const rule of rules) {
    const m = q.match(rule.re);
    if (m) {
      range = rule.get(m);
      q = q.replace(rule.re, ' ');
      break; // one date expression per query is enough
    }
  }

  return {
    query: q.replace(/\s{2,}/g, ' ').trim(),
    startMs: range ? range.startMs : null,
    endMs: range ? range.endMs : null,
  };
}

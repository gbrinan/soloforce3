// Frankfurter — ECB 환율 조회 (No-auth, 무료, CORS 허용).
// 공식: https://www.frankfurter.app/
// 엔드포인트:
//   GET https://api.frankfurter.app/latest?from=USD&to=KRW
//   GET https://api.frankfurter.app/{YYYY-MM-DD}?from=USD&to=KRW
// 4xx/5xx 및 네트워크/파싱 오류는 throw.

const BASE_URL = "https://api.frankfurter.app";
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "mycrew-poc/1.0";

export interface ExchangeRate {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

export async function getExchangeRate(from: string, to: string, date?: string): Promise<ExchangeRate> {
  const path = date ? `/${encodeURIComponent(date)}` : "/latest";
  const url = `${BASE_URL}${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`frankfurter status=${res.status}`);
    return (await res.json()) as ExchangeRate;
  } finally {
    clearTimeout(timer);
  }
}

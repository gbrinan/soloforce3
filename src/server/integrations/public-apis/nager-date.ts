// Nager.Date v3 — 한국 공휴일 조회 (No-auth, 무료).
// 공식: https://date.nager.at/
// 엔드포인트: GET https://date.nager.at/api/v3/PublicHolidays/{year}/KR
// 4xx/5xx 및 네트워크/파싱 오류는 throw.

const BASE_URL = "https://date.nager.at/api/v3";
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "mycrew-poc/1.0";

export interface PublicHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  types: string[];
}

export async function getKoreanHolidays(year: number): Promise<PublicHoliday[]> {
  const url = `${BASE_URL}/PublicHolidays/${year}/KR`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`nager-date status=${res.status}`);
    return (await res.json()) as PublicHoliday[];
  } finally {
    clearTimeout(timer);
  }
}

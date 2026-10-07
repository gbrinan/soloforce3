import type { Locale } from "./i18n";

// value = IANA tz, abbr = 로케일 무관 표준 약어(있는 경우), city = 로케일별 도시명.
// 하드코딩 한국어 라벨 대신 timezoneOptions(locale)로 로케일별 라벨을 생성한다.
const TZ_DEFS: { value: string; abbr?: string; city: Record<Locale, string> }[] = [
  { value: "Asia/Seoul", abbr: "KST, UTC+9", city: { ko: "서울", en: "Seoul", ja: "ソウル" } },
  { value: "Asia/Tokyo", abbr: "JST, UTC+9", city: { ko: "도쿄", en: "Tokyo", ja: "東京" } },
  { value: "Asia/Shanghai", abbr: "CST, UTC+8", city: { ko: "상하이", en: "Shanghai", ja: "上海" } },
  { value: "Asia/Singapore", abbr: "SGT, UTC+8", city: { ko: "싱가포르", en: "Singapore", ja: "シンガポール" } },
  { value: "Asia/Kolkata", abbr: "IST, UTC+5:30", city: { ko: "뭄바이", en: "Mumbai", ja: "ムンバイ" } },
  { value: "Europe/London", abbr: "GMT/BST", city: { ko: "런던", en: "London", ja: "ロンドン" } },
  { value: "Europe/Paris", abbr: "CET/CEST", city: { ko: "파리", en: "Paris", ja: "パリ" } },
  { value: "UTC", city: { ko: "UTC", en: "UTC", ja: "UTC" } },
  { value: "America/New_York", abbr: "EST/EDT", city: { ko: "뉴욕", en: "New York", ja: "ニューヨーク" } },
  { value: "America/Chicago", abbr: "CST/CDT", city: { ko: "시카고", en: "Chicago", ja: "シカゴ" } },
  { value: "America/Denver", abbr: "MST/MDT", city: { ko: "덴버", en: "Denver", ja: "デンバー" } },
  { value: "America/Los_Angeles", abbr: "PST/PDT", city: { ko: "로스앤젤레스", en: "Los Angeles", ja: "ロサンゼルス" } },
  { value: "America/Sao_Paulo", abbr: "BRT", city: { ko: "상파울루", en: "São Paulo", ja: "サンパウロ" } },
  { value: "Australia/Sydney", abbr: "AEST/AEDT", city: { ko: "시드니", en: "Sydney", ja: "シドニー" } },
  { value: "Pacific/Auckland", abbr: "NZST/NZDT", city: { ko: "오클랜드", en: "Auckland", ja: "オークランド" } },
];

// 로케일별 타임존 선택지 — { value, label } 형태 (Mantine Select data).
export function timezoneOptions(locale: Locale): { value: string; label: string }[] {
  return TZ_DEFS.map((d) => ({
    value: d.value,
    label: d.abbr ? `${d.city[locale]} (${d.abbr})` : d.city[locale],
  }));
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "Asia/Seoul";
  }
}

// Short abbreviation, e.g. "KST", "UTC", "EST"
export function tzAbbr(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

// Convert local datetime in a timezone to UTC Date (2-iteration, handles DST)
function localToUTC(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, h, min));

  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const lh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const lm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const diff = h * 60 + min - (lh === 24 ? 0 : lh) * 60 - lm;
    if (diff === 0) break;
    guess = new Date(guess.getTime() - diff * 60000);
  }
  return guess;
}

// Convert HH:MM on YYYY-MM-DD from one timezone to another, returns HH:MM
export function convertSlotTz(
  dateStr: string,
  timeStr: string,
  fromTz: string,
  toTz: string,
): string {
  try {
    const utc = localToUTC(dateStr, timeStr, fromTz);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: toTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(utc);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h === "24" ? "00" : h}:${m}`;
  } catch {
    return timeStr;
  }
}

// Format time with TZ abbreviation: "14:00 (KST)"
export function formatTimeLabel(time: string, tz: string): string {
  return `${time} (${tzAbbr(tz)})`;
}

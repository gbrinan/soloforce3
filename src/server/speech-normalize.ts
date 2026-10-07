// 한국어 TTS 발음 정규화 — Supertonic이 잘못 읽는 패턴을 한글로 풀어 쓴다.
// 2026-08-26 TTS→STT 왕복 실측으로 확인된 깨짐:
//   "3.14" → "3.24"          (소수점 오독)
//   "v0.2.33" → "배웜 2.2.33" (v 접두 버전)
//   "—", "「」", "·", "(...)"  → 엉뚱한 음절이 되거나 문장을 끊음
// 규칙 순서가 중요하다: 단위(3.2GB)를 소수 분해보다 먼저 처리해야 온전히 잡힌다.
const SINO = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];

function digitsToSino(s: string): string {
  return s.split("").map((c) => (/[0-9]/.test(c) ? SINO[Number(c)] : c)).join("");
}

const UNIT_NAMES: Record<string, string> = {
  gb: "기가바이트", mb: "메가바이트", kb: "킬로바이트", tb: "테라바이트",
};

const ABBR: Record<string, string> = {
  API: "에이피아이", SSE: "에스에스이", TTS: "티티에스", STT: "에스티티",
  VAD: "브이에이디", PR: "피알", QA: "큐에이", CTO: "씨티오", URL: "유알엘",
  JSON: "제이슨", HTTP: "에이치티티피", CPU: "씨피유", GPU: "지피유", ID: "아이디",
};

export function normalizeForSpeech(input: string): string {
  let t = input;

  // 1) 버전 표기: v0.2.33 → "버전 영 점 이 점 삼삼"
  t = t.replace(/\bv(\d+(?:\.\d+)+)\b/gi, (_m, ver: string) =>
    `버전 ${String(ver).split(".").map(digitsToSino).join(" 점 ")}`);

  // 2) 단위 — 소수 분해보다 먼저
  t = t.replace(/(\d+(?:\.\d+)?)\s?%/g, "$1 퍼센트");
  t = t.replace(/(\d+(?:\.\d+)?)\s?(GB|MB|KB|TB)\b/gi, (_m, n: string, u: string) =>
    `${n} ${UNIT_NAMES[u.toLowerCase()]}`);
  t = t.replace(/(\d+(?:\.\d+)?)\s?ms\b/g, "$1 밀리초");

  // 3) 점 3개 이상 버전형: 1.2.3 → "일 점 이 점 삼"
  t = t.replace(/\b\d+(?:\.\d+){2,}\b/g, (m: string) =>
    m.split(".").map(digitsToSino).join(" 점 "));

  // 4) 소수: 3.14 → "삼 점 일사" (정수부도 한글로)
  t = t.replace(/(?<![\d.])(\d+)\.(\d+)(?![\d.])/g, (_m, a: string, b: string) =>
    `${digitsToSino(a)} 점 ${digitsToSino(b)}`);

  // 5) 시각 14:30 → "14시 30분"
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, mi: string) =>
    `${Number(h)}시 ${Number(mi)}분`);

  // 6) 문장을 끊거나 오발음되는 기호 정리
  t = t.replace(/[—–―]/g, ", ");
  t = t.replace(/[「」『』《》〈〉""'']/g, "");
  t = t.replace(/[·•∙]/g, ", ");
  t = t.replace(/~+/g, " ");
  t = t.replace(/[()[\]{}]/g, " ");
  t = t.replace(/\s*\/\s*/g, ", ");

  // 7) 영문 약어 음차
  t = t.replace(/\b([A-Z]{2,5})\b/g, (m: string) => ABBR[m] ?? m);

  return t.replace(/\s+/g, " ").trim();
}

// 노트 글꼴 선택용 목록 유틸.
// Font Enumeration API(window.queryLocalFonts, Chrome 103+)가 있으면 단말기 설치 글꼴을,
// 없거나 권한 거부 시 폴백 목록을 사용한다.

export const FALLBACK_BODY_FONTS: string[] = [
  'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕',
  'Inter', 'Roboto', 'Source Sans Pro', 'Helvetica Neue', 'Arial',
];

export const FALLBACK_CODE_FONTS: string[] = [
  'IBM Plex Mono', 'Fira Code', 'JetBrains Mono', 'Source Code Pro', 'Consolas', 'Courier New', 'Monaco',
];

// Font Enumeration API 타입(표준 lib.dom.d.ts 미포함) — 최소 형태만 선언.
interface FontDataLike { family: string }

// 단말기 설치 글꼴 family 목록 조회. 미지원/권한거부/예외 시 null(→ 폴백 사용).
export async function queryAvailableFonts(): Promise<string[] | null> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<FontDataLike[]> }).queryLocalFonts;
  if (typeof q !== 'function') return null;
  try {
    const fonts = await q();
    const families = Array.from(new Set(fonts.map((f) => f.family).filter(Boolean)));
    families.sort((a, b) => a.localeCompare(b));
    return families;
  } catch {
    return null;
  }
}

// 옵션 병합 — 설치 목록(있으면) + 폴백 + 현재 저장값을 합쳐 중복 제거(순서: 현재값 우선 노출 X, 안정 정렬 유지).
// 현재 저장값이 어디에도 없어도 옵션에 포함시켜 Autocomplete 표시 일관성 보장.
export function mergeFontOptions(installed: string[] | null, fallback: string[], current: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (name: string) => {
    const n = name.trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  for (const f of (installed && installed.length ? installed : fallback)) push(f);
  // 설치 목록을 쓰는 경우에도 폴백의 주요 글꼴이 빠지지 않도록 보강.
  if (installed && installed.length) for (const f of fallback) push(f);
  if (current) push(current);
  return out;
}

// ── 구글 웹폰트 선택 지원 (API Key 불필요) ───────────────────────────────
// family를 CSS font-family로 그대로 사용하고, cssUrl을 동적 <link>로 주입해 로드한다.
// cssUrl이 null이면 외부 로드 없이 시스템/번들 폰트로 처리(Pretendard는 별도 CDN).
export interface FontDef {
  family: string;        // CSS font-family 및 저장값(셀렉트 value)
  cssUrl: string | null; // 스타일시트 URL(구글폰트/jsdelivr). null이면 동적 로드 안 함.
}

// 구글폰트 css2 URL 빌더 — 공백을 '+'로 인코딩, 400/600 weight + display=swap 고정.
function gf(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;600&display=swap`;
}

// 본문 글꼴 — 한국어 포함 + 라틴. 기본값 Pretendard(번들이지만 안전하게 CDN도 보유).
export const BODY_FONT_DEFS: FontDef[] = [
  { family: 'Pretendard', cssUrl: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css' },
  { family: 'Noto Sans KR', cssUrl: gf('Noto Sans KR') },
  { family: 'Nanum Gothic', cssUrl: gf('Nanum Gothic') },
  { family: 'Nanum Myeongjo', cssUrl: gf('Nanum Myeongjo') },
  { family: 'Gmarket Sans', cssUrl: gf('Gmarket Sans') },
  { family: 'IBM Plex Sans KR', cssUrl: gf('IBM Plex Sans KR') },
  { family: 'Inter', cssUrl: gf('Inter') },
  { family: 'Roboto', cssUrl: gf('Roboto') },
  { family: 'Lato', cssUrl: gf('Lato') },
  { family: 'Open Sans', cssUrl: gf('Open Sans') },
  { family: 'Source Sans Pro', cssUrl: gf('Source Sans Pro') },
];

// 코드 글꼴 — 모노스페이스. 기본값 IBM Plex Mono.
export const CODE_FONT_DEFS: FontDef[] = [
  { family: 'IBM Plex Mono', cssUrl: gf('IBM Plex Mono') },
  { family: 'JetBrains Mono', cssUrl: gf('JetBrains Mono') },
  { family: 'Fira Code', cssUrl: gf('Fira Code') },
  { family: 'Source Code Pro', cssUrl: gf('Source Code Pro') },
  { family: 'Roboto Mono', cssUrl: gf('Roboto Mono') },
  { family: 'Inconsolata', cssUrl: gf('Inconsolata') },
  { family: 'Space Mono', cssUrl: gf('Space Mono') },
];

// family → cssUrl 룩업(본문/코드 통합). 목록에 없으면 undefined.
const FONT_URL_BY_FAMILY: Map<string, string | null> = new Map(
  [...BODY_FONT_DEFS, ...CODE_FONT_DEFS].map((d) => [d.family, d.cssUrl]),
);
export function fontCssUrl(family: string): string | null {
  return FONT_URL_BY_FAMILY.get(family) ?? null;
}

// Select용 옵션({value,label}) — 저장값이 목록에 없으면 맨 앞에 추가(기존 호환).
export function fontSelectOptions(defs: FontDef[], current: string): { value: string; label: string }[] {
  const opts = defs.map((d) => ({ value: d.family, label: d.family }));
  const cur = current.trim();
  if (cur && !defs.some((d) => d.family === cur)) opts.unshift({ value: cur, label: cur });
  return opts;
}

// 동적 폰트 로드 — <head>에 stylesheet <link> 1회 주입. 중복/실패 모두 안전(graceful).
// 인터넷 없거나 CDN 실패 시 onerror 무시 → CSS font-family 폴백 체인으로 기본 폰트 유지.
export function ensureFontLoaded(family: string): void {
  if (typeof document === 'undefined') return;       // SSR/비브라우저 가드
  const fam = family.trim();
  if (!fam) return;
  const url = fontCssUrl(fam);
  if (!url) return;                                  // 목록 외(시스템 폰트 등) → 외부 로드 불필요
  const id = `dynamic-font-${fam.replace(/[^a-zA-Z0-9]/g, '-')}`;
  if (document.getElementById(id)) return;           // 이미 주입됨
  try {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.dynamicFont = fam;
    link.onerror = () => { /* 로드 실패 무시 — 폴백 폰트 유지 */ };
    document.head.appendChild(link);
  } catch {
    // ignore — 주입 실패해도 폴백 폰트로 동작.
  }
}

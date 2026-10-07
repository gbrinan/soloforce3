import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { messages, type Locale, type MessageKey } from './messages';

const STORAGE_KEY = 'jarvis-lang';

// navigator.languages 순회 첫 매치(ko/ja/en). 미지원 언어·감지 불가 시 en 폴백 (표준 언어 감지 규칙).
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  for (const lang of langs) {
    const l = lang.toLowerCase();
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

// 서버(앱 프록시)가 읽는 언어 쿠키 — 앱 iframe 요청의 Accept-Language를 마이크루 설정 언어로
// 덮어써서, 브라우저 언어가 달라도 로케일 라우팅 앱(계약 등)이 설정 언어를 따르게 한다.
function persistLocaleCookie(locale: Locale): void {
  try { document.cookie = `mycrew_lang=${locale}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* */ }
}

// 최초: localStorage 우선, 없으면 navigator 감지값을 저장 후 사용.
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en' || saved === 'ja') { persistLocaleCookie(saved); return saved; }
  } catch { /* localStorage 접근 불가 — 감지값 사용 */ }
  const detected = detectLocale();
  try { localStorage.setItem(STORAGE_KEY, detected); } catch { /* */ }
  persistLocaleCookie(detected);
  return detected;
}

// 보간 변수 — 메시지 내 {name} 형태 placeholder를 치환.
type TVars = Record<string, string | number>;

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: MessageKey, vars?: TVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* */ }
    persistLocaleCookie(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: TVars) => {
      // 번역 누락 시 한국어 fallback, 그래도 없으면 키 자체 반환.
      let s = messages[locale][key] ?? messages.ko[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.split(`{${k}}`).join(String(v));
        }
      }
      return s;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

// 라벨만 필요한 곳에서 간편 호출.
export function useT(): (key: MessageKey, vars?: TVars) => string {
  return useI18n().t;
}

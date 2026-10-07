"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import ko from "@/messages/ko.json";
import en from "@/messages/en.json";
import ja from "@/messages/ja.json";

export type Locale = "ko" | "en" | "ja";

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { ko, en, ja };
const STORAGE_KEY = "mymovie.locale";
// MyCrew host stores its locale here; iframe is same-origin so we share localStorage.
const HOST_STORAGE_KEY = "jarvis-lang";

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  // Follow MyCrew host's language setting first.
  const host = window.localStorage.getItem(HOST_STORAGE_KEY);
  if (host === "ko" || host === "en" || host === "ja") return host;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "ko" || saved === "en" || saved === "ja") return saved;
  const langs = window.navigator.languages?.length
    ? window.navigator.languages
    : [window.navigator.language || ""];
  for (const lang of langs) {
    const l = lang.toLowerCase();
    if (l.startsWith("ko")) return "ko";
    if (l.startsWith("ja")) return "ja";
    if (l.startsWith("en")) return "en";
  }
  return "en"; // 미지원 언어는 en 폴백 (표준 언어 감지 규칙)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ko");

  useEffect(() => {
    setLocaleState(detectInitialLocale());
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
  };

  const t = useMemo(() => {
    const dict = DICTS[locale];
    return (key: string) => dict[key] ?? key;
  }, [locale]);

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}

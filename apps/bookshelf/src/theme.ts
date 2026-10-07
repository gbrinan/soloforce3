import { useEffect, useState } from "react";

// 마이크루 대시보드와 동일한 컬러 스킴 키 공유 (light|dark|auto).
// 프록시 경유 시 same-origin이라 localStorage 직접 읽기 + storage 이벤트 동기화.
// auto/미설정 시 시스템(prefers-color-scheme) 추종.
const STORAGE_KEY = "jarvis-color-scheme";
export type Scheme = "light" | "dark";

function systemScheme(): Scheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readScheme(): Scheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* */ }
  return systemScheme();
}

export function useColorScheme(): Scheme {
  const [scheme, setScheme] = useState<Scheme>(readScheme);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setScheme(readScheme());
    };
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMedia = () => setScheme(readScheme());
    window.addEventListener("storage", onStorage);
    mq?.addEventListener?.("change", onMedia);
    return () => {
      window.removeEventListener("storage", onStorage);
      mq?.removeEventListener?.("change", onMedia);
    };
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", scheme);
  }, [scheme]);
  return scheme;
}

"use client";

import { useEffect, useState } from "react";

// 마이크루 대시보드와 동일한 로케일 체계 (ko/en/ja) + 동일 localStorage 키.
// 프록시 경유 시 대시보드와 same-origin이라 키를 직접 읽고 storage 이벤트로
// 실시간 동기화된다. 직접 접속 시 navigator 감지. (apps/learn/src/i18n.ts 패턴)
// Next.js 클라이언트 컴포넌트용: SSR에서는 "ko"를 반환하고, hydration 후
// useEffect에서 실제 로케일로 전환한다 (hydration mismatch 방지).
export type Locale = "ko" | "en" | "ja";
const STORAGE_KEY = "jarvis-lang";

const MESSAGES = {
  ko: {
    "note.untitled": "제목 없음",
    "page.sidebar.expand": "노트 목록 펼치기",
    "page.sidebar.collapse": "노트 목록 접기",
    "page.emptyEditor": "+ 버튼을 눌러 새 노트를 만드세요",
    "list.title": "노트",
    "list.new": "새 노트",
    "list.noContent": "내용 없음",
    "list.more": "더보기",
    "list.mail": "메일로 보내기",
    "list.delete": "삭제",
    "list.deleteConfirm": "'{title}' 노트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    "list.empty": "노트가 없습니다. + 버튼으로 새 노트를 만드세요.",
    "editor.aiEmpty": "내용이 비어 있어 정리할 수 없습니다.",
    "editor.requestFail": "요청 실패 ({status})",
    "editor.aiFail": "AI 정리 실패",
    "editor.aiButton": "AI 요약/정리",
    "editor.titleSuggestion": "제목 제안: {title}",
    "editor.apply": "적용",
    "editor.summary": "요약",
  },
  en: {
    "note.untitled": "Untitled",
    "page.sidebar.expand": "Expand note list",
    "page.sidebar.collapse": "Collapse note list",
    "page.emptyEditor": "Press + to create a new note",
    "list.title": "Notes",
    "list.new": "New note",
    "list.noContent": "No content",
    "list.more": "More",
    "list.mail": "Send via email",
    "list.delete": "Delete",
    "list.deleteConfirm": "Delete note '{title}'? This cannot be undone.",
    "list.empty": "No notes yet. Press + to create one.",
    "editor.aiEmpty": "The note is empty — nothing to organize.",
    "editor.requestFail": "Request failed ({status})",
    "editor.aiFail": "AI cleanup failed",
    "editor.aiButton": "AI Summarize",
    "editor.titleSuggestion": "Suggested title: {title}",
    "editor.apply": "Apply",
    "editor.summary": "Summary",
  },
  ja: {
    "note.untitled": "無題",
    "page.sidebar.expand": "ノート一覧を開く",
    "page.sidebar.collapse": "ノート一覧を閉じる",
    "page.emptyEditor": "+ ボタンで新しいノートを作成",
    "list.title": "ノート",
    "list.new": "新規ノート",
    "list.noContent": "内容なし",
    "list.more": "その他",
    "list.mail": "メールで送る",
    "list.delete": "削除",
    "list.deleteConfirm": "『{title}』を削除しますか？この操作は元に戻せません。",
    "list.empty": "ノートがありません。+ ボタンで作成してください。",
    "editor.aiEmpty": "内容が空のため整理できません。",
    "editor.requestFail": "リクエスト失敗（{status}）",
    "editor.aiFail": "AI整理に失敗しました",
    "editor.aiButton": "AI要約・整理",
    "editor.titleSuggestion": "タイトル提案: {title}",
    "editor.apply": "適用",
    "editor.summary": "要約",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["ko"];

function detectLocale(): Locale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ""];
  for (const lang of langs) {
    const l = lang.toLowerCase();
    if (l.startsWith("ko")) return "ko";
    if (l.startsWith("ja")) return "ja";
  }
  return "en";
}

function readLocale(): Locale {
  if (typeof window === "undefined") return "ko"; // SSR: 초기 렌더는 ko 고정
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ko" || saved === "en" || saved === "ja") return saved;
  } catch { /* */ }
  return detectLocale();
}

export function useI18n() {
  // hydration mismatch 방지: 서버/최초 클라이언트 렌더는 ko, 마운트 후 실제 로케일 적용
  const [locale, setLocale] = useState<Locale>("ko");
  useEffect(() => {
    setLocale(readLocale());
    // 대시보드에서 언어 변경 시 storage 이벤트로 실시간 반영 (same-origin)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLocale(readLocale());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const t = (key: MessageKey, vars?: Record<string, string | number>): string => {
    let msg: string = MESSAGES[locale][key] ?? MESSAGES.ko[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) msg = msg.replace(`{${k}}`, String(v));
    return msg;
  };
  return { locale, t };
}

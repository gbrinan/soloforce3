"use client";
import { useEffect, useState } from "react";

// 마이크루 대시보드와 동일한 로케일 체계 (ko/en/ja) + 동일 localStorage 키.
// 프록시 경유 시 대시보드와 same-origin이라 키를 직접 읽고
// storage 이벤트로 실시간 동기화된다. 직접 접속 시 navigator 감지.
export type Locale = "ko" | "en" | "ja";
const STORAGE_KEY = "jarvis-lang";

const MESSAGES = {
  ko: {
    "app.tagline": "디스크를 스캔해 정리 가능한 파일과 용량을 찾아 안전하게 비웁니다.",
    "scan.start": "스캔 시작",
    "scan.scanning": "스캔 중…",
    "scan.fail": "스캔 실패: {msg}",
    "safety.safe": "안전",
    "safety.caution": "주의",
    "safety.danger": "위험",
    "detail.noData": "데이터 없음",
    "detail.empty": "비어 있음",
    "detail.unsupported": "이 카테고리는 현재 플랫폼에서 지원되지 않습니다",
    "reveal.openFail": "열기 실패",
    "reveal.folderFail": "폴더 열기 실패: {msg}",
    "large.title": "대용량 파일",
    "large.guide": "{size} 이상 파일을 크기순으로 최대 {max}개 표시합니다. 체크 후 삭제하거나, 📂 아이콘으로 파일 위치를 열 수 있습니다.",
    "large.empty": "{size} 이상 파일 없음",
    "large.none": "{size} 이상 파일 없음",
    "large.selectAria": "{path} 선택",
    "large.openLocation": "파일 위치 열기",
    "large.openLocationAria": "{path} 위치 열기",
    "large.more": "외 {n}개 (상위 {max}개만 표시)",
    "large.checkedSummary": "{n}개 · {size}",
    "plan.noItems": "플랜을 만들 스캔 항목이 없습니다",
    "plan.fail": "플랜 생성 실패: {msg}",
    "plan.generate": "정리 플랜 생성",
    "plan.title": "정리 플랜 · 약 {mb} MB 확보",
    "plan.items": "{n}개 항목",
    "delete.button": "삭제하기 ({size})",
    "delete.fail": "삭제 실패: {msg}",
    "confirm.title": "{size}를 삭제할까요?",
    "confirm.detail": "선택한 {categories}개 카테고리 + 파일 {files}개",
    "confirm.warning": "이 작업은 되돌릴 수 없습니다. (기본 동작: 트래시로 이동)",
    "confirm.cancel": "취소",
    "confirm.ok": "삭제 확인",
    "toast.freed": "{size} 확보 완료",
    "filter.label": "정리 대상 설명 (AI 필터)",
    "filter.description": "자연어로 설명하면 AI가 스캔 필터로 바꿔줍니다",
    "filter.placeholder": '예: "6개월 안 쓴 대용량 영상"',
    "filter.convert": "필터로 변환",
    "filter.convertFail": "필터 변환 실패",
    "filter.convertFailMsg": "필터 변환 실패: {msg}",
    "filter.converted": "필터로 변환했습니다. 내용을 확인한 뒤 스캔하세요.",
    "filter.confirmHint": "변환된 필터 — 값을 확인·수정한 뒤 스캔을 시작하세요 (대용량 파일에 적용).",
    "filter.minSize": "최소 크기 (MB)",
    "filter.unusedDays": "미사용 기간 (일)",
    "filter.extensions": "확장자 (쉼표 구분)",
    "filter.pathIncludes": "경로 포함 (쉼표 구분)",
    "filter.reset": "필터 초기화",
    "categoryList.detail": "상세 보기",
    "categoryList.detailAria": "{label} 상세 보기",
    "donut.scanProgress": "스캔 진행률",
    "donut.beforeScan": "스캔 전",
    "donut.startPrompt": "스캔을 시작하세요",
    "donut.findHint": "정리 가능한 용량을 찾아드려요",
    "donut.diskUsage": "디스크 사용량",
    "category.downloads": "다운로드",
    "category.caches": "캐시",
    "category.logs": "로그",
    "category.trash": "휴지통",
    "category.browserCache": "브라우저 캐시",
    "category.mailDownloads": "메일 다운로드",
    "category.oldIosUpdates": "오래된 iOS 업데이트",
    "category.largeFiles": "대용량 파일",
  },
  en: {
    "app.tagline": "Scan your disk to find reclaimable files and free up space safely.",
    "scan.start": "Start Scan",
    "scan.scanning": "Scanning…",
    "scan.fail": "Scan failed: {msg}",
    "safety.safe": "Safe",
    "safety.caution": "Caution",
    "safety.danger": "Danger",
    "detail.noData": "No data",
    "detail.empty": "Empty",
    "detail.unsupported": "This category is not supported on the current platform",
    "reveal.openFail": "Failed to open",
    "reveal.folderFail": "Failed to open folder: {msg}",
    "large.title": "Large Files",
    "large.guide": "Shows up to {max} files of {size} or larger, sorted by size. Check files to delete them, or use the 📂 icon to open the file location.",
    "large.empty": "No files {size} or larger",
    "large.none": "No files of {size} or larger",
    "large.selectAria": "Select {path}",
    "large.openLocation": "Open file location",
    "large.openLocationAria": "Open location of {path}",
    "large.more": "{n} more (showing top {max} only)",
    "large.checkedSummary": "{n} files · {size}",
    "plan.noItems": "No scanned items to build a plan from",
    "plan.fail": "Failed to generate plan: {msg}",
    "plan.generate": "Generate Cleanup Plan",
    "plan.title": "Cleanup Plan · ~{mb} MB reclaimable",
    "plan.items": "{n} items",
    "delete.button": "Delete ({size})",
    "delete.fail": "Delete failed: {msg}",
    "confirm.title": "Delete {size}?",
    "confirm.detail": "{categories} selected categories + {files} files",
    "confirm.warning": "This action cannot be undone. (Default: move to Trash)",
    "confirm.cancel": "Cancel",
    "confirm.ok": "Confirm Delete",
    "toast.freed": "{size} freed",
    "filter.label": "Describe what to clean (AI filter)",
    "filter.description": "Describe in plain language and AI converts it into a scan filter",
    "filter.placeholder": 'e.g. "large videos unused for 6 months"',
    "filter.convert": "Convert to Filter",
    "filter.convertFail": "Filter conversion failed",
    "filter.convertFailMsg": "Filter conversion failed: {msg}",
    "filter.converted": "Converted to a filter. Review it, then start the scan.",
    "filter.confirmHint": "Converted filter — review or adjust the values, then start the scan (applies to Large Files).",
    "filter.minSize": "Min size (MB)",
    "filter.unusedDays": "Unused for (days)",
    "filter.extensions": "Extensions (comma-separated)",
    "filter.pathIncludes": "Path contains (comma-separated)",
    "filter.reset": "Reset Filter",
    "categoryList.detail": "View details",
    "categoryList.detailAria": "View details of {label}",
    "donut.scanProgress": "Scan progress",
    "donut.beforeScan": "Before scan",
    "donut.startPrompt": "Start a scan",
    "donut.findHint": "We'll find reclaimable space for you",
    "donut.diskUsage": "Disk usage",
    "category.downloads": "Downloads",
    "category.caches": "Caches",
    "category.logs": "Logs",
    "category.trash": "Trash",
    "category.browserCache": "Browser Cache",
    "category.mailDownloads": "Mail Downloads",
    "category.oldIosUpdates": "Old iOS Updates",
    "category.largeFiles": "Large Files",
  },
  ja: {
    "app.tagline": "ディスクをスキャンして整理できるファイルと容量を見つけ、安全に空けます。",
    "scan.start": "スキャン開始",
    "scan.scanning": "スキャン中…",
    "scan.fail": "スキャン失敗: {msg}",
    "safety.safe": "安全",
    "safety.caution": "注意",
    "safety.danger": "危険",
    "detail.noData": "データなし",
    "detail.empty": "空です",
    "detail.unsupported": "このカテゴリは現在のプラットフォームではサポートされていません",
    "reveal.openFail": "開けませんでした",
    "reveal.folderFail": "フォルダを開けませんでした: {msg}",
    "large.title": "大容量ファイル",
    "large.guide": "{size}以上のファイルをサイズ順に最大{max}件表示します。チェックして削除するか、📂アイコンでファイルの場所を開けます。",
    "large.empty": "{size}以上のファイルはありません",
    "large.none": "{size}以上のファイルはありません",
    "large.selectAria": "{path}を選択",
    "large.openLocation": "ファイルの場所を開く",
    "large.openLocationAria": "{path}の場所を開く",
    "large.more": "ほか{n}件（上位{max}件のみ表示）",
    "large.checkedSummary": "{n}件 · {size}",
    "plan.noItems": "プランを作成するスキャン項目がありません",
    "plan.fail": "プラン生成に失敗しました: {msg}",
    "plan.generate": "整理プランを生成",
    "plan.title": "整理プラン · 約{mb} MB確保",
    "plan.items": "{n}件の項目",
    "delete.button": "削除する ({size})",
    "delete.fail": "削除失敗: {msg}",
    "confirm.title": "{size}を削除しますか？",
    "confirm.detail": "選択した{categories}個のカテゴリ + ファイル{files}件",
    "confirm.warning": "この操作は元に戻せません。（デフォルト: ゴミ箱へ移動）",
    "confirm.cancel": "キャンセル",
    "confirm.ok": "削除を確認",
    "toast.freed": "{size}を確保しました",
    "filter.label": "整理対象の説明（AIフィルター）",
    "filter.description": "自然な言葉で説明するとAIがスキャンフィルターに変換します",
    "filter.placeholder": "例:「6ヶ月使っていない大容量の動画」",
    "filter.convert": "フィルターに変換",
    "filter.convertFail": "フィルター変換に失敗しました",
    "filter.convertFailMsg": "フィルター変換失敗: {msg}",
    "filter.converted": "フィルターに変換しました。内容を確認してからスキャンしてください。",
    "filter.confirmHint": "変換されたフィルター — 値を確認・修正してからスキャンを開始してください（大容量ファイルに適用）。",
    "filter.minSize": "最小サイズ (MB)",
    "filter.unusedDays": "未使用期間（日）",
    "filter.extensions": "拡張子（カンマ区切り）",
    "filter.pathIncludes": "パスに含む（カンマ区切り）",
    "filter.reset": "フィルターをリセット",
    "categoryList.detail": "詳細を見る",
    "categoryList.detailAria": "{label}の詳細を見る",
    "donut.scanProgress": "スキャン進捗",
    "donut.beforeScan": "スキャン前",
    "donut.startPrompt": "スキャンを開始してください",
    "donut.findHint": "整理できる容量を見つけます",
    "donut.diskUsage": "ディスク使用量",
    "category.downloads": "ダウンロード",
    "category.caches": "キャッシュ",
    "category.logs": "ログ",
    "category.trash": "ゴミ箱",
    "category.browserCache": "ブラウザキャッシュ",
    "category.mailDownloads": "メールのダウンロード",
    "category.oldIosUpdates": "古いiOSアップデート",
    "category.largeFiles": "大容量ファイル",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["ko"];
export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

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
  if (typeof window === "undefined") return "ko";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ko" || saved === "en" || saved === "ja") return saved;
  } catch { /* */ }
  return detectLocale();
}

export function useI18n() {
  // SSR/hydration 안전: 초기 렌더는 "ko" 고정, 마운트 후 실제 로케일로 교체.
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
  const t: Translator = (key, vars) => {
    let msg: string = MESSAGES[locale][key] ?? MESSAGES.ko[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) msg = msg.split(`{${k}}`).join(String(v));
    }
    return msg;
  };
  // 서버 스캔 카테고리 id → 번역 라벨. 매핑 실패 시 서버 원문 라벨 fallback.
  const categoryLabel = (id: string, fallback: string): string => {
    const key = `category.${id}`;
    const table = MESSAGES[locale] as Record<string, string>;
    return table[key] ?? fallback;
  };
  return { locale, t, categoryLabel };
}

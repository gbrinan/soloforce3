import { useEffect, useState } from "react";

// 마이크루 대시보드와 동일한 로케일 체계 (ko/en/ja) + 동일 localStorage 키.
// 프록시 경유 시 대시보드와 same-origin이라 키를 직접 읽고
// storage 이벤트로 실시간 동기화된다. 직접 접속 시 navigator 감지.
export type Locale = "ko" | "en" | "ja";
const STORAGE_KEY = "jarvis-lang";

// toLocaleDateString 등 Intl 포맷용 BCP 47 태그
export const LOCALE_TAG: Record<Locale, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };

const MESSAGES = {
  ko: {
    "sidebar.title": "계산기",
    "menu.standard": "기본",
    "menu.scientific": "공학용",
    "menu.finance": "금융",
    "menu.converter": "단위 변환",
    "menu.date": "날짜 계산",
    "ai.placeholder": "자연어로 계산 (예: 150만원 3개월 할부 월 얼마, 1500달러 원화로, D+100)",
    "ai.submit": "✨ 계산",
    "ai.busy": "계산 중…",
    "ai.error": "해석에 실패했어요. 다시 시도해 주세요.",
    "fin.title": "🏦 대출 상환 계산",
    "fin.amount": "대출 금액 (원)",
    "fin.rate": "연이율 (%)",
    "fin.years": "기간 (년)",
    "fin.method": "상환 방식",
    "fin.method.annuity": "원리금균등",
    "fin.method.principal": "원금균등",
    "fin.method.bullet": "만기일시",
    "fin.firstMonth": "첫 달 상환금",
    "fin.monthly": "월 상환금",
    "fin.totalInterest": "총 이자",
    "fin.total": "총 상환액",
    "fin.won": "{n}원",
    "fin.hint.annuity": "매월 동일한 금액(원금+이자)을 상환합니다.",
    "fin.hint.principal": "매월 동일한 원금을 상환하며 이자가 점차 줄어 상환금이 감소합니다.",
    "fin.hint.bullet": "매월 이자만 납부하고 만기에 원금을 일시 상환합니다.",
    "fin.hint.disclaimer": "단순 참고용 계산으로 실제 대출 조건과 다를 수 있습니다.",
    "conv.title": "📐 단위 변환",
    "conv.cat.length": "길이",
    "conv.cat.weight": "무게",
    "conv.cat.data": "데이터",
    "conv.cat.temp": "온도",
    "conv.value": "값",
    "conv.unit": "단위",
    "conv.toUnit": "변환 단위",
    "conv.swap": "단위 서로 바꾸기",
    "date.title": "📅 날짜 계산",
    "date.mode.diff": "날짜 차이",
    "date.mode.add": "날짜 더하기",
    "date.start": "시작일",
    "date.end": "종료일",
    "date.diffResult": "두 날짜 차이",
    "date.days": "{n}일",
    "date.dday": "D-day 기준",
    "date.base": "기준일",
    "date.addDays": "더할 일수 (음수 = 빼기)",
    "date.result": "결과 날짜",
  },
  en: {
    "sidebar.title": "Calculator",
    "menu.standard": "Basic",
    "menu.scientific": "Scientific",
    "menu.finance": "Finance",
    "menu.converter": "Unit Converter",
    "menu.date": "Date",
    "ai.placeholder": "Calculate in plain words (e.g. monthly payment for 1.5M over 3 months, 1500 USD in KRW, D+100)",
    "ai.submit": "✨ Calculate",
    "ai.busy": "Calculating…",
    "ai.error": "Couldn't interpret that. Please try again.",
    "fin.title": "🏦 Loan Repayment",
    "fin.amount": "Loan Amount (KRW)",
    "fin.rate": "Annual Rate (%)",
    "fin.years": "Term (years)",
    "fin.method": "Repayment Method",
    "fin.method.annuity": "Equal Payment",
    "fin.method.principal": "Equal Principal",
    "fin.method.bullet": "Interest-Only",
    "fin.firstMonth": "First Month Payment",
    "fin.monthly": "Monthly Payment",
    "fin.totalInterest": "Total Interest",
    "fin.total": "Total Repayment",
    "fin.won": "₩{n}",
    "fin.hint.annuity": "You pay the same amount (principal + interest) every month.",
    "fin.hint.principal": "You repay the same principal each month; interest shrinks, so payments decrease over time.",
    "fin.hint.bullet": "You pay interest only each month and repay the full principal at maturity.",
    "fin.hint.disclaimer": "For reference only — actual loan terms may differ.",
    "conv.title": "📐 Unit Converter",
    "conv.cat.length": "Length",
    "conv.cat.weight": "Weight",
    "conv.cat.data": "Data",
    "conv.cat.temp": "Temperature",
    "conv.value": "Value",
    "conv.unit": "Unit",
    "conv.toUnit": "Convert To",
    "conv.swap": "Swap units",
    "date.title": "📅 Date Calculator",
    "date.mode.diff": "Date Difference",
    "date.mode.add": "Add Days",
    "date.start": "Start Date",
    "date.end": "End Date",
    "date.diffResult": "Difference",
    "date.days": "{n} days",
    "date.dday": "D-day",
    "date.base": "Base Date",
    "date.addDays": "Days to Add (negative = subtract)",
    "date.result": "Result Date",
  },
  ja: {
    "sidebar.title": "電卓",
    "menu.standard": "基本",
    "menu.scientific": "関数",
    "menu.finance": "金融",
    "menu.converter": "単位変換",
    "menu.date": "日付計算",
    "ai.placeholder": "自然な言葉で計算（例：150万ウォン3か月分割の月額、1500ドルをウォンに、D+100）",
    "ai.submit": "✨ 計算",
    "ai.busy": "計算中…",
    "ai.error": "解釈に失敗しました。もう一度お試しください。",
    "fin.title": "🏦 ローン返済計算",
    "fin.amount": "借入金額（ウォン）",
    "fin.rate": "年利（%）",
    "fin.years": "期間（年）",
    "fin.method": "返済方式",
    "fin.method.annuity": "元利均等",
    "fin.method.principal": "元金均等",
    "fin.method.bullet": "期日一括",
    "fin.firstMonth": "初月返済額",
    "fin.monthly": "毎月返済額",
    "fin.totalInterest": "利息総額",
    "fin.total": "返済総額",
    "fin.won": "{n}ウォン",
    "fin.hint.annuity": "毎月同じ金額（元金＋利息）を返済します。",
    "fin.hint.principal": "毎月同じ元金を返済し、利息が徐々に減るため返済額は減少します。",
    "fin.hint.bullet": "毎月利息のみを支払い、満期に元金を一括返済します。",
    "fin.hint.disclaimer": "参考用の計算であり、実際のローン条件とは異なる場合があります。",
    "conv.title": "📐 単位変換",
    "conv.cat.length": "長さ",
    "conv.cat.weight": "重さ",
    "conv.cat.data": "データ",
    "conv.cat.temp": "温度",
    "conv.value": "値",
    "conv.unit": "単位",
    "conv.toUnit": "変換先の単位",
    "conv.swap": "単位を入れ替える",
    "date.title": "📅 日付計算",
    "date.mode.diff": "日付の差",
    "date.mode.add": "日付の加算",
    "date.start": "開始日",
    "date.end": "終了日",
    "date.diffResult": "2つの日付の差",
    "date.days": "{n}日",
    "date.dday": "D-day基準",
    "date.base": "基準日",
    "date.addDays": "加算する日数（負数＝減算）",
    "date.result": "結果の日付",
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
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ko" || saved === "en" || saved === "ja") return saved;
  } catch { /* */ }
  return detectLocale();
}

export function useI18n() {
  const [locale, setLocale] = useState<Locale>(readLocale);
  useEffect(() => {
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

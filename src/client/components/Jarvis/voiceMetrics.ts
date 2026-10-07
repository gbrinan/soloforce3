// 자비스뷰 검증 지표 — JTBD v2 검증 계획의 반증 임계값 측정용 (docs/jtbd-voice.md, soloforce-voice 리포).
// n=1 자기실험이므로 localStorage 일 단위 카운터로 충분하다. 서버 전송 없음.
const KEY = 'jarvis-metrics-v1';

export interface DayMetrics {
  voiceDelegations: number;   // 음성 위임 수 (J1)
  textRedoSuspects: number;   // 음성 위임 후 60초 내 텍스트 제출 (J-R 재작업 의심)
  voiceCancels: number;       // "취소" 음성 명령 (J-R)
  wakeChecks: number;         // 웨이크 판정 시도 수
  wakeMatches: number;        // 그중 일치 수 (오탐 = checks - matches)
}

type Store = Record<string, DayMetrics>;
const EMPTY: DayMetrics = { voiceDelegations: 0, textRedoSuspects: 0, voiceCancels: 0, wakeChecks: 0, wakeMatches: 0 };

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Store; } catch { return {}; }
}

export function bump(field: keyof DayMetrics): DayMetrics {
  const store = load();
  const k = todayKey();
  const day = { ...EMPTY, ...(store[k] || {}) };
  day[field] += 1;
  store[k] = day;
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* 저장 실패 무시 */ }
  return day;
}

export function today(): DayMetrics {
  return { ...EMPTY, ...(load()[todayKey()] || {}) };
}

// 음성 위임 직후 텍스트로 다시 시켰는지(재작업 의심) 판별용 타임스탬프
let lastVoiceDelegationAt = 0;
export function noteVoiceDelegation(): void { lastVoiceDelegationAt = Date.now(); bump('voiceDelegations'); }
export function noteTextSubmit(): void {
  if (lastVoiceDelegationAt && Date.now() - lastVoiceDelegationAt < 60_000) {
    bump('textRedoSuspects');
    lastVoiceDelegationAt = 0; // 한 위임당 1회만 계수
  }
}

// "방금 거 취소" 류 음성 취소 명령 감지 (J-R)
const CANCEL_RE = /^(취소|방금\s*거?\s*취소|아니야[.!]?|그만[.!]?|스톱|중지)[.!]?$/;
export function isCancelCommand(text: string): boolean {
  return CANCEL_RE.test(text.trim().replace(/\s+/g, ' '));
}

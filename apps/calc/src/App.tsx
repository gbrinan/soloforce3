import { useMemo, useState } from 'react';
import { useI18n, LOCALE_TAG, type MessageKey } from './i18n';

type Op = '+' | '-' | '×' | '÷' | '^';

function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
    case '^': return Math.pow(a, b);
  }
}

// 마이크루 디자인 토큰 (hd-cleaner theme.ts jarvis 팔레트와 동일 계열)
const STYLES = `
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
/* 키보드 포커스 가시성 (마우스 클릭엔 미표시) — 접근성 WCAG 2.4.7 */
button:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
:root {
  --bg-canvas: #0A0F1E;
  --bg-card: #0F1726;
  --bg-muted: #151F32;
  --bg-elevated: #1B2740;
  --border-default: #1F293D;
  --text-primary: #F8F8F8;
  --text-secondary: #9DB7EB;
  --text-muted: #7D8699;
  --accent: #6366F1;
  --accent-hover: #818CF8;
  --accent-soft: rgba(99, 102, 241, 0.14);
  --danger: #F87171;
  --op: var(--accent);
  --fn: #2A3650;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg-canvas: #FAFAFA;
    --bg-card: #FFFFFF;
    --bg-muted: #F0F2F5;
    --bg-elevated: #E7EAF0;
    --border-default: #DFE1E5;
    --text-primary: #04070F;
    --text-secondary: #13295F;
    --text-muted: #6E7278;
    --accent: #4F46E5;
    --accent-hover: #4338CA;
    --accent-soft: rgba(79, 70, 229, 0.10);
    --danger: #DC2626;
    --fn: #D9DEE8;
  }
}
body {
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.app-shell { display: flex; min-height: 100vh; }

/* ── 사이드바 ─────────────────────────────── */
.sidebar {
  width: 216px;
  flex-shrink: 0;
  padding: 20px 12px;
  border-right: 1px solid var(--border-default);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sidebar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 0 12px 12px;
  letter-spacing: 0.02em;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}
.nav-item:hover { background: var(--bg-muted); color: var(--text-primary); }
.nav-item.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--text-primary);
}
.nav-icon { font-size: 18px; line-height: 1; width: 22px; text-align: center; }

/* ── 콘텐츠 ─────────────────────────────── */
.content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 32px 20px;
  overflow-y: auto;
}
.panel { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
.panel-wide { max-width: 480px; }

/* ── 표준/공학 계산기 ───────────────────── */
.display {
  text-align: right;
  font-size: 56px;
  font-weight: 300;
  padding: 24px 12px 12px;
  min-height: 92px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}
.pad { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.pad.sci { grid-template-columns: repeat(5, 1fr); }
.btn {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: none;
  border-radius: 999px;
  aspect-ratio: 1;
  font-size: 28px;
  font-weight: 400;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.pad.sci .btn { font-size: 16px; }
.btn:active { opacity: 0.7; }
.btn.fn { background: var(--fn); color: var(--text-primary); font-size: 20px; }
.pad.sci .btn.fn { font-size: 14px; }
.btn.op { background: var(--op); color: #fff; }
.btn.zero { grid-column: span 2; aspect-ratio: auto; border-radius: 999px; text-align: left; padding-left: 30px; }

/* ── 카드형 폼 (금융/변환/날짜) ─────────── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card-title { font-size: 16px; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; color: var(--text-secondary); }
.field input, .field select {
  background: var(--bg-muted);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  padding: 11px 12px;
  outline: none;
  width: 100%;
}
.field input:focus, .field select:focus { border-color: var(--accent); }
.field-row { display: flex; gap: 10px; }
.field-row .field { flex: 1; }
.seg { display: flex; gap: 6px; background: var(--bg-muted); border-radius: 10px; padding: 4px; }
.seg button {
  flex: 1;
  min-height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  padding: 4px 12px;
  cursor: pointer;
}
.seg button.active { background: var(--accent); color: #fff; }
.result-box {
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.result-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; color: var(--text-secondary); }
.result-row strong { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.result-row.main strong { font-size: 28px; color: var(--accent-hover); }
.swap-btn {
  align-self: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 16px;
  font-family: inherit;
  width: 36px;
  height: 36px;
  padding: 0;
  cursor: pointer;
}
.hint { font-size: 12px; color: var(--text-muted); line-height: 1.5; }

/* ── 자연어 계산 바 ─────────────────────── */
.content-inner { width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: center; gap: 18px; }
.ai-bar { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.ai-bar-row { display: flex; gap: 8px; }
.ai-input {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  padding: 12px 14px;
  outline: none;
}
.ai-input:focus { border-color: var(--accent); }
.ai-input::placeholder { color: var(--text-muted); }
.ai-send {
  flex-shrink: 0;
  background: var(--accent);
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  padding: 0 16px;
  cursor: pointer;
  white-space: nowrap;
}
.ai-send:hover:not(:disabled) { background: var(--accent-hover); }
.ai-send:disabled { opacity: 0.55; cursor: default; }
.ai-error { font-size: 12px; color: var(--danger); padding: 0 2px; }

/* ── 모바일 (사이드바 → 상단 가로 탭) ────── */
@media (max-width: 640px) {
  .app-shell { flex-direction: column; }
  .sidebar {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    padding: 12px;
    border-right: none;
    border-bottom: 1px solid var(--border-default);
  }
  .sidebar-title { display: none; }
  .nav-item { width: auto; flex-shrink: 0; padding: 8px 16px; }
  .content { padding: 20px 16px; }
  .display { font-size: 44px; }
}
`;

// ── 기본/공학 계산기 (공용 상태 머신) ──────────────────────────────
function KeypadCalc({ scientific, initValue }: { scientific: boolean; initValue?: number }) {
  const [display, setDisplay] = useState(initValue != null && Number.isFinite(initValue) ? String(initValue) : '0');
  const [previous, setPrevious] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [overwrite, setOverwrite] = useState(true);

  const inputDigit = (d: string) => {
    if (overwrite) {
      setDisplay(d === '.' ? '0.' : d);
      setOverwrite(false);
      return;
    }
    if (d === '.' && display.includes('.')) return;
    setDisplay((prev) => (prev === '0' && d !== '.' ? d : prev + d));
  };

  const applyOp = (op: Op) => {
    const current = parseFloat(display);
    if (previous !== null && pendingOp && !overwrite) {
      const result = compute(previous, current, pendingOp);
      setDisplay(String(result));
      setPrevious(result);
    } else {
      setPrevious(current);
    }
    setPendingOp(op);
    setOverwrite(true);
  };

  const equals = () => {
    if (previous === null || pendingOp === null) return;
    const current = parseFloat(display);
    const result = compute(previous, current, pendingOp);
    setDisplay(Number.isNaN(result) ? 'Error' : String(result));
    setPrevious(null);
    setPendingOp(null);
    setOverwrite(true);
  };

  const clear = () => {
    setDisplay('0');
    setPrevious(null);
    setPendingOp(null);
    setOverwrite(true);
  };

  const toggleSign = () =>
    setDisplay((prev) => (prev.startsWith('-') ? prev.slice(1) : prev === '0' ? prev : `-${prev}`));

  const percent = () => setDisplay((prev) => String(parseFloat(prev) / 100));

  // 단항 함수 — 현재 표시값에 즉시 적용
  const unary = (fn: (x: number) => number) => {
    const v = fn(parseFloat(display));
    setDisplay(Number.isFinite(v) ? String(v) : 'Error');
    setOverwrite(true);
  };
  const constant = (v: number) => {
    setDisplay(String(v));
    setOverwrite(true);
  };
  const factorial = (n: number) => {
    if (n < 0 || !Number.isInteger(n) || n > 170) return NaN;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  };
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  return (
    <div className="panel">
      <div className="display">{display}</div>
      {scientific && (
        <div className="pad sci">
          <button className="btn fn" onClick={() => unary((x) => Math.sin(toRad(x)))}>sin</button>
          <button className="btn fn" onClick={() => unary((x) => Math.cos(toRad(x)))}>cos</button>
          <button className="btn fn" onClick={() => unary((x) => Math.tan(toRad(x)))}>tan</button>
          <button className="btn fn" onClick={() => unary(Math.log)}>ln</button>
          <button className="btn fn" onClick={() => unary(Math.log10)}>log</button>
          <button className="btn fn" onClick={() => unary(Math.sqrt)}>√x</button>
          <button className="btn fn" onClick={() => unary((x) => x * x)}>x²</button>
          <button className="btn fn" onClick={() => applyOp('^')}>xʸ</button>
          <button className="btn fn" onClick={() => unary((x) => 1 / x)}>1/x</button>
          <button className="btn fn" onClick={() => unary(factorial)}>x!</button>
          <button className="btn fn" onClick={() => constant(Math.PI)}>π</button>
          <button className="btn fn" onClick={() => constant(Math.E)}>e</button>
          <button className="btn fn" onClick={() => unary(Math.abs)}>|x|</button>
          <button className="btn fn" onClick={() => unary((x) => Math.exp(x))}>eˣ</button>
          <button className="btn fn" onClick={() => unary((x) => Math.pow(10, x))}>10ˣ</button>
        </div>
      )}
      <div className="pad">
        <button className="btn fn" onClick={clear}>AC</button>
        <button className="btn fn" onClick={toggleSign}>+/−</button>
        <button className="btn fn" onClick={percent}>%</button>
        <button className="btn op" onClick={() => applyOp('÷')}>÷</button>

        <button className="btn" onClick={() => inputDigit('7')}>7</button>
        <button className="btn" onClick={() => inputDigit('8')}>8</button>
        <button className="btn" onClick={() => inputDigit('9')}>9</button>
        <button className="btn op" onClick={() => applyOp('×')}>×</button>

        <button className="btn" onClick={() => inputDigit('4')}>4</button>
        <button className="btn" onClick={() => inputDigit('5')}>5</button>
        <button className="btn" onClick={() => inputDigit('6')}>6</button>
        <button className="btn op" onClick={() => applyOp('-')}>−</button>

        <button className="btn" onClick={() => inputDigit('1')}>1</button>
        <button className="btn" onClick={() => inputDigit('2')}>2</button>
        <button className="btn" onClick={() => inputDigit('3')}>3</button>
        <button className="btn op" onClick={() => applyOp('+')}>+</button>

        <button className="btn zero" onClick={() => inputDigit('0')}>0</button>
        <button className="btn" onClick={() => inputDigit('.')}>.</button>
        <button className="btn op" onClick={equals}>=</button>
      </div>
    </div>
  );
}

// ── 금융 계산기 (대출 상환) ────────────────────────────────────────
type RepayMethod = 'annuity' | 'principal' | 'bullet';

type FinanceInit = { amount?: number; rate?: number; years?: number; method?: RepayMethod };
function FinanceCalc({ init }: { init?: FinanceInit }) {
  const { t } = useI18n();
  const won = (v: number): string =>
    Number.isFinite(v) ? t('fin.won', { n: Math.round(v).toLocaleString('ko-KR') }) : '-';
  const [amount, setAmount] = useState(init?.amount != null ? String(init.amount) : '100000000');
  const [rate, setRate] = useState(init?.rate != null ? String(init.rate) : '4.5');
  const [years, setYears] = useState(init?.years != null ? String(init.years) : '30');
  const [method, setMethod] = useState<RepayMethod>(
    init?.method === 'principal' || init?.method === 'bullet' ? init.method : 'annuity',
  );

  const result = useMemo(() => {
    const P = parseFloat(amount);
    const annual = parseFloat(rate) / 100;
    const n = Math.round(parseFloat(years) * 12);
    if (!(P > 0) || !(annual >= 0) || !(n > 0)) return null;
    const r = annual / 12;
    if (method === 'annuity') {
      const monthly = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      const total = monthly * n;
      return { monthly, firstMonth: monthly, totalInterest: total - P, total };
    }
    if (method === 'principal') {
      const firstMonth = P / n + P * r;
      const totalInterest = (P * r * (n + 1)) / 2;
      return { monthly: NaN, firstMonth, totalInterest, total: P + totalInterest };
    }
    // 만기일시: 매월 이자만, 만기에 원금 상환
    const monthly = P * r;
    const totalInterest = monthly * n;
    return { monthly, firstMonth: monthly, totalInterest, total: P + totalInterest };
  }, [amount, rate, years, method]);

  return (
    <div className="panel panel-wide">
      <div className="card">
        <div className="card-title">{t('fin.title')}</div>
        <div className="field">
          <label>{t('fin.amount')}</label>
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>{t('fin.rate')}</label>
            <input type="number" inputMode="decimal" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <div className="field">
            <label>{t('fin.years')}</label>
            <input type="number" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>{t('fin.method')}</label>
          <div className="seg">
            <button className={method === 'annuity' ? 'active' : ''} onClick={() => setMethod('annuity')}>{t('fin.method.annuity')}</button>
            <button className={method === 'principal' ? 'active' : ''} onClick={() => setMethod('principal')}>{t('fin.method.principal')}</button>
            <button className={method === 'bullet' ? 'active' : ''} onClick={() => setMethod('bullet')}>{t('fin.method.bullet')}</button>
          </div>
        </div>
        {result && (
          <div className="result-box">
            <div className="result-row main">
              <span>{method === 'principal' ? t('fin.firstMonth') : t('fin.monthly')}</span>
              <strong>{won(result.firstMonth)}</strong>
            </div>
            <div className="result-row"><span>{t('fin.totalInterest')}</span><strong>{won(result.totalInterest)}</strong></div>
            <div className="result-row"><span>{t('fin.total')}</span><strong>{won(result.total)}</strong></div>
          </div>
        )}
        <div className="hint">
          {method === 'annuity' && t('fin.hint.annuity')}
          {method === 'principal' && t('fin.hint.principal')}
          {method === 'bullet' && t('fin.hint.bullet')}
          {' '}{t('fin.hint.disclaimer')}
        </div>
      </div>
    </div>
  );
}

// ── 단위 변환 ──────────────────────────────────────────────────────
type UnitDef = { label: string; factor: number }; // 기준 단위 대비 배율
const UNIT_CATEGORIES: Record<string, { labelKey: MessageKey; units: Record<string, UnitDef> }> = {
  length: {
    labelKey: 'conv.cat.length',
    units: {
      mm: { label: 'mm', factor: 0.001 },
      cm: { label: 'cm', factor: 0.01 },
      m: { label: 'm', factor: 1 },
      km: { label: 'km', factor: 1000 },
      in: { label: 'inch', factor: 0.0254 },
      ft: { label: 'ft', factor: 0.3048 },
      mi: { label: 'mile', factor: 1609.344 },
    },
  },
  weight: {
    labelKey: 'conv.cat.weight',
    units: {
      g: { label: 'g', factor: 1 },
      kg: { label: 'kg', factor: 1000 },
      t: { label: 't', factor: 1_000_000 },
      oz: { label: 'oz', factor: 28.349523125 },
      lb: { label: 'lb', factor: 453.59237 },
    },
  },
  data: {
    labelKey: 'conv.cat.data',
    units: {
      B: { label: 'B', factor: 1 },
      KB: { label: 'KB', factor: 1024 },
      MB: { label: 'MB', factor: 1024 ** 2 },
      GB: { label: 'GB', factor: 1024 ** 3 },
      TB: { label: 'TB', factor: 1024 ** 4 },
    },
  },
  temp: {
    labelKey: 'conv.cat.temp',
    units: {
      c: { label: '°C', factor: 1 },
      f: { label: '°F', factor: 1 },
      k: { label: 'K', factor: 1 },
    },
  },
};

// 온도는 선형 배율이 아니라 별도 변환
function convertTemp(v: number, from: string, to: string): number {
  const c = from === 'c' ? v : from === 'f' ? ((v - 32) * 5) / 9 : v - 273.15;
  return to === 'c' ? c : to === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
}

type ConverterInit = { category?: string; fromUnit?: string; toUnit?: string; value?: number };
function ConverterCalc({ init }: { init?: ConverterInit }) {
  const { t } = useI18n();
  const initCat = init?.category && UNIT_CATEGORIES[init.category] ? init.category : 'length';
  const initUnits = UNIT_CATEGORIES[initCat].units;
  const [category, setCategory] = useState(initCat);
  const [fromUnit, setFromUnit] = useState(init?.fromUnit && initUnits[init.fromUnit] ? init.fromUnit : Object.keys(initUnits)[0]);
  const [toUnit, setToUnit] = useState(init?.toUnit && initUnits[init.toUnit] ? init.toUnit : (Object.keys(initUnits)[1] ?? Object.keys(initUnits)[0]));
  const [value, setValue] = useState(init?.value != null ? String(init.value) : '1');

  const cat = UNIT_CATEGORIES[category];
  const changeCategory = (next: string) => {
    setCategory(next);
    const keys = Object.keys(UNIT_CATEGORIES[next].units);
    setFromUnit(keys[0]);
    setToUnit(keys[1] ?? keys[0]);
  };
  const swap = () => {
    setFromUnit(toUnit);
    setToUnit(fromUnit);
  };

  const output = useMemo(() => {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return null;
    const r = category === 'temp'
      ? convertTemp(v, fromUnit, toUnit)
      : (v * cat.units[fromUnit].factor) / cat.units[toUnit].factor;
    return r.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
  }, [value, category, fromUnit, toUnit, cat]);

  return (
    <div className="panel panel-wide">
      <div className="card">
        <div className="card-title">{t('conv.title')}</div>
        <div className="seg">
          {Object.entries(UNIT_CATEGORIES).map(([k, c]) => (
            <button key={k} className={category === k ? 'active' : ''} onClick={() => changeCategory(k)}>{t(c.labelKey)}</button>
          ))}
        </div>
        <div className="field-row">
          <div className="field">
            <label>{t('conv.value')}</label>
            <input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="field">
            <label>{t('conv.unit')}</label>
            <select value={fromUnit} onChange={(e) => setFromUnit(e.target.value)}>
              {Object.entries(cat.units).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}
            </select>
          </div>
        </div>
        <button className="swap-btn" onClick={swap} aria-label={t('conv.swap')}>⇅</button>
        <div className="field">
          <label>{t('conv.toUnit')}</label>
          <select value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
            {Object.entries(cat.units).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}
          </select>
        </div>
        {output !== null && (
          <div className="result-box">
            <div className="result-row main">
              <span>{cat.units[fromUnit].label} → {cat.units[toUnit].label}</span>
              <strong>{output} {cat.units[toUnit].label}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 날짜 계산 ──────────────────────────────────────────────────────
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type DateInit = { mode?: 'diff' | 'add'; dateA?: string; dateB?: string; baseDate?: string; days?: number };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function DateCalc({ init }: { init?: DateInit }) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<'diff' | 'add'>(init?.mode === 'add' ? 'add' : init?.mode === 'diff' ? 'diff' : 'diff');
  const [dateA, setDateA] = useState(init?.dateA && DATE_RE.test(init.dateA) ? init.dateA : todayStr());
  const [dateB, setDateB] = useState(init?.dateB && DATE_RE.test(init.dateB) ? init.dateB : todayStr());
  const [baseDate, setBaseDate] = useState(init?.baseDate && DATE_RE.test(init.baseDate) ? init.baseDate : todayStr());
  const [days, setDays] = useState(init?.days != null ? String(init.days) : '100');

  const diff = useMemo(() => {
    const a = new Date(dateA + 'T00:00:00');
    const b = new Date(dateB + 'T00:00:00');
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
  }, [dateA, dateB]);

  const added = useMemo(() => {
    const base = new Date(baseDate + 'T00:00:00');
    const n = parseInt(days, 10);
    if (Number.isNaN(base.getTime()) || !Number.isFinite(n)) return null;
    const r = new Date(base.getTime() + n * 86_400_000);
    return r.toLocaleDateString(LOCALE_TAG[locale], { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  }, [baseDate, days, locale]);

  return (
    <div className="panel panel-wide">
      <div className="card">
        <div className="card-title">{t('date.title')}</div>
        <div className="seg">
          <button className={mode === 'diff' ? 'active' : ''} onClick={() => setMode('diff')}>{t('date.mode.diff')}</button>
          <button className={mode === 'add' ? 'active' : ''} onClick={() => setMode('add')}>{t('date.mode.add')}</button>
        </div>
        {mode === 'diff' ? (
          <>
            <div className="field-row">
              <div className="field">
                <label>{t('date.start')}</label>
                <input type="date" value={dateA} onChange={(e) => setDateA(e.target.value)} />
              </div>
              <div className="field">
                <label>{t('date.end')}</label>
                <input type="date" value={dateB} onChange={(e) => setDateB(e.target.value)} />
              </div>
            </div>
            {diff !== null && (
              <div className="result-box">
                <div className="result-row main">
                  <span>{t('date.diffResult')}</span>
                  <strong>{t('date.days', { n: diff.toLocaleString('ko-KR') })}</strong>
                </div>
                <div className="result-row">
                  <span>{t('date.dday')}</span>
                  <strong>{diff === 0 ? 'D-Day' : diff > 0 ? `D-${diff}` : `D+${-diff}`}</strong>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field-row">
              <div className="field">
                <label>{t('date.base')}</label>
                <input type="date" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
              </div>
              <div className="field">
                <label>{t('date.addDays')}</label>
                <input type="number" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            </div>
            {added !== null && (
              <div className="result-box">
                <div className="result-row main">
                  <span>{t('date.result')}</span>
                  <strong>{added}</strong>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── 앱 셸 — 좌측 사이드바 + 5개 계산기 메뉴 ────────────────────────
type MenuId = 'standard' | 'scientific' | 'finance' | 'converter' | 'date';

const MENUS: { id: MenuId; icon: string; labelKey: MessageKey }[] = [
  { id: 'standard', icon: '🧮', labelKey: 'menu.standard' },
  { id: 'scientific', icon: '🔬', labelKey: 'menu.scientific' },
  { id: 'finance', icon: '🏦', labelKey: 'menu.finance' },
  { id: 'converter', icon: '📐', labelKey: 'menu.converter' },
  { id: 'date', icon: '📅', labelKey: 'menu.date' },
];

// AI가 반환하는 의도 → 탭 매핑 (계산은 클라이언트가 기존 로직으로 수행)
type AiParse = { intent: 'basic' | 'scientific' | 'finance' | 'converter' | 'date'; params?: Record<string, unknown>; explanation?: string };
const INTENT_TO_MENU: Record<AiParse['intent'], MenuId> = {
  basic: 'standard', scientific: 'scientific', finance: 'finance', converter: 'converter', date: 'date',
};
const asNum = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

// ── 자연어 계산 바 ─────────────────────────────────────────────────
function AiBar({ onResult }: { onResult: (r: AiParse) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const input = text.trim();
    if (!input || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('api/ai/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AiParse;
      onResult(data);
    } catch {
      setError(t('ai.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-bar">
      <div className="ai-bar-row">
        <input
          className="ai-input"
          value={text}
          placeholder={t('ai.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          disabled={busy}
        />
        <button className="ai-send" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? t('ai.busy') : t('ai.submit')}
        </button>
      </div>
      {error && <div className="ai-error">{error}</div>}
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuId>('standard');
  // AI 파싱 결과를 seq로 감싸 remount(key) → 각 계산기 초기값 주입.
  const [ai, setAi] = useState<{ intent: AiParse['intent']; params: Record<string, unknown>; seq: number } | null>(null);

  const handleAi = (r: AiParse) => {
    if (!r || !INTENT_TO_MENU[r.intent]) return;
    setMenu(INTENT_TO_MENU[r.intent]);
    setAi({ intent: r.intent, params: r.params ?? {}, seq: Date.now() });
  };

  const seq = ai?.seq ?? 0;
  const p = ai?.params ?? {};
  const forStd = ai?.intent === 'basic' ? { initValue: asNum(p.value) } : {};
  const forSci = ai?.intent === 'scientific' ? { initValue: asNum(p.value) } : {};
  const finInit: FinanceInit | undefined = ai?.intent === 'finance'
    ? { amount: asNum(p.amount), rate: asNum(p.rate), years: asNum(p.years), method: p.method as RepayMethod }
    : undefined;
  const convInit: ConverterInit | undefined = ai?.intent === 'converter'
    ? { category: typeof p.category === 'string' ? p.category : undefined, fromUnit: typeof p.fromUnit === 'string' ? p.fromUnit : undefined, toUnit: typeof p.toUnit === 'string' ? p.toUnit : undefined, value: asNum(p.value) }
    : undefined;
  const dateInit: DateInit | undefined = ai?.intent === 'date'
    ? { mode: p.mode === 'add' ? 'add' : p.mode === 'diff' ? 'diff' : undefined, dateA: typeof p.dateA === 'string' ? p.dateA : undefined, dateB: typeof p.dateB === 'string' ? p.dateB : undefined, baseDate: typeof p.baseDate === 'string' ? p.baseDate : undefined, days: asNum(p.days) }
    : undefined;

  return (
    <>
      <style>{STYLES}</style>
      <div className="app-shell">
        <nav className="sidebar">
          <div className="sidebar-title">{t('sidebar.title')}</div>
          {MENUS.map((m) => (
            <button
              key={m.id}
              className={`nav-item${menu === m.id ? ' active' : ''}`}
              onClick={() => setMenu(m.id)}
            >
              <span className="nav-icon">{m.icon}</span>
              {t(m.labelKey)}
            </button>
          ))}
        </nav>
        <main className="content">
          <div className="content-inner">
            <AiBar onResult={handleAi} />
            {menu === 'standard' && <KeypadCalc key={`std-${seq}`} scientific={false} {...forStd} />}
            {menu === 'scientific' && <KeypadCalc key={`sci-${seq}`} scientific {...forSci} />}
            {menu === 'finance' && <FinanceCalc key={`fin-${seq}`} init={finInit} />}
            {menu === 'converter' && <ConverterCalc key={`conv-${seq}`} init={convInit} />}
            {menu === 'date' && <DateCalc key={`date-${seq}`} init={dateInit} />}
          </div>
        </main>
      </div>
    </>
  );
}

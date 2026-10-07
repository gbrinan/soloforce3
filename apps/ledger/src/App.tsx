import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type AiAnomalies, type AiForecast, type TxDraft } from "./api";
import { t, useLocale, type Locale, type MsgKey } from "./i18n";
import { useColorScheme } from "./theme";
import type { Asset, CatKind, Category, Dividends, Holding, HoldingKind, LedgerState, Quotes, Subscription, Tx, TxType } from "./types";
import {
  assetBalance, catName, dateLabel, daysToMaturity, depositValue, fmtMoney, fmtMoneyShort,
  monthLabel, monthlyEquivalent, nextBillingDate, savingsValue, shiftYm, todayStr, ymOf,
} from "./util";

type Tab = "list" | "calendar" | "yearly" | "stats" | "budget" | "subs";
type Menu = "ledger" | "assets" | "settings";
type AssetTab = "list" | "stats" | "dividends";
type DisplayCurrency = "KRW" | "USD";
const DISPLAY_CURRENCY_KEY = "ledger-display-currency";

// 카테고리 도넛/막대 색 (라이트·다크 공용 채도)
const PALETTE = ["#4779ea", "#34d399", "#f5a623", "#e5484d", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c", "#84cc16", "#94a3b8"];

export function App() {
  const locale = useLocale();
  useColorScheme();
  const [state, setState] = useState<LedgerState | null>(null);
  const [menu, setMenu] = useState<Menu>("ledger");
  const [tab, setTab] = useState<Tab>("list");
  const [assetTab, setAssetTab] = useState<AssetTab>("list");
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => {
    try { return localStorage.getItem(DISPLAY_CURRENCY_KEY) === "USD" ? "USD" : "KRW"; } catch { return "KRW"; }
  });
  const changeDisplayCurrency = (c: DisplayCurrency) => {
    setDisplayCurrency(c);
    try { localStorage.setItem(DISPLAY_CURRENCY_KEY, c); } catch { /* private mode 등 저장 실패 무시 */ }
  };
  const [ym, setYm] = useState(() => ymOf(todayStr()));
  const [toast, setToast] = useState("");
  const [txModal, setTxModal] = useState<{ open: boolean; edit?: Tx; date?: string }>({ open: false });
  const [assetModal, setAssetModal] = useState<{ open: boolean; edit?: Asset }>({ open: false });
  const [subModal, setSubModal] = useState<{ open: boolean; edit?: Subscription }>({ open: false });
  const [smartOpen, setSmartOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  };
  const reload = async () => {
    try {
      setState(await api.state());
    } catch {
      showToast(t(locale, "toast.loadFail"));
    }
  };
  useEffect(() => { void reload(); }, []);

  const txs = state?.transactions ?? [];
  const monthTxs = useMemo(() => txs.filter((x) => ymOf(x.date) === ym), [txs, ym]);
  const sums = useMemo(() => {
    let income = 0, expense = 0;
    for (const x of monthTxs) {
      if (x.type === "income") income += x.amount;
      else if (x.type === "expense") expense += x.amount;
    }
    return { income, expense, net: income - expense };
  }, [monthTxs]);

  if (!state) return <div className="app"><div className="empty">…</div></div>;

  const TABS: { key: Tab; label: MsgKey }[] = [
    { key: "list", label: "tab.list" },
    { key: "calendar", label: "tab.calendar" },
    { key: "yearly", label: "tab.yearly" },
    { key: "stats", label: "tab.stats" },
    { key: "budget", label: "tab.budget" },
    { key: "subs", label: "tab.subs" },
  ];
  const showMonthNav = tab === "list" || tab === "calendar" || tab === "stats" || tab === "budget";

  return (
    <div className="app shell">
      <aside className="sidebar">
        <button className={`sbitem ${menu === "ledger" ? "active" : ""}`} onClick={() => setMenu("ledger")}>
          <em>💰</em><span>{t(locale, "menu.ledger")}</span>
        </button>
        <button className={`sbitem ${menu === "assets" ? "active" : ""}`} onClick={() => setMenu("assets")}>
          <em>📈</em><span>{t(locale, "menu.assets")}</span>
        </button>
        <button className={`sbitem ${menu === "settings" ? "active" : ""}`} onClick={() => setMenu("settings")}>
          <em>⚙️</em><span>{t(locale, "menu.settings")}</span>
        </button>
      </aside>

      <div className="main">
      {menu === "ledger" && (
      <>
      <div className="filterbar">
        {TABS.map((x) => (
          <button key={x.key} className={`chip ${tab === x.key ? "active" : ""}`} onClick={() => setTab(x.key)}>
            {t(locale, x.label)}
          </button>
        ))}
        <button className="smartbtn" onClick={() => setSmartOpen(true)}>✨ {t(locale, "smart.open")}</button>
        <button className="searchbtn" onClick={() => setTxModal({ open: true })}>＋ {t(locale, "list.add")}</button>
      </div>

      <div className="scroll">
        {showMonthNav && (
          <div className="calhead">
            <span className="month">{monthLabel(ym, locale)}</span>
            <div className="calnav">
              <button aria-label={t(locale, "nav.prevYear")} onClick={() => setYm(shiftYm(ym, -12))}>«</button>
              <button aria-label={t(locale, "nav.prevMonth")} onClick={() => setYm(shiftYm(ym, -1))}>‹</button>
              <button className="todaybtn" onClick={() => setYm(ymOf(todayStr()))}>{t(locale, "cal.today")}</button>
              <button aria-label={t(locale, "nav.nextMonth")} onClick={() => setYm(shiftYm(ym, 1))}>›</button>
              <button aria-label={t(locale, "nav.nextYear")} onClick={() => setYm(shiftYm(ym, 12))}>»</button>
            </div>
          </div>
        )}
        {showMonthNav && tab !== "budget" && (
          <div className="sumrow">
            <div className="sumcell"><span>{t(locale, "sum.income")}</span><b className="income">{fmtMoneyShort(sums.income, locale)}</b></div>
            <div className="sumcell"><span>{t(locale, "sum.expense")}</span><b className="expense">{fmtMoneyShort(sums.expense, locale)}</b></div>
            <div className="sumcell"><span>{t(locale, "sum.net")}</span><b className={sums.net >= 0 ? "income" : "expense"}>{fmtMoneyShort(sums.net, locale)}</b></div>
          </div>
        )}

        {tab === "list" && (
          <ListView locale={locale} state={state} monthTxs={monthTxs}
            onAdd={() => setTxModal({ open: true })} onEdit={(tx) => setTxModal({ open: true, edit: tx })} />
        )}
        {tab === "calendar" && (
          <CalendarView locale={locale} ym={ym} monthTxs={monthTxs}
            onDay={(date) => setTxModal({ open: true, date })} />
        )}
        {tab === "yearly" && <YearlyView locale={locale} state={state} ym={ym} onYm={setYm} />}
        {tab === "stats" && <StatsView locale={locale} state={state} ym={ym} monthTxs={monthTxs} />}
        {tab === "budget" && <BudgetView locale={locale} state={state} monthTxs={monthTxs} onSaved={reload} showToast={showToast} />}
        {tab === "subs" && (
          <SubsView locale={locale} state={state} showToast={showToast} onChanged={reload}
            onAdd={() => setSubModal({ open: true })} onEdit={(s) => setSubModal({ open: true, edit: s })} />
        )}
      </div>
      </>
      )}

      {menu === "assets" && (
        <>
          <div className="filterbar">
            {(["list", "stats", "dividends"] as AssetTab[]).map((k) => (
              <button key={k} className={`chip ${assetTab === k ? "active" : ""}`} onClick={() => setAssetTab(k)}>
                {t(locale, `am.tab.${k}` as MsgKey)}
              </button>
            ))}
          </div>
          <div className="scroll">
            <AssetMgmtView locale={locale} state={state} showToast={showToast} onChanged={reload}
              displayCurrency={displayCurrency} tab={assetTab}
              onAddCash={() => setAssetModal({ open: true })} onEditCash={(a) => setAssetModal({ open: true, edit: a })} />
          </div>
        </>
      )}

      {menu === "settings" && (
        <div className="scroll">
          <SettingsView locale={locale} displayCurrency={displayCurrency} onChangeCurrency={changeDisplayCurrency} />
        </div>
      )}
      </div>

      {txModal.open && (
        <TxModal locale={locale} state={state} edit={txModal.edit} initialDate={txModal.date}
          onClose={() => setTxModal({ open: false })}
          onSaved={() => { setTxModal({ open: false }); void reload(); showToast(t(locale, "toast.saved")); }}
          onDeleted={() => { setTxModal({ open: false }); void reload(); showToast(t(locale, "toast.deleted")); }}
          showToast={showToast} />
      )}
      {assetModal.open && (
        <AssetModal locale={locale} edit={assetModal.edit}
          onClose={() => setAssetModal({ open: false })}
          onSaved={() => { setAssetModal({ open: false }); void reload(); showToast(t(locale, "toast.saved")); }}
          onDeleted={() => { setAssetModal({ open: false }); void reload(); showToast(t(locale, "toast.deleted")); }}
          showToast={showToast} />
      )}
      {subModal.open && (
        <SubModal locale={locale} state={state} edit={subModal.edit}
          onClose={() => setSubModal({ open: false })}
          onSaved={() => { setSubModal({ open: false }); void reload(); showToast(t(locale, "toast.saved")); }}
          showToast={showToast} />
      )}
      {smartOpen && (
        <SmartInputModal locale={locale} state={state}
          onClose={() => setSmartOpen(false)}
          onAdded={(n) => { void reload(); showToast(t(locale, "smart.added", { n })); }}
          showToast={showToast} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ── 모달: 스마트 입력 (AI 자연어 + SMS 붙여넣기/스캔) ────────────────────
function SmartInputModal({ locale, state, onClose, onAdded, showToast }: {
  locale: Locale; state: LedgerState; onClose: () => void;
  onAdded: (n: number) => void; showToast: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<TxDraft[]>([]);
  const [busy, setBusy] = useState<"" | "ai" | "scan" | "add">("");
  const [notice, setNotice] = useState("");
  const cats = new Map(state.categories.map((c) => [c.id, c]));

  const looksLikeSms = (s: string) => /승인|Web발신|카드|일시불/.test(s);
  const runAi = async () => {
    if (!text.trim()) return;
    setBusy("ai");
    setNotice("");
    try {
      const res = looksLikeSms(text) ? await api.smsParse(text) : await api.aiParse(text);
      setDrafts(res.drafts);
      if (res.drafts.length === 0) setNotice(t(locale, "smart.noResult"));
    } catch {
      setNotice(t(locale, "smart.noResult"));
    } finally {
      setBusy("");
    }
  };
  const runScan = async () => {
    setBusy("scan");
    setNotice("");
    try {
      const res = await api.smsScan();
      setDrafts(res.items);
      if (res.items.length === 0) setNotice(t(locale, "smart.scanEmpty"));
    } catch (e) {
      setNotice(e instanceof Error && e.message === "no_access" ? t(locale, "smart.scanNoAccess") : t(locale, "smart.noResult"));
    } finally {
      setBusy("");
    }
  };
  const addOne = async (d: TxDraft) => {
    setBusy("add");
    try {
      await api.addTx({ type: d.type, amount: d.amount, categoryId: d.categoryId, date: d.date, memo: d.memo, ...(d.guid ? { smsGuid: d.guid } as Partial<Tx> : {}) });
      setDrafts((prev) => prev.filter((x) => x !== d));
      onAdded(1);
    } catch {
      showToast(t(locale, "toast.saveFail"));
    } finally {
      setBusy("");
    }
  };
  const addAll = async () => {
    setBusy("add");
    let n = 0;
    for (const d of drafts) {
      try {
        await api.addTx({ type: d.type, amount: d.amount, categoryId: d.categoryId, date: d.date, memo: d.memo, ...(d.guid ? { smsGuid: d.guid } as Partial<Tx> : {}) });
        n++;
      } catch { /* 개별 실패 스킵 */ }
    }
    setDrafts([]);
    setBusy("");
    if (n > 0) onAdded(n);
  };
  const dismiss = async (d: TxDraft) => {
    if (d.guid) {
      try { await api.smsDismiss(d.guid); } catch { /* */ }
    }
    setDrafts((prev) => prev.filter((x) => x !== d));
  };

  return (
    <Modal onClose={onClose} title={t(locale, "smart.title")}>
      <textarea className="smartta" value={text} placeholder={t(locale, "smart.ph")}
        onChange={(e) => setText(e.target.value)} rows={4} />
      <p className="subnote">{t(locale, "smart.aiNote")}</p>
      <div className="confirmrow" style={{ justifyContent: "flex-start", marginBottom: 12 }}>
        <button className="cbtn primary" disabled={busy !== "" || !text.trim()} onClick={() => void runAi()}>
          {busy === "ai" ? t(locale, "smart.parsing") : `✨ ${t(locale, "smart.ai")}`}
        </button>
        <button className="cbtn ghost" disabled={busy !== ""} onClick={() => void runScan()}>
          {busy === "scan" ? t(locale, "smart.scanning") : `💬 ${t(locale, "smart.scan")}`}
        </button>
      </div>
      {notice && <p className="smartnotice">{notice}</p>}
      {drafts.length > 0 && (
        <>
          <div className="dayhead" style={{ marginBottom: 4 }}>
            <span>{t(locale, "smart.results")} ({drafts.length})</span>
            <button className="pill" disabled={busy !== ""} onClick={() => void addAll()}>{t(locale, "smart.addAll")}</button>
          </div>
          <div className="draftlist">
            {drafts.map((d, i) => {
              const c = cats.get(d.categoryId);
              return (
                <div key={d.guid ?? i} className="draftrow">
                  <span className="txemoji">{c?.emoji ?? "🏷️"}</span>
                  <span className="txinfo">
                    <span className="txmemo">{d.memo || catName(c, locale)}</span>
                    <span className="txmeta">{d.date} · {catName(c, locale)}</span>
                  </span>
                  <span className={`txamount ${d.type}`}>
                    {d.type === "expense" ? "-" : "+"}{fmtMoneyShort(d.amount, locale)}
                  </span>
                  <button className="pill" disabled={busy !== ""} onClick={() => void addOne(d)}>{t(locale, "smart.add")}</button>
                  <button className="pill danger" disabled={busy !== ""} onClick={() => void dismiss(d)}>{t(locale, "smart.dismiss")}</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

// ── 내역 (일자 그룹 목록) ────────────────────────────────────────────────
function ListView({ locale, state, monthTxs, onAdd, onEdit }: {
  locale: Locale; state: LedgerState; monthTxs: Tx[];
  onAdd: () => void; onEdit: (tx: Tx) => void;
}) {
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const assets = new Map(state.assets.map((a) => [a.id, a]));
  const byDay = useMemo(() => {
    const m = new Map<string, Tx[]>();
    for (const x of [...monthTxs].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      const list = m.get(x.date) ?? [];
      list.push(x);
      m.set(x.date, list);
    }
    return [...m.entries()];
  }, [monthTxs]);

  if (monthTxs.length === 0) {
    return (
      <div className="empty">
        {t(locale, "list.empty")}
        <br />
        <button className="cta" onClick={onAdd}>{t(locale, "list.empty.cta")}</button>
      </div>
    );
  }
  return (
    <div className="txlist pagepad">
      <div className="listtools">
        {/* download 속성 금지: 대시보드 iframe sandbox에 allow-downloads가 없어 프레임 내 다운로드가
            조용히 차단된다. target=_blank는 allow-popups-to-escape-sandbox로 샌드박스를 벗어난 새 탭에서
            열리고, 서버의 Content-Disposition: attachment가 다운로드를 트리거한다. */}
        <a className="exportbtn" href={api.exportUrl()} target="_blank" rel="noopener">⬇ {t(locale, "list.export")}</a>
      </div>
      {byDay.map(([date, list]) => {
        const dayExpense = list.filter((x) => x.type === "expense").reduce((s, x) => s + x.amount, 0);
        const dayIncome = list.filter((x) => x.type === "income").reduce((s, x) => s + x.amount, 0);
        return (
          <div key={date} className="daygroup">
            <div className="dayhead">
              <span>{dateLabel(date, locale)}</span>
              <span className="daysum">
                {dayIncome > 0 && <b className="income">+{fmtMoneyShort(dayIncome, locale)}</b>}
                {dayExpense > 0 && <b className="expense">-{fmtMoneyShort(dayExpense, locale)}</b>}
              </span>
            </div>
            {list.map((x) => {
              const c = x.categoryId ? cats.get(x.categoryId) : undefined;
              return (
                <button key={x.id} className="txrow" onClick={() => onEdit(x)}>
                  <span className="txemoji">{x.type === "transfer" ? "🔀" : c?.emoji ?? "🏷️"}</span>
                  <span className="txinfo">
                    <span className="txmemo">{x.memo || (x.type === "transfer" ? t(locale, "tx.transfer") : catName(c, locale))}</span>
                    <span className="txmeta">
                      {x.type !== "transfer" && catName(c, locale)}
                      {x.assetId && ` · ${assets.get(x.assetId)?.name ?? ""}`}
                      {x.type === "transfer" && x.toAssetId && ` → ${assets.get(x.toAssetId)?.name ?? state.holdings.find((h) => h.id === x.toAssetId)?.name ?? ""}`}
                      {x.subscriptionId && ` · ${t(locale, "tx.auto")}`}
                    </span>
                  </span>
                  <span className={`txamount ${x.type}`}>
                    {x.type === "expense" ? "-" : x.type === "income" ? "+" : ""}{fmtMoneyShort(x.amount, locale)}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── 캘린더 ──────────────────────────────────────────────────────────────
function CalendarView({ locale, ym, monthTxs, onDay }: {
  locale: Locale; ym: string; monthTxs: Tx[]; onDay: (date: string) => void;
}) {
  const year = Number(ym.slice(0, 4));
  const monthIdx = Number(ym.slice(5, 7)) - 1;
  const first = new Date(year, monthIdx, 1);
  const startWd = first.getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const today = todayStr();
  const wdNames = locale === "ko" ? ["일", "월", "화", "수", "목", "금", "토"]
    : locale === "ja" ? ["日", "月", "火", "水", "木", "金", "土"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const byDay = new Map<string, { expense: number; income: number }>();
  for (const x of monthTxs) {
    const cur = byDay.get(x.date) ?? { expense: 0, income: 0 };
    if (x.type === "expense") cur.expense += x.amount;
    else if (x.type === "income") cur.income += x.amount;
    byDay.set(x.date, cur);
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: startWd }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="calgrid">
      {wdNames.map((w) => <div key={w} className="calwd">{w}</div>)}
      {cells.map((day, i) => {
        if (day === null) return <div key={i} className="calcell dim" />;
        const dateStr = `${ym}-${String(day).padStart(2, "0")}`;
        const sum = byDay.get(dateStr);
        return (
          <button key={i} className="calcell caldata" onClick={() => onDay(dateStr)}>
            <span className={`day ${dateStr === today ? "today" : ""}`}>{day}</span>
            {sum && (
              <span className="calsum">
                {sum.income > 0 && <em className="income">+{fmtMoneyShort(sum.income, locale)}</em>}
                {sum.expense > 0 && <em className="expense">-{fmtMoneyShort(sum.expense, locale)}</em>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── 연간 (12개월 × 카테고리 그룹 표, 접기/펼치기) ────────────────────────
function YearlyView({ locale, state, ym, onYm }: {
  locale: Locale; state: LedgerState; ym: string; onYm: (ym: string) => void;
}) {
  const year = ym.slice(0, 4);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((p) => ({ ...p, [key]: !p[key] }));

  const monthNames = locale === "en"
    ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    : Array.from({ length: 12 }, (_, i) => `${i + 1}${locale === "ja" ? "月" : "월"}`);
  const yearLabel = locale === "ko" ? `${year}년` : locale === "ja" ? `${year}年` : year;

  type Row = { key: string; label: string; emoji?: string; months: number[]; total: number; items: Row[] };
  const sections = useMemo(() => {
    const yearTxs = state.transactions.filter((x) => x.date.startsWith(`${year}-`) && x.type !== "transfer");
    const build = (kind: CatKind) => {
      const byCat = new Map<string, Tx[]>();
      for (const x of yearTxs) {
        if (x.type !== kind) continue;
        const key = x.categoryId ?? "none";
        const list = byCat.get(key) ?? [];
        list.push(x);
        byCat.set(key, list);
      }
      // 카테고리 정의 순서 유지, 미분류는 마지막
      const orderedIds = [...state.categories.filter((c) => c.kind === kind).map((c) => c.id), "none"]
        .filter((id) => byCat.has(id));
      const rows: Row[] = orderedIds.map((id) => {
        const cat = state.categories.find((c) => c.id === id);
        const months = Array.from({ length: 12 }, () => 0);
        const byItem = new Map<string, number[]>();
        for (const x of byCat.get(id)!) {
          const mi = Number(x.date.slice(5, 7)) - 1;
          months[mi] += x.amount;
          const label = x.memo || catName(cat, locale);
          const arr = byItem.get(label) ?? Array.from({ length: 12 }, () => 0);
          arr[mi] += x.amount;
          byItem.set(label, arr);
        }
        const items: Row[] = [...byItem.entries()]
          .map(([label, m]) => ({ key: `${id}:${label}`, label, months: m, total: m.reduce((s, v) => s + v, 0), items: [] as Row[] }))
          .sort((a, b) => b.total - a.total);
        return {
          key: id, label: catName(cat, locale), emoji: cat?.emoji ?? "🏷️",
          months, total: months.reduce((s, v) => s + v, 0), items,
        };
      });
      const months = Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.months[i], 0));
      return { rows, months, total: months.reduce((s, v) => s + v, 0) };
    };
    return { income: build("income"), expense: build("expense") };
  }, [state.transactions, state.categories, year, locale]);

  const cell = (v: number) => (v === 0 ? "" : fmtMoneyShort(v, locale));
  const renderSection = (sec: { rows: Row[] }, cls: string) => sec.rows.map((r) => {
    const openKey = `${cls}:${r.key}`;
    return (
      <Fragment key={r.key}>
        <tr className="yr-cat" onClick={() => toggle(openKey)}>
          <th className="yr-label" scope="row">
            <span className="yr-caret">{open[openKey] ? "▾" : "▸"}</span>
            <span className="yr-emoji">{r.emoji}</span>{r.label}
          </th>
          {r.months.map((v, i) => <td key={i} className={cls === "income" ? "income" : ""}>{cell(v)}</td>)}
          <td className={`yr-total ${cls === "income" ? "income" : ""}`}>{cell(r.total)}</td>
        </tr>
        {open[openKey] && r.items.map((it) => (
          <tr key={it.key} className="yr-item">
            <th className="yr-label yr-indent" scope="row">{it.label}</th>
            {it.months.map((v, i) => <td key={i}>{cell(v)}</td>)}
            <td className="yr-total">{cell(it.total)}</td>
          </tr>
        ))}
      </Fragment>
    );
  });

  const hasData = sections.income.rows.length > 0 || sections.expense.rows.length > 0;
  const netMonths = Array.from({ length: 12 }, (_, i) => sections.income.months[i] - sections.expense.months[i]);
  const netTotal = sections.income.total - sections.expense.total;

  return (
    <div className="yearwrap">
      <div className="calhead">
        <span className="month">{yearLabel}</span>
        <div className="calnav">
          <button aria-label={t(locale, "nav.prevYear")} onClick={() => onYm(shiftYm(ym, -12))}>«</button>
          <button className="todaybtn" onClick={() => onYm(ymOf(todayStr()))}>{t(locale, "cal.today")}</button>
          <button aria-label={t(locale, "nav.nextYear")} onClick={() => onYm(shiftYm(ym, 12))}>»</button>
        </div>
      </div>
      {!hasData ? (
        <div className="empty">{t(locale, "yearly.empty")}</div>
      ) : (
        <div className="yearscroll pagepad">
          <table className="yeartable">
            <thead>
              <tr>
                <th className="yr-label" />
                {monthNames.map((m) => <th key={m}>{m}</th>)}
                <th>{t(locale, "yearly.total")}</th>
              </tr>
            </thead>
            <tbody>
              {renderSection(sections.income, "income")}
              <tr className="yr-sum yr-sum-income">
                <th className="yr-label" scope="row">{t(locale, "yearly.incomeTotal")}</th>
                {sections.income.months.map((v, i) => <td key={i}>{cell(v)}</td>)}
                <td className="yr-total">{cell(sections.income.total)}</td>
              </tr>
              {renderSection(sections.expense, "expense")}
              <tr className="yr-sum yr-sum-expense">
                <th className="yr-label" scope="row">{t(locale, "yearly.expenseTotal")}</th>
                {sections.expense.months.map((v, i) => <td key={i}>{cell(v)}</td>)}
                <td className="yr-total">{cell(sections.expense.total)}</td>
              </tr>
              <tr className="yr-sum yr-sum-net">
                <th className="yr-label" scope="row">{t(locale, "yearly.net")}</th>
                {netMonths.map((v, i) => <td key={i} className={v > 0 ? "income" : v < 0 ? "expense" : ""}>{cell(v)}</td>)}
                <td className={`yr-total ${netTotal > 0 ? "income" : netTotal < 0 ? "expense" : ""}`}>{cell(netTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 통계 (도넛 + 카테고리 막대 + 6개월 추이) ────────────────────────────
function StatsView({ locale, state, ym, monthTxs }: {
  locale: Locale; state: LedgerState; ym: string; monthTxs: Tx[];
}) {
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const expenseTotal = monthTxs.filter((x) => x.type === "expense").reduce((s, x) => s + x.amount, 0);

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of monthTxs) {
      if (x.type !== "expense") continue;
      const key = x.categoryId ?? "etc-expense";
      m.set(key, (m.get(key) ?? 0) + x.amount);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthTxs]);

  const prevYm = shiftYm(ym, -1);
  const prevTotal = state.transactions
    .filter((x) => x.type === "expense" && ymOf(x.date) === prevYm)
    .reduce((s, x) => s + x.amount, 0);
  const diff = expenseTotal - prevTotal;

  const trend = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => shiftYm(ym, i - 5));
    return months.map((m) => ({
      ym: m,
      total: state.transactions.filter((x) => x.type === "expense" && ymOf(x.date) === m).reduce((s, x) => s + x.amount, 0),
    }));
  }, [state.transactions, ym]);
  const trendMax = Math.max(1, ...trend.map((x) => x.total));

  // AI 월간 인사이트 — 버튼 클릭 시에만 생성 (LLM 호출 비용·지연 고려), 월 변경 시 초기화
  const [insights, setInsights] = useState<string[] | null>(null);
  const [insBusy, setInsBusy] = useState(false);
  const [insErr, setInsErr] = useState("");
  useEffect(() => { setInsights(null); setInsErr(""); }, [ym]);
  const loadInsights = async () => {
    setInsBusy(true);
    setInsErr("");
    try {
      setInsights((await api.aiInsights(ym, locale)).insights);
    } catch {
      setInsErr(t(locale, "ai.insights.fail"));
    } finally {
      setInsBusy(false);
    }
  };

  // AI 현금흐름 예측 — 버튼 클릭 시에만 생성
  const [forecast, setForecast] = useState<AiForecast | null>(null);
  const [fcBusy, setFcBusy] = useState(false);
  const [fcErr, setFcErr] = useState("");
  useEffect(() => { setForecast(null); setFcErr(""); }, [ym]);
  const loadForecast = async () => {
    setFcBusy(true);
    setFcErr("");
    try {
      setForecast(await api.aiForecast(ym, locale));
    } catch {
      setFcErr(t(locale, "ai.forecast.fail"));
    } finally {
      setFcBusy(false);
    }
  };

  // AI 이상거래·중복탐지 — 버튼 클릭 시에만 생성
  const [anomalies, setAnomalies] = useState<AiAnomalies | null>(null);
  const [anBusy, setAnBusy] = useState(false);
  const [anErr, setAnErr] = useState("");
  useEffect(() => { setAnomalies(null); setAnErr(""); }, [ym]);
  const loadAnomalies = async () => {
    setAnBusy(true);
    setAnErr("");
    try {
      setAnomalies(await api.aiAnomalies(locale));
    } catch {
      setAnErr(t(locale, "ai.anomalies.fail"));
    } finally {
      setAnBusy(false);
    }
  };

  if (expenseTotal === 0 && trend.every((x) => x.total === 0)) {
    return <div className="empty">{t(locale, "stats.empty")}</div>;
  }

  // SVG 도넛 세그먼트
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = byCat.map(([catId, amount], i) => {
    const frac = expenseTotal > 0 ? amount / expenseTotal : 0;
    const seg = { catId, frac, offset: acc, color: PALETTE[i % PALETTE.length] };
    acc += frac;
    return seg;
  });

  return (
    <div className="statsbody pagepad">
      <div className="donutwrap">
        <svg viewBox="0 0 100 100" className="donut">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--muted)" strokeWidth="12" />
          {segs.map((s) => (
            <circle key={s.catId} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth="12"
              strokeDasharray={`${Math.max(0.01, s.frac * C - 1)} ${C}`}
              strokeDashoffset={-s.offset * C} transform="rotate(-90 50 50)" strokeLinecap="butt" />
          ))}
        </svg>
        <div className="donutcenter">
          <span>{t(locale, "stats.title")}</span>
          <b>{fmtMoney(expenseTotal, locale)}</b>
          {prevTotal > 0 || expenseTotal > 0 ? (
            <em className={diff > 0 ? "expense" : "income"}>
              {diff === 0
                ? t(locale, "stats.prevDiff.same")
                : t(locale, diff > 0 ? "stats.prevDiff.more" : "stats.prevDiff.less", { amount: fmtMoneyShort(Math.abs(diff), locale) })}
            </em>
          ) : null}
        </div>
      </div>

      <h4 className="statsh">{t(locale, "stats.byCategory")}</h4>
      <div className="catbars">
        {byCat.map(([catId, amount], i) => {
          const c = cats.get(catId);
          const pct = expenseTotal > 0 ? Math.round((amount / expenseTotal) * 100) : 0;
          return (
            <div key={catId} className="catbar">
              <span className="cblabel">{c?.emoji ?? "🏷️"} {catName(c, locale)}</span>
              <span className="cbtrack"><span className="cbfill" style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }} /></span>
              <span className="cbamount">{fmtMoneyShort(amount, locale)} <em>{pct}%</em></span>
            </div>
          );
        })}
      </div>

      <h4 className="statsh">{t(locale, "stats.trend")}</h4>
      <div className="trend">
        {trend.map((x) => (
          <div key={x.ym} className="trendcol">
            <span className="tbarwrap"><span className={`tbar ${x.ym === ym ? "cur" : ""}`} style={{ height: `${Math.round((x.total / trendMax) * 100)}%` }} /></span>
            <span className="tlabel">{Number(x.ym.slice(5, 7))}{locale === "ko" ? "월" : locale === "ja" ? "月" : ""}</span>
          </div>
        ))}
      </div>

      <h4 className="statsh">✨ {t(locale, "ai.insights.title")}</h4>
      <div className="insightcard">
        {insights === null && !insBusy && !insErr && (
          <button className="cta" onClick={() => void loadInsights()}>{t(locale, "ai.insights.generate")}</button>
        )}
        {insBusy && <p className="subnote">{t(locale, "ai.insights.loading")}</p>}
        {insErr && (
          <>
            <p className="smartnotice">{insErr}</p>
            <button className="cta" onClick={() => void loadInsights()}>{t(locale, "ai.insights.generate")}</button>
          </>
        )}
        {insights?.map((s, i) => <p key={i} className="insightrow">💡 {s}</p>)}
      </div>

      <h4 className="statsh">📈 {t(locale, "ai.forecast.title")}</h4>
      <div className="insightcard">
        {forecast === null && !fcBusy && !fcErr && (
          <button className="cta" onClick={() => void loadForecast()}>{t(locale, "ai.forecast.generate")}</button>
        )}
        {fcBusy && <p className="subnote">{t(locale, "ai.forecast.loading")}</p>}
        {fcErr && (
          <>
            <p className="smartnotice">{fcErr}</p>
            <button className="cta" onClick={() => void loadForecast()}>{t(locale, "ai.forecast.generate")}</button>
          </>
        )}
        {forecast && (
          <>
            <p className="insightrow">{t(locale, "ai.forecast.spend")}: <b>{fmtMoney(forecast.predictedSpend, locale)}</b></p>
            <p className="insightrow">{t(locale, "ai.forecast.balance")}: <b className={forecast.predictedBalance < 0 ? "expense" : "income"}>{fmtMoney(forecast.predictedBalance, locale)}</b></p>
            <p className={`insightrow risk-${forecast.riskLevel}`}>{
              forecast.riskLevel === "high" ? "🔴 " : forecast.riskLevel === "medium" ? "🟡 " : "🟢 "
            }{t(locale, `ai.forecast.risk.${forecast.riskLevel}` as MsgKey)}</p>
            {forecast.warnings.map((w, i) => <p key={i} className="insightrow">⚠️ {w}</p>)}
          </>
        )}
      </div>

      <h4 className="statsh">🔍 {t(locale, "ai.anomalies.title")}</h4>
      <div className="insightcard">
        {anomalies === null && !anBusy && !anErr && (
          <button className="cta" onClick={() => void loadAnomalies()}>{t(locale, "ai.anomalies.generate")}</button>
        )}
        {anBusy && <p className="subnote">{t(locale, "ai.anomalies.loading")}</p>}
        {anErr && (
          <>
            <p className="smartnotice">{anErr}</p>
            <button className="cta" onClick={() => void loadAnomalies()}>{t(locale, "ai.anomalies.generate")}</button>
          </>
        )}
        {anomalies && anomalies.anomalies.length === 0 && anomalies.duplicateSubs.length === 0 && (
          <p className="subnote">{t(locale, "ai.anomalies.none")}</p>
        )}
        {anomalies?.anomalies.map((a, i) => (
          <p key={i} className={`insightrow risk-${a.severity}`}>
            {a.severity === "high" ? "🔴 " : a.severity === "medium" ? "🟡 " : "🟢 "}{a.description}
            {typeof a.amount === "number" ? ` (${fmtMoneyShort(a.amount, locale)})` : ""}
          </p>
        ))}
        {anomalies && anomalies.duplicateSubs.length > 0 && (
          <p className="insightrow">🔁 {t(locale, "ai.anomalies.dupsubs")}: {anomalies.duplicateSubs.join(", ")}</p>
        )}
      </div>
    </div>
  );
}

// ── 예산 ────────────────────────────────────────────────────────────────
function BudgetView({ locale, state, monthTxs, onSaved, showToast }: {
  locale: Locale; state: LedgerState; monthTxs: Tx[]; onSaved: () => void; showToast: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const expenseCats = state.categories.filter((c) => c.kind === "expense");
  const spentBy = new Map<string, number>();
  for (const x of monthTxs) {
    if (x.type !== "expense") continue;
    const key = x.categoryId ?? "etc-expense";
    spentBy.set(key, (spentBy.get(key) ?? 0) + x.amount);
  }
  const totalBudget = Object.values(state.budgets).reduce((s, v) => s + v, 0);
  const totalSpent = [...spentBy.entries()].filter(([k]) => state.budgets[k]).reduce((s, [, v]) => s + v, 0);

  const startEdit = () => {
    setDraft(Object.fromEntries(Object.entries(state.budgets).map(([k, v]) => [k, String(v)])));
    setEditing(true);
  };
  const save = async () => {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(draft)) {
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n > 0) next[k] = n;
    }
    try {
      await api.saveBudgets(next);
      setEditing(false);
      onSaved();
      showToast(t(locale, "toast.saved"));
    } catch {
      showToast(t(locale, "toast.saveFail"));
    }
  };

  if (editing) {
    return (
      <div className="budgetbody pagepad">
        <div className="budgetedit">
          {expenseCats.map((c) => (
            <label key={c.id} className="berow">
              <span>{c.emoji} {catName(c, locale)}</span>
              <input inputMode="numeric" placeholder={t(locale, "budget.ph")} value={draft[c.id] ?? ""}
                onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value.replace(/[^\d]/g, "") })} />
            </label>
          ))}
          <div className="confirmrow" style={{ marginTop: 12 }}>
            <button className="cbtn ghost" onClick={() => setEditing(false)}>{t(locale, "budget.cancel")}</button>
            <button className="cbtn primary" onClick={() => void save()}>{t(locale, "budget.save")}</button>
          </div>
        </div>
      </div>
    );
  }

  const entries = expenseCats.filter((c) => state.budgets[c.id]);
  return (
    <div className="budgetbody pagepad">
      {entries.length === 0 ? (
        <div className="empty">
          {t(locale, "budget.empty")}
          <br />
          <button className="cta" onClick={startEdit}>{t(locale, "budget.edit")}</button>
        </div>
      ) : (
        <>
          <div className="budgettotal">
            <span>{t(locale, "budget.total")}</span>
            <b>{fmtMoneyShort(totalSpent, locale)} / {fmtMoney(totalBudget, locale)}</b>
          </div>
          <div className="gauges">
            {entries.map((c) => {
              const budget = state.budgets[c.id];
              const spent = spentBy.get(c.id) ?? 0;
              const pct = Math.min(100, Math.round((spent / budget) * 100));
              const over = spent > budget;
              return (
                <div key={c.id} className="gauge">
                  <div className="ghead">
                    <span>{c.emoji} {catName(c, locale)}</span>
                    <span className={over ? "expense" : ""}>
                      {fmtMoneyShort(spent, locale)} / {fmtMoneyShort(budget, locale)}
                      {over
                        ? ` · ${t(locale, "budget.over")} ${fmtMoneyShort(spent - budget, locale)}`
                        : ` · ${t(locale, "budget.left")} ${fmtMoneyShort(budget - spent, locale)}`}
                    </span>
                  </div>
                  <div className="gtrack"><div className={`gfill ${over ? "over" : pct >= 80 ? "warn" : ""}`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          <button className="editbudget" onClick={startEdit}>{t(locale, "budget.edit")}</button>
        </>
      )}
    </div>
  );
}

// ── 구독 관리 ───────────────────────────────────────────────────────────
function SubsView({ locale, state, showToast, onChanged, onAdd, onEdit }: {
  locale: Locale; state: LedgerState; showToast: (m: string) => void; onChanged: () => void;
  onAdd: () => void; onEdit: (s: Subscription) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const active = state.subscriptions.filter((s) => s.active);
  const paused = state.subscriptions.filter((s) => !s.active);
  const monthlyTotal = active.reduce((s, x) => s + monthlyEquivalent(x), 0);
  const today = todayStr();
  const soonLimit = new Date();
  soonLimit.setDate(soonLimit.getDate() + 7);
  const soonStr = `${soonLimit.getFullYear()}-${String(soonLimit.getMonth() + 1).padStart(2, "0")}-${String(soonLimit.getDate()).padStart(2, "0")}`;

  const toggle = async (s: Subscription) => {
    try {
      await api.updateSub(s.id, { active: !s.active });
      onChanged();
    } catch {
      showToast(t(locale, "toast.saveFail"));
    }
  };
  const remove = async (s: Subscription) => {
    try {
      await api.removeSub(s.id);
      setConfirmId(null);
      onChanged();
      showToast(t(locale, "toast.deleted"));
    } catch {
      showToast(t(locale, "toast.saveFail"));
    }
  };

  const renderRow = (s: Subscription) => {
    const next = nextBillingDate(s);
    const soon = s.active && next >= today && next <= soonStr;
    return (
      <div key={s.id} className={`subrow ${s.active ? "" : "off"}`}>
        <button className="subinfo" onClick={() => onEdit(s)}>
          <span className="subname">
            {s.name}
            {soon && <em className="soontag">{t(locale, "subs.soon")}</em>}
            {!s.active && <em className="pausedtag">{t(locale, "subs.paused")}</em>}
          </span>
          <span className="submeta">
            {t(locale, s.cycle === "monthly" ? "subs.cycle.monthly" : "subs.cycle.yearly")}
            {" · "}{fmtMoney(s.amount, locale)}
            {s.active && ` · ${t(locale, "subs.next")} ${next.slice(5).replace("-", "/")}`}
          </span>
        </button>
        <div className="subacts">
          <button className="pill" onClick={() => void toggle(s)}>{t(locale, s.active ? "subs.pause" : "subs.resume")}</button>
          <button className="pill danger" onClick={() => setConfirmId(s.id)}>{t(locale, "subs.delete")}</button>
        </div>
        {confirmId === s.id && (
          <div className="confirmbox" style={{ marginTop: 8, width: "100%" }}>
            <p>{t(locale, "subs.deleteConfirm", { name: s.name })}</p>
            <div className="confirmrow">
              <button className="cbtn ghost" onClick={() => setConfirmId(null)}>{t(locale, "common.cancel")}</button>
              <button className="cbtn danger" onClick={() => void remove(s)}>{t(locale, "subs.delete")}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="subsbody pagepad">
      <div className="substotal">
        <div>
          <span>{t(locale, "subs.monthlyTotal")}</span>
          <b>{fmtMoney(monthlyTotal, locale)}</b>
          <em>{t(locale, "subs.count", { n: active.length })}</em>
        </div>
        <button className="cta" onClick={onAdd}>＋ {t(locale, "subs.add")}</button>
      </div>
      <p className="subnote">{t(locale, "subs.autoNote")}</p>
      {state.subscriptions.length === 0 ? (
        <div className="empty">{t(locale, "subs.empty")}</div>
      ) : (
        <div className="sublist">
          {active.map(renderRow)}
          {paused.map(renderRow)}
        </div>
      )}
    </div>
  );
}

// ── 자산관리 (재무설계) ─────────────────────────────────────────────────
const KIND_ORDER: HoldingKind[] = ["deposit", "savings", "stock", "etf", "crypto", "fx", "gold", "loan", "receivable", "payable"];
const KIND_EMOJI: Record<HoldingKind, string> = {
  deposit: "🏦", savings: "💰", stock: "📈", etf: "📊", crypto: "🪙", fx: "💱", gold: "🥇",
  loan: "🏧", receivable: "🤝", payable: "💸",
};
const ASSET_EMOJI: Record<string, string> = {
  cash: "💵", bank: "🏦", card: "💳", savings: "💰", loan: "🏧", receivable: "🤝", payable: "💸",
};
const EXCHANGES: { value: string; label: MsgKey }[] = [
  { value: "KRX", label: "am.ex.krx" },
  { value: "NAS", label: "am.ex.nas" },
  { value: "NYS", label: "am.ex.nys" },
  { value: "AMS", label: "am.ex.ams" },
  { value: "HKS", label: "am.ex.hks" },
  { value: "TSE", label: "am.ex.tse" },
  { value: "SHS", label: "am.ex.shs" },
  { value: "SZS", label: "am.ex.szs" },
];

// 주식 시세 키: 국내 = ticker, 해외 = "EXCD:ticker" (서버 quotes 키와 동일 규칙)
function stockKey(h: Holding): string {
  return h.exchange && h.exchange !== "KRX" ? `${h.exchange}:${h.ticker}` : (h.ticker ?? "");
}
// 해외주식 원화 환산 환율 (현지통화 → KRW, 없으면 1)
function stockFxRate(h: Holding, quotes: Quotes | null): number {
  if (!h.exchange || h.exchange === "KRX") return 1;
  const cur = quotes?.stocks[stockKey(h)]?.currency;
  return (cur && quotes?.fx[cur]) || 1;
}

function holdingCost(h: Holding): number {
  switch (h.kind) {
    case "deposit": return h.principal ?? 0;
    case "savings": return h.principal ?? 0;
    case "loan": case "payable": return -(h.principal ?? 0);
    case "receivable": return h.principal ?? 0;
    // 평단 입력 기준은 원화 — 해외주식도 원화 평단 × 수량 (수익률에 환율 효과 포함)
    case "stock": case "etf": case "crypto": return (h.avgPrice ?? 0) * (h.qty ?? 0);
    case "fx": return (h.avgRate ?? 0) * (h.amount ?? 0);
    case "gold": return (h.avgPricePerGram ?? 0) * (h.grams ?? 0);
  }
}

// 평가액: 시세 있으면 시세 기준(live), 없으면 매입가 기준. 예적금은 이율 자동 계산.
function holdingValue(h: Holding, quotes: Quotes | null): { value: number; live: boolean; changePct: number | null } {
  const fallback = { value: Math.round(holdingCost(h)), live: false, changePct: null };
  switch (h.kind) {
    case "deposit":
      return { value: depositValue(h.principal ?? 0, h.ratePct ?? 0, h.startDate ?? todayStr(), h.maturityDate), live: false, changePct: null };
    case "savings":
      return { value: h.principal ?? 0, live: false, changePct: null };
    case "stock": case "etf": {
      const q = h.ticker ? quotes?.stocks[stockKey(h)] : undefined;
      return q
        ? { value: Math.round(q.price * (h.qty ?? 0) * stockFxRate(h, quotes)), live: true, changePct: q.changePct }
        : fallback;
    }
    case "crypto": {
      const q = h.market ? quotes?.crypto[h.market] : undefined;
      return q ? { value: Math.round(q.price * (h.qty ?? 0)), live: true, changePct: q.changePct } : fallback;
    }
    case "fx": {
      const r = h.currency ? quotes?.fx[h.currency] : undefined;
      return r ? { value: Math.round(r * (h.amount ?? 0)), live: true, changePct: null } : fallback;
    }
    case "gold": {
      const g = quotes?.gold;
      return g ? { value: Math.round(g.krwPerGram * (h.grams ?? 0)), live: true, changePct: null } : fallback;
    }
    default: return fallback;
  }
}

function holdingMeta(h: Holding, locale: Locale): string {
  const parts: string[] = [];
  if (h.kind === "deposit" || h.kind === "savings") {
    parts.push(`${t(locale, "am.ratePct").replace(" (%)", "")} ${h.ratePct ?? 0}%`);
    const d = daysToMaturity(h.maturityDate);
    if (d !== null) parts.push(d >= 0 ? t(locale, "am.maturityDday", { n: d }) : t(locale, "am.matured"));
  } else if (h.kind === "stock" || h.kind === "etf") {
    if (h.ticker) parts.push(h.exchange && h.exchange !== "KRX" ? `${h.exchange}:${h.ticker}` : h.ticker);
    parts.push(`${h.qty ?? 0} × ${fmtMoneyShort(h.avgPrice ?? 0, locale)}`);
  } else if (h.kind === "crypto") {
    if (h.market) parts.push(h.market);
    parts.push(String(h.qty ?? 0));
  } else if (h.kind === "fx") {
    parts.push(`${h.currency ?? ""} ${h.amount ?? 0}`);
  } else if (h.kind === "gold") {
    parts.push(`${h.grams ?? 0}g`);
  } else if (h.kind === "loan" || h.kind === "receivable" || h.kind === "payable") {
    if (h.interestRate) parts.push(`${h.interestRate.toFixed(2)}%`);
    const date = h.kind === "loan" ? h.loanDate : h.kind === "receivable" ? h.lentDate : h.borrowedDate;
    if (date) parts.push(date);
  }
  return parts.join(" · ");
}

// 자산 구성 도넛 (가계부 통계 도넛과 동일 세그먼트 방식)
function AssetDonut({ title, total, entries, fmt }: {
  title: string; total: number; fmt: (n: number) => string;
  entries: { value: number; color: string }[];
}) {
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = entries.map((e) => {
    const frac = total > 0 ? e.value / total : 0;
    const seg = { ...e, frac, offset: acc };
    acc += frac;
    return seg;
  });
  return (
    <div className="amdonutwrap">
      <svg viewBox="0 0 100 100" className="donut">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--muted)" strokeWidth="12" />
        {segs.map((s, i) => (
          <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth="12"
            strokeDasharray={`${Math.max(0.01, s.frac * C - 1)} ${C}`}
            strokeDashoffset={-s.offset * C} transform="rotate(-90 50 50)" strokeLinecap="butt" />
        ))}
      </svg>
      <div className="donutcenter">
        <span>{title}</span>
        <b>{fmt(total)}</b>
      </div>
    </div>
  );
}

// 순자산 추이 차트 (스냅샷 기반 SVG)
function TrendChart({ snapshots }: { snapshots: { date: string; total: number }[] }) {
  const data = snapshots.slice(-90);
  if (data.length < 2) return null;
  const W = 600, H = 120, PAD = 6;
  const min = Math.min(...data.map((d) => d.total));
  const max = Math.max(...data.map((d) => d.total));
  const span = max - min || 1;
  const pts = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (d.total - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="trendchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polygon points={`${PAD},${H - PAD} ${pts.join(" ")} ${W - PAD},${H - PAD}`} className="trendfill" />
      <polyline points={pts.join(" ")} className="trendline" fill="none" />
    </svg>
  );
}

function AssetMgmtView({ locale, state, showToast, onChanged, displayCurrency, tab, onAddCash, onEditCash }: {
  locale: Locale; state: LedgerState; showToast: (m: string) => void; onChanged: () => void;
  displayCurrency: DisplayCurrency; tab: AssetTab; onAddCash: () => void; onEditCash: (a: Asset) => void;
}) {
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [syncing, setSyncing] = useState<"kis" | "upbit" | null>(null);
  const [modal, setModal] = useState<{ open: boolean; edit?: Holding }>({ open: false });
  const [dividends, setDividends] = useState<Dividends | null>(null);
  const [divYear, setDivYear] = useState(new Date().getFullYear());
  const [divSubTab, setDivSubTab] = useState<"byMonth" | "byInstrument">("byInstrument");

  // 배당금 탭 진입 시 1회 로드 (서버 1시간 캐시)
  useEffect(() => {
    if (tab !== "dividends" || dividends) return;
    let alive = true;
    api.dividends()
      .then((d) => {
        if (!alive) return;
        setDividends(d);
        if (d.errors.length > 0) showToast(t(locale, "am.quotesFail"));
      })
      .catch(() => { if (alive) showToast(t(locale, "toast.loadFail")); });
    return () => { alive = false; };
  }, [tab]);

  useEffect(() => {
    let alive = true;
    api.quotes()
      .then((q) => {
        if (!alive) return;
        setQuotes(q);
        if (q.errors.length > 0) showToast(t(locale, "am.quotesFail"));
      })
      .catch(() => { if (alive) showToast(t(locale, "am.quotesFail")); });
    return () => { alive = false; };
  }, [state.holdings.length]);

  const cashTotal = state.assets.reduce((s, a) => s + assetBalance(a, state.transactions), 0);
  const rows = useMemo(() => state.holdings.map((h) => {
    const base = holdingValue(h, quotes);
    if (h.kind !== "savings") return { h, ...base };
    const txDelta = state.transactions
      .filter((tx) => tx.type === "transfer" && (tx.toAssetId === h.id || tx.assetId === h.id))
      .reduce((s, tx) => s + (tx.toAssetId === h.id ? tx.amount : -tx.amount), 0);
    return { h, ...base, value: base.value + txDelta };
  }), [state.holdings, quotes, state.transactions]);
  const byKind = useMemo(() => {
    const out: Record<string, number> = {};
    if (cashTotal !== 0 || state.assets.length > 0) out.cashlike = cashTotal;
    for (const r of rows) out[r.h.kind] = (out[r.h.kind] ?? 0) + r.value;
    return out;
  }, [rows, cashTotal, state.assets.length]);
  const total = cashTotal + rows.reduce((s, r) => s + r.value, 0);
  const byCurrency = useMemo(() => {
    const out: Record<string, number> = {};
    if (cashTotal > 0) out.KRW = (out.KRW ?? 0) + cashTotal;
    for (const { h, value } of rows) {
      let cur = "KRW";
      if (h.kind === "fx" && h.currency) {
        cur = h.currency;
      } else if ((h.kind === "stock" || h.kind === "etf") && h.exchange && h.exchange !== "KRX") {
        cur = quotes?.stocks[stockKey(h)]?.currency ?? "USD";
      }
      out[cur] = (out[cur] ?? 0) + value;
    }
    return out;
  }, [rows, cashTotal, quotes]);

  // 전일 대비: 오늘 이전 가장 최근 스냅샷과 비교
  const prev = useMemo(() => [...state.snapshots].reverse().find((s) => s.date < todayStr()), [state.snapshots]);
  const dayChange = prev ? total - prev.total : null;

  // 일별 순자산 스냅샷 저장 (서버가 날짜별 upsert — 하루 1개 유지)
  useEffect(() => {
    if (!quotes) return;
    api.saveSnapshot({ date: todayStr(), total, byKind }).catch(() => { /* 스냅샷 실패는 무시 */ });
  }, [quotes]);

  const sync = async (which: "kis" | "upbit") => {
    setSyncing(which);
    try {
      const r = which === "kis" ? await api.syncKis() : await api.syncUpbit();
      showToast(t(locale, "am.syncDone", { added: r.added, updated: r.updated }));
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t(locale, "toast.loadFail"));
    } finally {
      setSyncing(null);
    }
  };

  const trendData = [...state.snapshots.filter((s) => s.date < todayStr()), { date: todayStr(), total }];

  // 표시 통화 변환 (내부 계산·스냅샷은 원화 고정, 표시만 USD 환산)
  const usdRate = quotes?.fx.USD ?? null;
  const toUsd = displayCurrency === "USD" && usdRate !== null;
  const fmtAmt = (n: number): string =>
    toUsd ? `$${(n / usdRate!).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : fmtMoneyShort(n, locale);
  const fmtAmtFull = (n: number): string => (toUsd ? fmtAmt(n) : fmtMoney(n, locale));

  return (
    <div className="ambody pagepad">
      <div className="amhero">
        <div>
          <span>{t(locale, "am.total")}</span>
          <b>{fmtAmtFull(total)}</b>
          {dayChange !== null && (
            <em className={dayChange > 0 ? "up" : dayChange < 0 ? "down" : ""}>
              {t(locale, "am.dayChange")} {dayChange >= 0 ? "+" : "−"}{fmtAmt(Math.abs(dayChange))}
            </em>
          )}
        </div>
        <div className="amactions">
          <button className="pill" disabled={syncing !== null} onClick={() => void sync("kis")}>
            {syncing === "kis" ? t(locale, "am.syncing") : `🏛 ${t(locale, "am.sync.kis")}`}
          </button>
          <button className="pill" disabled={syncing !== null} onClick={() => void sync("upbit")}>
            {syncing === "upbit" ? t(locale, "am.syncing") : `🪙 ${t(locale, "am.sync.upbit")}`}
          </button>
          <button className="cta" onClick={() => setModal({ open: true })}>＋ {t(locale, "am.add")}</button>
        </div>
      </div>

      {tab === "stats" && trendData.length >= 2 && (
        <>
          <h4 className="amsecthead">{t(locale, "am.trend")}</h4>
          <TrendChart snapshots={trendData} />
        </>
      )}

      {tab === "stats" && total > 0 && (
        <>
          <h4 className="amsecthead">{t(locale, "am.stats.composition")}</h4>
          <div className="amstatflex">
            <AssetDonut title={t(locale, "am.stats.byKind")} total={total} fmt={fmtAmt}
              entries={Object.entries(byKind).sort((a, b) => b[1] - a[1])
                .map(([, val], i) => ({ value: val, color: PALETTE[i % PALETTE.length] }))} />
            <div className="amstatlist">
              <div className="amstatsubtitle">{t(locale, "am.stats.byKind")}</div>
              {Object.entries(byKind)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, val], i) => {
                  const pct = (val / total) * 100;
                  const emoji = kind === "cashlike" ? "💵" : KIND_EMOJI[kind as HoldingKind] ?? "💰";
                  return (
                    <div key={kind} className="amstatrow">
                      <span className="amstatlabel">{emoji} {t(locale, `am.kind.${kind}` as MsgKey)}</span>
                      <div className="amstatbar">
                        <div className="amstatfill" style={{ width: `${Math.min(100, pct).toFixed(1)}%`, background: PALETTE[i % PALETTE.length] }} />
                      </div>
                      <span className="amstatpct">{pct.toFixed(1)}%</span>
                      <span className="amstatamt">{fmtAmt(val)}</span>
                    </div>
                  );
                })}
            </div>
          </div>
          {Object.keys(byCurrency).length > 1 && (
            <div className="amstatflex">
              <AssetDonut title={t(locale, "am.stats.byCurrency")} total={total} fmt={fmtAmt}
                entries={Object.entries(byCurrency).sort((a, b) => b[1] - a[1])
                  .map(([, val], i) => ({ value: val, color: PALETTE[(i + 5) % PALETTE.length] }))} />
              <div className="amstatlist">
                <div className="amstatsubtitle">{t(locale, "am.stats.byCurrency")}</div>
                {Object.entries(byCurrency)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cur, val], i) => {
                    const pct = (val / total) * 100;
                    return (
                      <div key={cur} className="amstatrow">
                        <span className="amstatlabel">{cur}</span>
                        <div className="amstatbar">
                          <div className="amstatfill" style={{ width: `${Math.min(100, pct).toFixed(1)}%`, background: PALETTE[(i + 5) % PALETTE.length] }} />
                        </div>
                        <span className="amstatpct">{pct.toFixed(1)}%</span>
                        <span className="amstatamt">{fmtAmt(val)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      {/* 배당금 (보유 주식·ETF 기준 추정) */}
      {tab === "dividends" && (() => {
        if (!dividends) return <div className="empty">…</div>;
        const today = todayStr();
        const isUpcoming = (ev: { payDate: string | null }) => !ev.payDate || ev.payDate > today;
        const yearStr = String(divYear);
        const items = dividends.items.filter((it) => it.events.length > 0);
        const fmtPerShare = (perShare: number, currency: string) =>
          currency === "KRW" ? `${perShare.toLocaleString()}원` : `${currency === "USD" ? "$" : `${currency} `}${perShare}`;
        const monthlyTotals = Array.from({ length: 12 }, (_, i) => {
          const m = String(i + 1).padStart(2, "0");
          const prefix = `${yearStr}-${m}`;
          return dividends.items.reduce((s, it) =>
            s + it.events.filter((ev) => ev.payDate?.startsWith(prefix)).reduce((ss, ev) => ss + ev.amountKrw, 0), 0);
        });
        const yearTotal = monthlyTotals.reduce((s, v) => s + v, 0);
        const maxBar = Math.max(...monthlyTotals, 1);
        const upcoming = dividends.items.reduce((s, it) =>
          s + it.events.filter((ev) => isUpcoming(ev)).reduce((ss, ev) => ss + ev.amountKrw, 0), 0);
        return (
          <>
            <div className="calhead" style={{ paddingTop: 0 }}>
              <div className="calnav">
                <button className="pill" onClick={() => setDivYear(divYear - 1)}>«</button>
                <span style={{ fontWeight: 700, fontSize: "var(--fs-l)", padding: "0 8px" }}>{divYear}{locale === "ko" ? "년" : locale === "ja" ? "年" : ""}</span>
                <button className="pill" onClick={() => setDivYear(divYear + 1)}>»</button>
              </div>
            </div>
            <div style={{ margin: "0 0 32px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: "var(--fs-s)", color: "var(--fg-muted)" }}>{t(locale, "am.div.yearTotal")}</span>
                <b className="income" style={{ fontSize: 15 }}>{fmtAmt(yearTotal)}</b>
              </div>
              <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 180 }}>
                {monthlyTotals.map((v, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div
                      role="img"
                      aria-label={`${i + 1}${locale === "ko" ? "월" : locale === "ja" ? "月" : ""} ${fmtAmt(v)}`}
                      title={`${i + 1}${locale === "ko" ? "월" : locale === "ja" ? "月" : ""} ${fmtAmt(v)}`}
                      style={{
                        width: "100%",
                        height: v > 0 ? `${Math.max(4, Math.round((v / maxBar) * 140))}px` : "2px",
                        background: v > 0 ? "var(--primary)" : "var(--muted)",
                        borderRadius: "3px 3px 0 0",
                        transition: "height 0.3s",
                      }}
                    />
                    <span style={{ fontSize: 9, color: "var(--fg-muted)", lineHeight: 1 }}>{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="sumrow" style={{ padding: "0 0 28px", gridTemplateColumns: "repeat(2, 1fr)" }}>
              <div className="sumcell"><span>{t(locale, "am.div.upcoming")}</span><b>{fmtAmt(upcoming)}</b></div>
              <div className="sumcell"><span>{t(locale, "am.div.count")}</span><b>{items.length}</b></div>
            </div>
            <div className="typetoggle" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 24 }}>
              <button className={divSubTab === "byMonth" ? "active" : ""} onClick={() => setDivSubTab("byMonth")}>{t(locale, "am.div.byMonth")}</button>
              <button className={divSubTab === "byInstrument" ? "active" : ""} onClick={() => setDivSubTab("byInstrument")}>{t(locale, "am.div.byInstrument")}</button>
            </div>
            {items.length === 0 ? (
              <div className="empty" style={{ whiteSpace: "pre-line" }}>{t(locale, "am.div.empty")}</div>
            ) : divSubTab === "byMonth" ? (
              <>
                {monthlyTotals.map((v, i) => {
                  const m = String(i + 1).padStart(2, "0");
                  return (
                    <div key={i} className="amrow" style={{ cursor: "default", opacity: v === 0 ? 0.4 : 1 }}>
                      <span className="amrowname">{divYear}.{m}</span>
                      <span className="amrowval"><b className={v > 0 ? "income" : ""}>{fmtAmt(v)}</b></span>
                    </div>
                  );
                })}
              </>
            ) : (
              items.map((it) => {
                const yearEvents = it.events.filter((ev) => ev.payDate?.startsWith(yearStr) || isUpcoming(ev));
                if (yearEvents.length === 0) return null;
                const itemSum = yearEvents.filter((ev) => !isUpcoming(ev)).reduce((s, ev) => s + ev.amountKrw, 0);
                const sorted = [...yearEvents].sort((a, z) => (z.payDate ?? "9999").localeCompare(a.payDate ?? "9999"));
                return (
                  <div key={it.holdingId} className="amgroup">
                    <div className="amgrouphead">
                      <span>{it.name} <i className="divticker">{it.exchange !== "KRX" ? `${it.exchange}:${it.ticker}` : it.ticker}</i></span>
                      <div className="amgroupacts"><b>{fmtAmt(itemSum)}</b></div>
                    </div>
                    {sorted.map((ev, idx) => (
                      <div key={idx} className="amrow" style={{ cursor: "default" }}>
                        <span className="amrowname">
                          {ev.payDate ?? t(locale, "am.div.upcoming")}
                          <em>{t(locale, "am.div.perShare")} {ev.perShare > 0 ? fmtPerShare(ev.perShare, it.currency) : t(locale, "am.div.unannounced")} × {it.qty}</em>
                        </span>
                        <span className="amrowval">
                          <b>{ev.perShare > 0 ? fmtAmt(ev.amountKrw) : "—"}</b>
                          {isUpcoming(ev) && <em><i className="divtag">{t(locale, "am.div.upcoming")}</i></em>}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
            <p className="subnote" style={{ paddingTop: 6 }}>{t(locale, "am.div.note")}</p>
          </>
        );
      })()}

      {/* 현금·계좌 (가계부 자산 연동) */}
      {tab === "list" && (
      <>
      <div className="amgroup">
        <div className="amgrouphead">
          <span>💵 {t(locale, "am.kind.cashlike")}</span>
          <div className="amgroupacts">
            <b>{fmtAmt(cashTotal)}</b>
            <button className="pill" onClick={onAddCash}>＋</button>
          </div>
        </div>
        {state.assets.map((a) => (
          <button key={a.id} className="amrow" onClick={() => onEditCash(a)}>
            <span className="amrowname">
              {ASSET_EMOJI[a.type] ?? "💼"} {a.name}
              <em>{t(locale, `assets.type.${a.type}` as MsgKey)}</em>
            </span>
            <span className="amrowval"><b>{fmtAmt(assetBalance(a, state.transactions))}</b></span>
          </button>
        ))}
      </div>

      {/* 유형별 보유 자산 */}
      {KIND_ORDER.map((kind) => {
        const group = rows.filter((r) => r.h.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind} className="amgroup">
            <div className="amgrouphead">
              <span>{KIND_EMOJI[kind]} {t(locale, `am.kind.${kind}` as MsgKey)}</span>
              <div className="amgroupacts"><b>{fmtAmt(byKind[kind] ?? 0)}</b></div>
            </div>
            {group.map(({ h, value, live, changePct }) => {
              const cost = Math.round(holdingCost(h));
              const profit = value - cost;
              const profitPct = cost > 0 ? (profit / cost) * 100 : null;
              return (
                <button key={h.id} className="amrow" onClick={() => setModal({ open: true, edit: h })}>
                  <span className="amrowname">
                    {h.name}
                    <em>{holdingMeta(h, locale)}{h.kind === "deposit" || h.kind === "savings" ? ` · ${t(locale, "am.interestNote")}` : ""}</em>
                  </span>
                  <span className="amrowval">
                    <b>{fmtAmt(value)}</b>
                    <em>
                      {profitPct !== null && cost > 0 && (
                        <i className={profit > 0 ? "up" : profit < 0 ? "down" : ""}>
                          {profit >= 0 ? "+" : "−"}{fmtAmt(Math.abs(profit))} ({profitPct.toFixed(1)}%)
                        </i>
                      )}
                      {live && changePct !== null && (
                        <i className={changePct > 0 ? "up" : changePct < 0 ? "down" : ""}>
                          {" "}{changePct >= 0 ? "▲" : "▼"}{Math.abs(changePct).toFixed(2)}%
                        </i>
                      )}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}

      {state.holdings.length === 0 && state.assets.length === 0 && (
        <div className="empty" style={{ whiteSpace: "pre-line" }}>{t(locale, "am.empty")}</div>
      )}
      </>
      )}

      {quotes && (
        <p className="subnote" style={{ paddingTop: 10 }}>
          {t(locale, "am.priceAsOf")}: {new Date(quotes.fetchedAt).toLocaleTimeString()}
          {Object.keys(quotes.fx).length > 0 && (
            <> · {t(locale, "am.fxApplied")}
              {" ("}{quotes.fxSource === "KIS" ? t(locale, "am.fxSrc.kis")
                : quotes.fxSource === "KIS+ECB" ? `${t(locale, "am.fxSrc.kis")}+ECB` : "ECB"}{", ₩): "}
              {Object.entries(quotes.fx)
                .map(([c, r]) => `${c} ${r.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
                .join(" · ")}</>
          )}
        </p>
      )}

      {modal.open && (
        <HoldingModal locale={locale} edit={modal.edit} showToast={showToast}
          onClose={() => setModal({ open: false })}
          onSaved={() => { setModal({ open: false }); onChanged(); showToast(t(locale, "toast.saved")); }}
          onDeleted={() => { setModal({ open: false }); onChanged(); showToast(t(locale, "toast.deleted")); }} />
      )}
    </div>
  );
}

// ── 설정 ────────────────────────────────────────────────────────────────
function SettingsView({ locale, displayCurrency, onChangeCurrency }: {
  locale: Locale; displayCurrency: DisplayCurrency; onChangeCurrency: (c: DisplayCurrency) => void;
}) {
  return (
    <div className="ambody pagepad">
      <h4 className="amsecthead" style={{ marginTop: 16 }}>{t(locale, "menu.settings")}</h4>
      <label className="frow" style={{ maxWidth: 360 }}>
        <span>{t(locale, "set.displayCurrency")}</span>
        <Select value={displayCurrency} onChange={(v) => onChangeCurrency(v as DisplayCurrency)}
          options={[
            { value: "KRW", label: t(locale, "set.krw") },
            { value: "USD", label: t(locale, "set.usd") },
          ]} />
      </label>
      <p className="subnote">{t(locale, "set.note")}</p>
    </div>
  );
}

// ── 모달: 보유 자산 추가/수정 ───────────────────────────────────────────
function HoldingModal({ locale, edit, onClose, onSaved, onDeleted, showToast }: {
  locale: Locale; edit?: Holding; onClose: () => void; onSaved: () => void; onDeleted: () => void;
  showToast: (m: string) => void;
}) {
  const [kind, setKind] = useState<HoldingKind>(edit?.kind ?? "deposit");
  const [name, setName] = useState(edit?.name ?? "");
  const [f, setF] = useState<Record<string, string>>({
    principal: edit?.principal != null ? String(edit.principal) : "",
    ratePct: edit?.ratePct != null ? String(edit.ratePct) : "",
    monthlyDeposit: edit?.monthlyDeposit != null ? String(edit.monthlyDeposit) : "",
    ticker: edit?.ticker ?? "",
    market: edit?.market ?? "",
    qty: edit?.qty != null ? String(edit.qty) : "",
    avgPrice: edit?.avgPrice != null ? String(edit.avgPrice) : "",
    currency: edit?.currency ?? "",
    amount: edit?.amount != null ? String(edit.amount) : "",
    avgRate: edit?.avgRate != null ? String(edit.avgRate) : "",
    grams: edit?.grams != null ? String(edit.grams) : "",
    avgPricePerGram: edit?.avgPricePerGram != null ? String(edit.avgPricePerGram) : "",
    interestRate: edit?.interestRate != null ? String(edit.interestRate) : "",
  });
  const [exchange, setExchange] = useState(edit?.exchange ?? "KRX");
  const [startDate, setStartDate] = useState(edit?.startDate ?? todayStr());
  const [maturityOn, setMaturityOn] = useState(Boolean(edit?.maturityDate));
  const [maturityDate, setMaturityDate] = useState(edit?.maturityDate ?? todayStr());
  const [savingsInitial, setSavingsInitial] = useState(
    Boolean(edit?.kind === "savings" && (edit?.principal ?? 0) > 0)
  );
  const [loanDate, setLoanDate] = useState(edit?.loanDate ?? todayStr());
  const [lentDate, setLentDate] = useState(edit?.lentDate ?? todayStr());
  const [borrowedDate, setBorrowedDate] = useState(edit?.borrowedDate ?? todayStr());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k: string, allowDot: boolean) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value.replace(allowDot ? /[^\d.]/g : /[^\d]/g, "") });
  const num = (k: string) => Number(f[k]) || 0;

  const save = async () => {
    if (!name.trim()) return showToast(t(locale, "toast.saveFail"));
    setBusy(true);
    const body: Partial<Holding> = { kind, name: name.trim() };
    if (kind === "deposit" || kind === "savings") {
      body.principal = kind === "savings" ? (savingsInitial ? num("principal") : 0) : num("principal");
      body.ratePct = num("ratePct");
      body.startDate = startDate;
      body.maturityDate = maturityOn ? maturityDate : null;
    } else if (kind === "stock" || kind === "etf") {
      body.ticker = f.ticker.trim();
      body.exchange = exchange;
      body.qty = num("qty");
      body.avgPrice = num("avgPrice");
    } else if (kind === "crypto") {
      body.market = f.market.trim();
      body.qty = num("qty");
      body.avgPrice = num("avgPrice");
    } else if (kind === "fx") {
      body.currency = f.currency.trim();
      body.amount = num("amount");
      body.avgRate = num("avgRate");
    } else if (kind === "gold") {
      body.grams = num("grams");
      body.avgPricePerGram = num("avgPricePerGram");
    } else if (kind === "loan" || kind === "receivable" || kind === "payable") {
      body.principal = num("principal");
      if (num("interestRate") > 0) body.interestRate = num("interestRate");
      if (kind === "loan") body.loanDate = loanDate;
      else if (kind === "receivable") body.lentDate = lentDate;
      else body.borrowedDate = borrowedDate;
    }
    try {
      if (edit) await api.updateHolding(edit.id, body);
      else await api.addHolding(body);
      onSaved();
    } catch {
      showToast(t(locale, "toast.saveFail"));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await api.removeHolding(edit.id);
      onDeleted();
    } catch {
      showToast(t(locale, "toast.saveFail"));
      setBusy(false);
    }
  };

  const numInput = (key: string, label: MsgKey, allowDot: boolean, ph = "0") => (
    <label className="frow">
      <span>{t(locale, label)}</span>
      <input inputMode="decimal" value={f[key]} placeholder={ph} onChange={set(key, allowDot)} />
    </label>
  );

  return (
    <Modal onClose={onClose} title={t(locale, edit ? "am.edit" : "am.add")}>
      <label className="frow">
        <span>{t(locale, "am.kind")}</span>
        <Select value={kind} onChange={(v) => setKind(v as HoldingKind)}
          options={KIND_ORDER.map((k) => ({ value: k, label: `${KIND_EMOJI[k]} ${t(locale, `am.kind.${k}` as MsgKey)}` }))} />
      </label>
      <label className="frow">
        <span>{t(locale, "am.name")}</span>
        <input autoFocus value={name} placeholder={t(locale, "am.name.ph")} maxLength={60}
          onChange={(e) => setName(e.target.value)} />
      </label>

      {(kind === "deposit" || kind === "savings") && (
        <>
          {kind === "deposit" && numInput("principal", "am.principal", false)}
          {kind === "savings" && <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.5 }}>{t(locale, "am.savings.hint")}</p>}
          {kind === "savings" && (
            <label className="frow">
              <span>{t(locale, "am.savings.initialToggle")}</span>
              {savingsInitial ? (
                <button type="button" className="pill" style={{ alignSelf: "flex-start" }}
                  onClick={() => { setSavingsInitial(false); setF({ ...f, principal: "0" }); }}>✕ OFF</button>
              ) : (
                <button type="button" className="pill" style={{ alignSelf: "flex-start" }}
                  onClick={() => setSavingsInitial(true)}>＋ ON</button>
              )}
            </label>
          )}
          {kind === "savings" && savingsInitial && numInput("principal", "am.principal", false)}
          {numInput("ratePct", "am.ratePct", true, "3.5")}
          <label className="frow">
            <span>{t(locale, "am.startDate")}</span>
            <DatePicker locale={locale} value={startDate} onChange={setStartDate} />
          </label>
          <label className="frow">
            <span>{t(locale, "am.maturityDate")}</span>
            {maturityOn ? (
              <div className="amrowflex">
                <DatePicker locale={locale} value={maturityDate} onChange={setMaturityDate} />
                <button type="button" className="pill" onClick={() => setMaturityOn(false)}>✕</button>
              </div>
            ) : (
              <button type="button" className="pill" style={{ alignSelf: "flex-start" }} onClick={() => setMaturityOn(true)}>
                ＋ {t(locale, "am.maturityDate")}
              </button>
            )}
          </label>
        </>
      )}
      {(kind === "stock" || kind === "etf") && (
        <>
          <label className="frow">
            <span>{t(locale, "am.exchange")}</span>
            <Select value={exchange} onChange={setExchange}
              options={EXCHANGES.map((x) => ({ value: x.value, label: t(locale, x.label) }))} />
          </label>
          <label className="frow">
            <span>{t(locale, "am.ticker")}</span>
            <input value={f.ticker} placeholder={exchange === "KRX" ? "005930" : "AAPL"} maxLength={12}
              onChange={(e) => setF({ ...f, ticker: e.target.value.replace(/[^0-9A-Za-z.]/g, "") })} />
          </label>
          {numInput("qty", "am.qty", true)}
          {numInput("avgPrice", "am.avgPrice", false)}
        </>
      )}
      {kind === "crypto" && (
        <>
          <label className="frow">
            <span>{t(locale, "am.market")}</span>
            <input value={f.market} placeholder="KRW-BTC" maxLength={20}
              onChange={(e) => setF({ ...f, market: e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, "") })} />
          </label>
          {numInput("qty", "am.qty", true, "0.01")}
          {numInput("avgPrice", "am.avgPrice", true)}
        </>
      )}
      {kind === "fx" && (
        <>
          <label className="frow">
            <span>{t(locale, "am.currency")}</span>
            <input value={f.currency} placeholder="USD" maxLength={3}
              onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
          </label>
          {numInput("amount", "am.fxAmount", true)}
          {numInput("avgRate", "am.avgRate", true, "1350")}
        </>
      )}
      {kind === "gold" && (
        <>
          {numInput("grams", "am.grams", true, "10")}
          {numInput("avgPricePerGram", "am.avgPricePerGram", false)}
        </>
      )}
      {(kind === "loan" || kind === "receivable" || kind === "payable") && (
        <>
          {numInput("principal", "am.principal", false)}
          {numInput("interestRate", "am.interestRate", true, "5.00")}
          <label className="frow">
            <span>{t(locale, kind === "loan" ? "am.loanDate" : kind === "receivable" ? "am.lentDate" : "am.borrowedDate")}</span>
            <DatePicker locale={locale}
              value={kind === "loan" ? loanDate : kind === "receivable" ? lentDate : borrowedDate}
              onChange={kind === "loan" ? setLoanDate : kind === "receivable" ? setLentDate : setBorrowedDate} />
          </label>
        </>
      )}

      {confirming ? (
        <div className="confirmbox">
          <p>{t(locale, "am.deleteConfirm", { name })}</p>
          <div className="confirmrow">
            <button className="cbtn ghost" onClick={() => setConfirming(false)}>{t(locale, "common.cancel")}</button>
            <button className="cbtn danger" disabled={busy} onClick={() => void remove()}>{t(locale, "tx.delete")}</button>
          </div>
        </div>
      ) : (
        <div className="confirmrow" style={{ marginTop: 14 }}>
          {edit && <button className="cbtn danger ghostd" onClick={() => setConfirming(true)}>{t(locale, "tx.delete")}</button>}
          <button className="cbtn ghost" onClick={onClose}>{t(locale, "common.cancel")}</button>
          <button className="cbtn primary" disabled={busy || !name.trim()} onClick={() => void save()}>{t(locale, "tx.save")}</button>
        </div>
      )}
    </Modal>
  );
}

// ── 모달: 거래 입력/수정 ────────────────────────────────────────────────
function TxModal({ locale, state, edit, initialDate, onClose, onSaved, onDeleted, showToast }: {
  locale: Locale; state: LedgerState; edit?: Tx; initialDate?: string;
  onClose: () => void; onSaved: () => void; onDeleted: () => void; showToast: (m: string) => void;
}) {
  const [type, setType] = useState<TxType>(edit?.type ?? "expense");
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [categoryId, setCategoryId] = useState(edit?.categoryId ?? "");
  const [assetId, setAssetId] = useState(edit?.assetId ?? "");
  const [toAssetId, setToAssetId] = useState(edit?.toAssetId ?? "");
  const [date, setDate] = useState(edit?.date ?? initialDate ?? todayStr());
  const [memo, setMemo] = useState(edit?.memo ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nlText, setNlText] = useState("");
  const [aiBusy, setAiBusy] = useState<"" | "nl" | "cat">("");

  const cats = state.categories.filter((c) => c.kind === (type === "income" ? "income" : "expense"));
  useEffect(() => {
    if (type !== "transfer" && !cats.some((c) => c.id === categoryId)) setCategoryId(cats[0]?.id ?? "");
  }, [type]);

  // AI 자연어 한 줄 입력 → 파싱 결과를 폼에 채워 미리보기 (저장은 기존 버튼)
  const parseNl = async () => {
    if (!nlText.trim() || aiBusy) return;
    setAiBusy("nl");
    try {
      const { draft } = await api.aiParseOne(nlText);
      setType(draft.kind);
      setAmount(String(draft.amount));
      setCategoryId(draft.categoryId);
      setDate(draft.date);
      setMemo(draft.memo);
    } catch {
      showToast(t(locale, "ai.nl.fail"));
    } finally {
      setAiBusy("");
    }
  };
  // AI 카테고리 제안 (메모/금액 기반) — 실패해도 수동 선택 흐름 유지
  const suggestCategory = async () => {
    if (aiBusy) return;
    setAiBusy("cat");
    try {
      const { categoryId: cid } = await api.aiCategorize({
        memo: memo.trim(),
        amount: Math.round(Number(amount)) || undefined,
        kind: type === "income" ? "income" : "expense",
      });
      setCategoryId(cid);
    } catch {
      showToast(t(locale, "ai.categorize.fail"));
    } finally {
      setAiBusy("");
    }
  };

  const save = async () => {
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n <= 0) return showToast(t(locale, "toast.saveFail"));
    setBusy(true);
    const body = {
      type, amount: n, date, memo,
      categoryId: type === "transfer" ? null : categoryId || null,
      assetId: assetId || null,
      toAssetId: type === "transfer" ? toAssetId || null : null,
    };
    try {
      if (edit) await api.updateTx(edit.id, body);
      else await api.addTx(body);
      onSaved();
    } catch {
      showToast(t(locale, "toast.saveFail"));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await api.removeTx(edit.id);
      onDeleted();
    } catch {
      showToast(t(locale, "toast.saveFail"));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={t(locale, "list.add")}>
      {!edit && (
        <div className="frow">
          <span>✨ {t(locale, "ai.nl.parse")}</span>
          <div className="airow">
            <input value={nlText} placeholder={t(locale, "ai.nl.ph")} maxLength={200}
              onChange={(e) => setNlText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void parseNl(); } }} />
            <button type="button" className="pill" disabled={aiBusy !== "" || !nlText.trim()} onClick={() => void parseNl()}>
              {aiBusy === "nl" ? t(locale, "smart.parsing") : t(locale, "ai.nl.parse")}
            </button>
          </div>
        </div>
      )}
      <div className="typetoggle">
        {(["expense", "income", "transfer"] as TxType[]).map((tt) => (
          <button key={tt} className={type === tt ? "active" : ""} onClick={() => setType(tt)}>
            {t(locale, `tx.${tt}` as MsgKey)}
          </button>
        ))}
      </div>
      <label className="frow">
        <span>{t(locale, "tx.amount")}</span>
        <input autoFocus inputMode="numeric" value={amount} placeholder="0"
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
      </label>
      {type !== "transfer" && (
        <div className="frow">
          <span>{t(locale, "tx.category")}</span>
          <div className="airow">
            <div style={{ flex: 1 }}>
              <Select value={categoryId} onChange={setCategoryId}
                options={cats.map((c) => ({ value: c.id, label: `${c.emoji} ${catName(c, locale)}` }))} />
            </div>
            <button type="button" className="pill" disabled={aiBusy !== "" || (!memo.trim() && !amount)}
              onClick={() => void suggestCategory()}>
              {aiBusy === "cat" ? t(locale, "smart.parsing") : `✨ ${t(locale, "ai.categorize")}`}
            </button>
          </div>
        </div>
      )}
      <label className="frow">
        <span>{t(locale, "tx.asset")}</span>
        <Select value={assetId} onChange={setAssetId}
          options={[{ value: "", label: t(locale, "tx.none") },
            ...state.assets.map((a) => ({ value: a.id, label: a.name }))]} />
      </label>
      {type === "transfer" && (
        <label className="frow">
          <span>{t(locale, "tx.toAsset")}</span>
          <Select value={toAssetId} onChange={setToAssetId}
            options={[{ value: "", label: t(locale, "tx.none") },
              ...state.assets.filter((a) => a.id !== assetId).map((a) => ({ value: a.id, label: a.name })),
              ...state.holdings.filter((h) => h.kind === "savings" && h.id !== assetId).map((h) => ({ value: h.id, label: `💰 ${h.name}` }))]} />
        </label>
      )}
      <label className="frow">
        <span>{t(locale, "tx.date")}</span>
        <DatePicker locale={locale} value={date} onChange={setDate} />
      </label>
      <label className="frow">
        <span>{t(locale, "tx.memo")}</span>
        <input value={memo} placeholder={t(locale, "tx.memo.ph")} maxLength={200}
          onChange={(e) => setMemo(e.target.value)} />
      </label>
      {confirming ? (
        <div className="confirmbox">
          <p>{t(locale, "tx.deleteConfirm")}</p>
          <div className="confirmrow">
            <button className="cbtn ghost" onClick={() => setConfirming(false)}>{t(locale, "common.cancel")}</button>
            <button className="cbtn danger" disabled={busy} onClick={() => void remove()}>{t(locale, "tx.delete")}</button>
          </div>
        </div>
      ) : (
        <div className="confirmrow" style={{ marginTop: 14 }}>
          {edit && <button className="cbtn danger ghostd" onClick={() => setConfirming(true)}>{t(locale, "tx.delete")}</button>}
          <button className="cbtn ghost" onClick={onClose}>{t(locale, "common.cancel")}</button>
          <button className="cbtn primary" disabled={busy || !amount} onClick={() => void save()}>{t(locale, "tx.save")}</button>
        </div>
      )}
    </Modal>
  );
}

// ── 모달: 자산 ──────────────────────────────────────────────────────────
function AssetModal({ locale, edit, onClose, onSaved, onDeleted, showToast }: {
  locale: Locale; edit?: Asset; onClose: () => void; onSaved: () => void; onDeleted: () => void;
  showToast: (m: string) => void;
}) {
  const [name, setName] = useState(edit?.name ?? "");
  const [type, setType] = useState(edit?.type ?? "bank");
  const [initial, setInitial] = useState(edit ? String(edit.initialBalance) : "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const body = { name: name.trim(), type, initialBalance: Math.round(Number(initial)) || 0 };
    try {
      if (edit) await api.updateAsset(edit.id, body);
      else await api.addAsset(body);
      onSaved();
    } catch {
      showToast(t(locale, "toast.saveFail"));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await api.removeAsset(edit.id);
      onDeleted();
    } catch (e) {
      showToast(e instanceof Error && e.message === "asset in use" ? t(locale, "assets.inUse") : t(locale, "toast.saveFail"));
      setConfirming(false);
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={t(locale, "assets.add")}>
      <label className="frow">
        <span>{t(locale, "assets.name")}</span>
        <input autoFocus value={name} placeholder={t(locale, "assets.name.ph")} maxLength={60}
          onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="frow">
        <span>{t(locale, "assets.type")}</span>
        <Select value={type} onChange={(v) => setType(v as Asset["type"])}
          options={[
            { value: "cash", label: `💵 ${t(locale, "assets.type.cash")}` },
            { value: "bank", label: `🏦 ${t(locale, "assets.type.bank")}` },
            { value: "card", label: `💳 ${t(locale, "assets.type.card")}` },
          ]} />
      </label>
      <label className="frow">
        <span>{t(locale, "assets.initial")}</span>
        <input inputMode="numeric" value={initial} placeholder="0"
          onChange={(e) => setInitial(e.target.value.replace(/[^\d]/g, ""))} />
      </label>
      {confirming ? (
        <div className="confirmbox">
          <p>{t(locale, "assets.deleteConfirm", { name })}</p>
          <div className="confirmrow">
            <button className="cbtn ghost" onClick={() => setConfirming(false)}>{t(locale, "common.cancel")}</button>
            <button className="cbtn danger" disabled={busy} onClick={() => void remove()}>{t(locale, "assets.delete")}</button>
          </div>
        </div>
      ) : (
        <div className="confirmrow" style={{ marginTop: 14 }}>
          {edit && <button className="cbtn danger ghostd" onClick={() => setConfirming(true)}>{t(locale, "assets.delete")}</button>}
          <button className="cbtn ghost" onClick={onClose}>{t(locale, "common.cancel")}</button>
          <button className="cbtn primary" disabled={busy || !name.trim()} onClick={() => void save()}>{t(locale, "tx.save")}</button>
        </div>
      )}
    </Modal>
  );
}

// ── 모달: 구독 ──────────────────────────────────────────────────────────
function SubModal({ locale, state, edit, onClose, onSaved, showToast }: {
  locale: Locale; state: LedgerState; edit?: Subscription;
  onClose: () => void; onSaved: () => void; showToast: (m: string) => void;
}) {
  const [name, setName] = useState(edit?.name ?? "");
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [cycle, setCycle] = useState(edit?.cycle ?? "monthly");
  const [billingDay, setBillingDay] = useState(edit?.billingDay ?? 1);
  const [billingMonth, setBillingMonth] = useState(edit?.billingMonth ?? 1);
  const [assetId, setAssetId] = useState(edit?.assetId ?? "");
  const [categoryId, setCategoryId] = useState(edit?.categoryId ?? "subscription");
  const [busy, setBusy] = useState(false);
  const expenseCats = state.categories.filter((c) => c.kind === "expense");

  const save = async () => {
    const n = Math.round(Number(amount));
    if (!name.trim() || !Number.isFinite(n) || n <= 0) return showToast(t(locale, "toast.saveFail"));
    setBusy(true);
    const body = { name: name.trim(), amount: n, cycle, billingDay, billingMonth, assetId: assetId || null, categoryId };
    try {
      if (edit) await api.updateSub(edit.id, body);
      else await api.addSub(body);
      onSaved();
    } catch {
      showToast(t(locale, "toast.saveFail"));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={t(locale, "subs.add")}>
      <label className="frow">
        <span>{t(locale, "subs.name")}</span>
        <input autoFocus value={name} placeholder={t(locale, "subs.name.ph")} maxLength={60}
          onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="frow">
        <span>{t(locale, "tx.amount")}</span>
        <input inputMode="numeric" value={amount} placeholder="0"
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
      </label>
      <label className="frow">
        <span>{t(locale, "subs.cycle")}</span>
        <Select value={cycle} onChange={(v) => setCycle(v as Subscription["cycle"])}
          options={[
            { value: "monthly", label: t(locale, "subs.cycle.monthly") },
            { value: "yearly", label: t(locale, "subs.cycle.yearly") },
          ]} />
      </label>
      {cycle === "yearly" && (
        <label className="frow">
          <span>{t(locale, "subs.billingMonth")}</span>
          <Select value={String(billingMonth)} onChange={(v) => setBillingMonth(Number(v))}
            options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              { value: String(m), label: `${m}${t(locale, "subs.monthUnit")}` }
            ))} />
        </label>
      )}
      <label className="frow">
        <span>{t(locale, "subs.billingDay")}</span>
        <Select value={String(billingDay)} onChange={(v) => setBillingDay(Number(v))}
          options={Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            { value: String(d), label: `${d}${t(locale, "subs.dayUnit")}` }
          ))} />
      </label>
      <label className="frow">
        <span>{t(locale, "tx.category")}</span>
        <Select value={categoryId} onChange={setCategoryId}
          options={expenseCats.map((c) => ({ value: c.id, label: `${c.emoji} ${catName(c, locale)}` }))} />
      </label>
      <label className="frow">
        <span>{t(locale, "tx.asset")}</span>
        <Select value={assetId} onChange={setAssetId}
          options={[{ value: "", label: t(locale, "tx.none") },
            ...state.assets.map((a) => ({ value: a.id, label: a.name }))]} />
      </label>
      <p className="subnote">{t(locale, "subs.autoNote")}</p>
      <div className="confirmrow" style={{ marginTop: 10 }}>
        <button className="cbtn ghost" onClick={onClose}>{t(locale, "common.cancel")}</button>
        <button className="cbtn primary" disabled={busy || !name.trim() || !amount} onClick={() => void save()}>{t(locale, "tx.save")}</button>
      </div>
    </Modal>
  );
}

// ── 팝오버 위치 계산 (앵커 버튼 기준 fixed 좌표, 하단 공간 부족 시 위로) ──
function popoverPos(btn: HTMLElement | null, estHeight: number, fixedWidth?: number): React.CSSProperties {
  if (!btn) return { position: "fixed", visibility: "hidden" };
  const r = btn.getBoundingClientRect();
  const width = fixedWidth ? Math.min(fixedWidth, window.innerWidth - 16) : r.width;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  const below = window.innerHeight - r.bottom;
  const openUp = below < estHeight + 8 && r.top > below;
  return {
    position: "fixed",
    left,
    width,
    ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
  };
}

// ── 공용 커스텀 드롭다운 (마이크루 디자인 시스템 — 네이티브 select 대체) ──
function Select({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <div className="selwrap">
      <button type="button" ref={btnRef} className={`selbtn ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}>
        <span className="sellabel">{current?.label ?? "—"}</span>
        <span className="selchev">{open ? "▴" : "▾"}</span>
      </button>
      {open && createPortal(
        <>
          <div className="popdim" onClick={() => setOpen(false)} />
          <div className="selmenu" role="listbox" style={popoverPos(btnRef.current, 248)}>
            {options.map((o) => (
              <button type="button" key={o.value} role="option" aria-selected={o.value === value}
                className={`selitem ${o.value === value ? "active" : ""}`}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span>{o.label}</span>
                {o.value === value && <span className="selcheck">✓</span>}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── 공용 커스텀 데이트피커 (마이크루 디자인 시스템 — 네이티브 date input 대체) ──
function DatePicker({ locale, value, onChange }: {
  locale: Locale; value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ym, setYm] = useState(() => ymOf(value));
  useEffect(() => { setYm(ymOf(value)); }, [value]);
  const year = Number(ym.slice(0, 4));
  const monthIdx = Number(ym.slice(5, 7)) - 1;
  const firstDow = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const today = todayStr();
  const wdNames = locale === "ko" ? ["일", "월", "화", "수", "목", "금", "토"]
    : locale === "ja" ? ["日", "月", "火", "水", "木", "金", "土"]
    : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const label = (() => {
    const [y, m, d] = value.split("-").map(Number);
    const wd = wdNames[new Date(y, m - 1, d).getDay()];
    if (locale === "en") return `${monthLabel(ymOf(value), "en")} ${d} (${wd})`;
    return locale === "ja" ? `${y}年${m}月${d}日 (${wd})` : `${y}년 ${m}월 ${d}일 (${wd})`;
  })();
  return (
    <div className="selwrap">
      <button type="button" ref={btnRef} className={`selbtn ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <span className="sellabel">{label}</span>
        <span className="selchev">{open ? "▴" : "▾"}</span>
      </button>
      {open && createPortal(
        <>
          <div className="popdim" onClick={() => setOpen(false)} />
          <div className="dpop" style={popoverPos(btnRef.current, 336, 300)}>
            <div className="dphead">
              <b>{monthLabel(ym, locale)}</b>
              <div className="dpnav">
                <button type="button" aria-label={t(locale, "nav.prevYear")} onClick={() => setYm(shiftYm(ym, -12))}>«</button>
                <button type="button" aria-label={t(locale, "nav.prevMonth")} onClick={() => setYm(shiftYm(ym, -1))}>‹</button>
                <button type="button" aria-label={t(locale, "nav.nextMonth")} onClick={() => setYm(shiftYm(ym, 1))}>›</button>
                <button type="button" aria-label={t(locale, "nav.nextYear")} onClick={() => setYm(shiftYm(ym, 12))}>»</button>
              </div>
            </div>
            <div className="dpgrid">
              {wdNames.map((w) => <span key={w} className="dpwd">{w}</span>)}
              {Array.from({ length: firstDow }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                const ds = `${ym}-${String(d).padStart(2, "0")}`;
                return (
                  <button type="button" key={d}
                    className={`dpday ${ds === value ? "sel" : ""} ${ds === today ? "today" : ""}`}
                    onClick={() => { onChange(ds); setOpen(false); }}>
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="dpfoot">
              <button type="button" className="dptoday"
                onClick={() => { onChange(today); setOpen(false); }}>
                {t(locale, "cal.today")}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── 공용 모달 셸 ────────────────────────────────────────────────────────
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modaldim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h3>{title}</h3>
          <button className="modalclose" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { useI18n } from "./i18n";
import { useColorScheme } from "./theme";
import { Markdown } from "./markdown";
import { MoodIcon, MOOD_KEYS, normalizeMood } from "./MoodIcon";
import type { DailyRetro, DiaryEntry, DiarySettings, TemplateKey, WritingPrompt } from "./types";

const TEMPLATES: TemplateKey[] = ["basic", "quad", "kpt", "3l"];
const defaultQuadTitles = (t: T): string[] => [t("quad.q1"), t("quad.q2"), t("quad.q3"), t("quad.q4")];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// 로케일 코드 매핑 — 날짜·요일 포맷을 ko/en/ja에 맞춰 지역화한다.
function intlLocale(locale: string): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}
function fmtDate(date: string, locale: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(intlLocale(locale), {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
}
// 요일 헤더(일요일 시작) — 2023-01-01은 일요일이라 그 주로 로케일별 축약 요일명을 만든다.
function weekdayLabels(locale: string): string[] {
  const loc = intlLocale(locale);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + i).toLocaleDateString(loc, { weekday: "short" }));
}

type Tab = "diary" | "settings";
type Toast = { id: number; text: string; kind: "ok" | "err" };

export function App() {
  useColorScheme();
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("diary");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts, { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">📔 {t("app.title")}</h1>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "diary"} className={tab === "diary" ? "active" : ""} onClick={() => setTab("diary")}>{t("tab.diary")}</button>
          <button role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>{t("tab.settings")}</button>
        </nav>
      </header>
      <main className="scroll">
        {tab === "diary" && <DiaryTab t={t} locale={locale} toast={toast} />}
        {tab === "settings" && <SettingsTab t={t} toast={toast} />}
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`}>{x.text}</div>
        ))}
      </div>
    </div>
  );
}

type T = ReturnType<typeof useI18n>["t"];
type Msg = Parameters<T>[0];

// 무드 라벨 (MoodIcon slug → i18n)
const moodLabel = (t: T, m: string) => t(`mood.${m}` as Msg);

// 섹션 템플릿 정의 — quad는 설정 타이틀, kpt/3l은 고정 라벨
function sectionDefs(template: TemplateKey, quadTitles: string[], t: T): { key: string; label: string }[] {
  if (template === "quad") return quadTitles.map((title, i) => ({ key: `q${i + 1}`, label: title || `${i + 1}` }));
  if (template === "kpt") return ["keep", "problem", "try"].map((k) => ({ key: k, label: t(`sec.${k}` as Msg) }));
  if (template === "3l") return ["liked", "learned", "lacked"].map((k) => ({ key: k, label: t(`sec.${k}` as Msg) }));
  return [];
}

// ── ① 일기 탭 — 캘린더 + 리스트 + 에디터 ─────────────────────────────────
function DiaryTab({ t, locale, toast }: { t: T; locale: string; toast: (s: string, k?: "ok" | "err") => void }) {
  const today = todayStr();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // YYYY-MM
  const [content, setContent] = useState("");
  const [sections, setSections] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<TemplateKey>("basic");
  const [mood, setMood] = useState("");
  const [defaultTemplate, setDefaultTemplate] = useState<TemplateKey>("basic");
  const [quadTitles, setQuadTitles] = useState<string[]>(() => defaultQuadTitles(t));
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [prompt, setPrompt] = useState<WritingPrompt | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [retros, setRetros] = useState<DailyRetro[]>([]);

  const byDate = useMemo(() => new Map(entries.map((e) => [e.date, e])), [entries]);
  const selected = byDate.get(selectedDate) ?? null;
  const retroByDate = useMemo(() => new Map(retros.map((r) => [r.date, r])), [retros]);
  const dayRetro = retroByDate.get(selectedDate) ?? null;

  useEffect(() => {
    api.listEntries()
      .then((r) => setEntries(r.items))
      .catch(() => toast(t("toast.loadFail"), "err"));
    api.getPrompt(today).then((r) => setPrompt(r.item)).catch(() => { /* 글감은 선택 요소 */ });
    api.listRetros().then((r) => setRetros(r.items)).catch(() => { /* 회고는 자동 생성 결과 — 없으면 생략 */ });
    api.getSettings().then((r) => {
      if ((TEMPLATES as string[]).includes(r.item.template)) setDefaultTemplate(r.item.template);
      if (Array.isArray(r.item.quadTitles) && r.item.quadTitles.length === 4) setQuadTitles(r.item.quadTitles);
    }).catch(() => { /* 설정 로드 실패 시 기본값 유지 */ });
  }, []);

  // 날짜 전환 시 에디터 내용 동기화 — 기존 항목이면 형식/섹션 복원, 없으면 기본 형식
  useEffect(() => {
    const e = byDate.get(selectedDate);
    if (e) {
      const tpl = e.template ?? "basic";
      setTemplate(tpl);
      setSections(e.sections ? { ...e.sections } : {});
      setContent(tpl === "basic" ? e.content : "");
    } else {
      setTemplate(defaultTemplate);
      setSections({});
      setContent("");
    }
    setMood(e?.mood ?? "");
  }, [selectedDate, entries, defaultTemplate]);

  const defs = useMemo(() => sectionDefs(template, quadTitles, t), [template, quadTitles, t]);

  // 저장·표시용 합성 본문 — 섹션 템플릿은 "## 라벨\n본문", 빈 섹션은 생략
  const composed = useMemo(() => {
    if (template === "basic") return content;
    return defs
      .map((d) => ({ label: d.label, body: (sections[d.key] ?? "").trim() }))
      .filter((x) => x.body)
      .map((x) => `## ${x.label}\n${x.body}`)
      .join("\n\n");
  }, [template, content, sections, defs]);

  const dirty = selected
    ? composed !== selected.content || mood !== selected.mood || template !== (selected.template ?? "basic")
    : composed.trim().length > 0;

  const save = async () => {
    if (!composed.trim() || saving) return;
    setSaving(true);
    try {
      const secPayload = template === "basic"
        ? null
        : Object.fromEntries(defs.map((d) => [d.key, sections[d.key] ?? ""]));
      const r = selected
        ? await api.updateEntry(selected.id, { content: composed, mood, template, sections: secPayload })
        : await api.createEntry({ date: selectedDate, content: composed, mood, template, sections: secPayload });
      setEntries((es) => {
        const rest = es.filter((x) => x.id !== r.item.id && x.date !== r.item.date);
        return [r.item, ...rest].sort((a, b) => b.date.localeCompare(a.date));
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("toast.saveFail"), "err");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(t("editor.deleteConfirm", { date: selectedDate }))) return;
    try {
      await api.removeEntry(selected.id);
      setEntries((es) => es.filter((x) => x.id !== selected.id));
      toast(t("toast.removed"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("toast.saveFail"), "err");
    }
  };

  const reflect = async () => {
    if (!selected || reflecting) return;
    setReflecting(true);
    try {
      const r = await api.reflect(selected.id);
      setEntries((es) => es.map((x) => (x.id === r.item.id ? r.item : x)));
      toast(t("toast.reflectDone"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("toast.saveFail"), "err");
    } finally {
      setReflecting(false);
    }
  };

  const getPrompt = async () => {
    if (promptLoading) return;
    setPromptLoading(true);
    try {
      const r = await api.generatePrompt(today);
      setPrompt(r.item);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("toast.saveFail"), "err");
    } finally {
      setPromptLoading(false);
    }
  };

  // ── 캘린더 셀 계산 ──
  const [cy, cm] = cursor.split("-").map(Number);
  const firstDow = new Date(cy, cm - 1, 1).getDay();
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${cursor}-${String(i + 1).padStart(2, "0")}`),
  ];
  const moveMonth = (delta: number) => {
    const d = new Date(cy, cm - 1 + delta, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="diary-layout pagepad">
      <aside className="sidebar">
        <div className="calendar card">
          <div className="calhead">
            <span className="month">{cy}. {String(cm).padStart(2, "0")}</span>
            <span className="calnav">
              <button onClick={() => moveMonth(-1)} aria-label="prev month">‹</button>
              <button className="todaybtn" onClick={() => { setCursor(today.slice(0, 7)); setSelectedDate(today); }}>{t("cal.today")}</button>
              <button onClick={() => moveMonth(1)} aria-label="next month">›</button>
            </span>
          </div>
          <div className="calgrid">
            {weekdayLabels(locale).map((w, i) => <span key={i} className="calwd">{w}</span>)}
            {cells.map((d, i) =>
              d === null ? (
                <span key={`x${i}`} />
              ) : (
                <button
                  key={d}
                  className={`calday ${d === selectedDate ? "sel" : ""} ${d === today ? "today" : ""}`}
                  disabled={d > today}
                  onClick={() => setSelectedDate(d)}
                >
                  <span className="n">{Number(d.slice(8))}</span>
                  <span className="m">
                    {normalizeMood(byDate.get(d)?.mood)
                      ? <MoodIcon mood={byDate.get(d)?.mood} size={16} />
                      : (byDate.has(d) ? <i className="dot" /> : null)}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
        <div className="entrylist">
          <div className="listmeta">{t("list.count", { n: entries.length })}</div>
          {entries.length === 0 && <div className="empty small">{t("list.empty")}</div>}
          {entries.map((e) => (
            <button key={e.id} className={`entryitem ${e.date === selectedDate ? "sel" : ""}`} onClick={() => { setSelectedDate(e.date); setCursor(e.date.slice(0, 7)); }}>
              <span className="mood">
                {normalizeMood(e.mood) ? <MoodIcon mood={e.mood} size={26} /> : "📝"}
              </span>
              <span className="meta">
                <span className="date">{e.date}</span>
                <span className="excerpt">{e.content.replace(/^##\s+/gm, "").slice(0, 60)}</span>
              </span>
              {e.aiReflection && <span className="ai" title={t("reflect.title")}>✦</span>}
            </button>
          ))}
        </div>
      </aside>

      <section className="editorpane">
        <h2 className="datetitle">{fmtDate(selectedDate, locale)}</h2>

        {/* 데일리 회고 — 자동 생성 시간에 서버가 만든 그날의 회고를 표시 */}
        {dayRetro && (
          <div className="card retrocard">
            <div className="retrohead">
              <span className="cardlabel">🗓️ {t("retro.title")}</span>
              <span className="sourcebadge">
                {t("retro.sources", {
                  diary: dayRetro.sources.diary,
                  todos: dayRetro.sources.todos,
                  meetings: dayRetro.sources.meetings,
                  finance: dayRetro.sources.finance,
                  reading: dayRetro.sources.reading,
                })}
              </span>
            </div>
            <Markdown text={dayRetro.markdown} />
          </div>
        )}

        {/* 오늘의 글감 — 오늘 날짜 + 아직 일기가 없을 때 */}
        {selectedDate === today && !selected && (
          <div className="promptcard card">
            <div className="cardlabel">💡 {t("prompt.title")}</div>
            {prompt ? (
              <p className="prompttext">{prompt.prompt}</p>
            ) : (
              <button className="ghostbtn" onClick={getPrompt} disabled={promptLoading}>
                {promptLoading ? t("prompt.loading") : t("prompt.get")}
              </button>
            )}
          </div>
        )}

        {/* AI 회고 카드 — 일기 상단 */}
        {selected?.aiReflection && (
          <div className="reflectcard card">
            <div className="cardlabel">✦ {t("reflect.title")}</div>
            <div className="emotions">
              {selected.aiReflection.emotions.map((em) => (
                <span key={em.label} className="emotion">
                  {em.label}
                  <span className="bars" aria-label={`${em.intensity}/5`}>
                    {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= em.intensity ? "on" : ""} />)}
                  </span>
                </span>
              ))}
            </div>
            <p className="comment">{selected.aiReflection.comment}</p>
            {selected.aiReflection.questions.length > 0 && (
              <div className="questions">
                <div className="qlabel">{t("reflect.questions")}</div>
                <ul>
                  {selected.aiReflection.questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}
            <button className="ghostbtn small" onClick={reflect} disabled={reflecting}>
              {reflecting ? t("reflect.loading") : t("reflect.refresh")}
            </button>
          </div>
        )}
        {selected && !selected.aiReflection && (
          <button className="ghostbtn reflectbtn" onClick={reflect} disabled={reflecting}>
            {reflecting ? t("reflect.loading") : `✦ ${t("reflect.button")}`}
          </button>
        )}

        <div className="moodrow">
          <span className="moodlabel">{t("editor.mood")}</span>
          {MOOD_KEYS.map((m) => (
            <button
              key={m}
              className={`moodbtn ${mood === m ? "sel" : ""}`}
              data-tip={moodLabel(t, m)}
              aria-label={moodLabel(t, m)}
              aria-pressed={mood === m}
              onClick={() => setMood(mood === m ? "" : m)}
            >
              <MoodIcon mood={m} size={30} />
            </button>
          ))}
        </div>

        {template === "basic" ? (
          <textarea
            className="editor"
            value={content}
            placeholder={t("editor.placeholder")}
            onChange={(e) => setContent(e.target.value)}
          />
        ) : (
          <div className={`sections ${template === "quad" ? "quad" : ""}`}>
            {defs.map((d) => (
              <div key={d.key} className="section">
                <label className="seclabel">{d.label}</label>
                <textarea
                  className="editor sec"
                  value={sections[d.key] ?? ""}
                  placeholder={t("editor.sectionPlaceholder")}
                  onChange={(e) => setSections((s) => ({ ...s, [d.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        <div className="editorbar">
          <span className="chars">{t("editor.chars", { n: composed.length })}</span>
          <span className="btns">
            {selected && (
              <button className="dangerbtn" onClick={remove}>{t("editor.delete")}</button>
            )}
            <button className="primarybtn" onClick={save} disabled={!dirty || !composed.trim() || saving}>
              {saving ? t("editor.saving") : savedFlash && !dirty ? t("editor.saved") : t("editor.save")}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}

// ── ② 설정 탭 ─────────────────────────────────────────────────────────────
function SettingsTab({ t, toast }: { t: T; toast: (s: string, k?: "ok" | "err") => void }) {
  const [settings, setSettings] = useState<DiarySettings | null>(null);

  useEffect(() => {
    api.getSettings().then((r) => setSettings(r.item)).catch(() => toast(t("toast.loadFail"), "err"));
  }, []);

  const patch = async (p: Partial<DiarySettings>) => {
    if (!settings) return;
    const prev = settings;
    setSettings({ ...settings, ...p });
    try {
      const r = await api.saveSettings(p);
      setSettings(r.item);
      toast(t("settings.saved"));
    } catch (e) {
      setSettings(prev);
      toast(e instanceof Error ? e.message : t("toast.saveFail"), "err");
    }
  };

  if (!settings) return <div className="pagepad empty">…</div>;

  // 구버전/외부 서버가 신규 필드 없이 응답해도 죽지 않도록 방어적 폴백
  const quadTitles = Array.isArray(settings.quadTitles) && settings.quadTitles.length === 4
    ? settings.quadTitles : defaultQuadTitles(t);
  const templateValue = (TEMPLATES as string[]).includes(settings.template) ? settings.template : "basic";

  const setQuad = (i: number, v: string) => {
    const next = quadTitles.slice();
    next[i] = v;
    setSettings({ ...settings, quadTitles: next });
  };

  return (
    <div className="settings pagepad">
      <h2 className="sectiontitle">{t("settings.title")}</h2>

      <div className="card setrow">
        <div className="setmeta">
          <div className="setname">{t("settings.autoGenerate")}</div>
          <div className="setdesc">{t("settings.autoGenerate.desc")}</div>
        </div>
        <button
          className={`switch ${settings.autoGenerate ? "on" : ""}`}
          role="switch"
          aria-checked={settings.autoGenerate}
          onClick={() => patch({ autoGenerate: !settings.autoGenerate })}
        >
          <i />
        </button>
      </div>

      <div className="card setrow">
        <div className="setmeta">
          <div className="setname">{t("settings.dailyTime")}</div>
          <div className="setdesc">{t("settings.dailyTime.desc")}</div>
        </div>
        <TimePicker
          value={settings.dailyTime}
          onChange={(v) => patch({ dailyTime: v })}
          t={t}
        />
      </div>

      <div className="card setrow">
        <div className="setmeta">
          <div className="setname">{t("settings.template")}</div>
          <div className="setdesc">{t("settings.template.desc")}</div>
        </div>
        <Select
          value={templateValue}
          options={TEMPLATES.map((k) => ({ value: k, label: t(`tpl.${k}` as Msg) }))}
          onChange={(v) => patch({ template: v as TemplateKey })}
        />
      </div>

      <div className="card">
        <div className="setmeta">
          <div className="setname">{t("settings.quadTitles")}</div>
          <div className="setdesc">{t("settings.quadTitles.desc")}</div>
        </div>
        <div className="quadgrid">
          {quadTitles.map((title, i) => (
            <input
              key={i}
              type="text"
              className="quadinput"
              value={title}
              maxLength={30}
              onChange={(e) => setQuad(i, e.target.value)}
              onBlur={() => patch({ quadTitles })}
            />
          ))}
        </div>
      </div>

      <div className="card privacy">
        <div className="setname">🔒 {t("settings.privacy")}</div>
        <div className="setdesc">{t("settings.privacy.desc")}</div>
      </div>
    </div>
  );
}

// ── 팝오버 좌표 (body 포털 + fixed — ledger와 동일 패턴) ──
function popoverPos(btn: HTMLElement | null, estHeight: number, fixedWidth?: number): CSSProperties {
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

// ── 시간 선택기 (마이크루 디자인 시스템 — 네이티브 input[type=time] 대체) ──
// value/onChange는 24시간 "HH:MM". UI는 오전/오후·시(1~12)·분(00~59) 3열 휠.
function TimePicker({ value, onChange, t }: {
  value: string;
  onChange: (v: string) => void;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 열릴 때 각 열의 선택 항목을 가운데로 스크롤(분 00~59 등 하단 값 가시성 확보).
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelectorAll<HTMLElement>(".tpitem.active")
      .forEach((el) => el.scrollIntoView({ block: "center" }));
  }, [open]);

  const [h24, min] = useMemo(() => {
    const [hh, mm] = (value || "09:00").split(":").map((n) => parseInt(n, 10));
    return [Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0];
  }, [value]);
  const isPm = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const compose = (pm: boolean, hour12: number, minute: number) => {
    const base = hour12 % 12;                      // 12 → 0
    const hh = pm ? base + 12 : base;              // PM 오프셋
    onChange(`${String(hh).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  };

  const label = `${t(isPm ? "time.pm" : "time.am")} ${String(h12).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);   // 1~12
  const minutes = Array.from({ length: 60 }, (_, i) => i);      // 0~59

  return (
    <div className="selwrap tpwrap">
      <button type="button" ref={btnRef} className={`selbtn ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}>
        <span className="sellabel">{label}</span>
        <span className="tpclock" aria-hidden>🕘</span>
      </button>
      {open && createPortal(
        <>
          <div className="popdim" onClick={() => setOpen(false)} />
          <div className="tpmenu" role="dialog" ref={menuRef} style={popoverPos(btnRef.current, 260, 240)}>
            <div className="tpcol" role="listbox" aria-label={t("time.am")}>
              {[false, true].map((pm) => (
                <button type="button" key={pm ? "pm" : "am"} role="option" aria-selected={pm === isPm}
                  className={`tpitem ${pm === isPm ? "active" : ""}`}
                  onClick={() => compose(pm, h12, min)}>
                  {t(pm ? "time.pm" : "time.am")}
                </button>
              ))}
            </div>
            <div className="tpcol" role="listbox" aria-label={t("time.hour")}>
              {hours.map((h) => (
                <button type="button" key={h} role="option" aria-selected={h === h12}
                  className={`tpitem ${h === h12 ? "active" : ""}`}
                  onClick={() => compose(isPm, h, min)}>
                  {String(h).padStart(2, "0")}
                </button>
              ))}
            </div>
            <div className="tpcol" role="listbox" aria-label={t("time.minute")}>
              {minutes.map((m) => (
                <button type="button" key={m} role="option" aria-selected={m === min}
                  className={`tpitem ${m === min ? "active" : ""}`}
                  onClick={() => compose(isPm, h12, m)}>
                  {String(m).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

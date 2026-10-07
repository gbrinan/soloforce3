import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useI18n, type MessageKey } from "./i18n";
import { useColorScheme } from "./theme";
import type { CoverScan, ReadStatus, Recommendation, SearchResult, ShelfBook } from "./types";

type View = { name: "list" } | { name: "search" } | { name: "scan"; draft?: CoverScan } | { name: "detail"; id: string };

const TABS = ["all", "reading", "done", "todo", "liked"] as const;
type Tab = (typeof TABS)[number];
const SORTS = ["recent", "title", "rating"] as const;
type Sort = (typeof SORTS)[number];
const STATUSES: ReadStatus[] = ["todo", "reading", "done"];

const TAB_FILTER: Record<Tab, (b: ShelfBook) => boolean> = {
  all: () => true,
  reading: (b) => b.status === "reading",
  done: (b) => b.status === "done",
  todo: (b) => b.status === "todo",
  liked: (b) => b.liked,
};

function Stars({ rating, size = 11 }: { rating: number; size?: number }) {
  return (
    <span className="stars" style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className={s <= rating ? "" : "off"}>★</span>
      ))}
    </span>
  );
}

// 정렬 레이어 팝업 — 버튼 바로 아래 앵커 (바텀시트 대체)
function SortMenu({
  options,
  active,
  onSelect,
  onClose,
}: {
  options: { value: string; label: string }[];
  active: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="popdim" onClick={onClose} />
      <div className="sortmenu">
        {options.map((o) => (
          <button key={o.value} className={`mitem ${o.value === active ? "active" : ""}`} onClick={() => { onSelect(o.value); onClose(); }}>
            <span>{o.label}</span>
            {o.value === active && <span>✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}

export function App() {
  useColorScheme(); // data-theme 어트리뷰트 동기화 (마이크루 jarvis-color-scheme 추종)
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>({ name: "list" });
  const [shelf, setShelf] = useState<ShelfBook[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2000);
  }, []);

  const reload = useCallback(() => {
    api.list().then((r) => setShelf(r.items)).catch(() => showToast(t("toast.loadFail")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast, locale]);
  useEffect(reload, [reload]);

  const patch = useCallback(
    async (id: string, p: Parameters<typeof api.update>[1]) => {
      try {
        const { item } = await api.update(id, p);
        setShelf((prev) => prev.map((b) => (b.id === id ? item : b)));
      } catch {
        showToast(t("toast.saveFail"));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, locale],
  );

  return (
    <div className="app">
      {view.name === "list" && (
        <ListView
          shelf={shelf}
          onOpenSearch={() => setView({ name: "search" })}
          onOpenScan={() => setView({ name: "scan" })}
          onOpenDetail={(id) => setView({ name: "detail", id })}
          onToggleLike={(b) => void patch(b.id, { liked: !b.liked })}
          onAddRecommend={(r) =>
            setView({ name: "scan", draft: { title: r.title, author: r.author, publisher: "", isbn: "" } })
          }
        />
      )}
      {view.name === "search" && (
        <SearchView
          shelf={shelf}
          onBack={() => setView({ name: "list" })}
          onAdded={(item, dup) => {
            if (dup) showToast(t("toast.duplicated"));
            else {
              setShelf((prev) => [item, ...prev]);
              showToast(t("toast.added", { title: item.title }));
            }
          }}
        />
      )}
      {view.name === "scan" && (
        <ScanView
          initialDraft={view.draft}
          onBack={() => setView({ name: "list" })}
          onAdded={(item, dup) => {
            if (dup) showToast(t("toast.duplicated"));
            else {
              setShelf((prev) => [item, ...prev]);
              showToast(t("toast.added", { title: item.title }));
            }
            setView({ name: "list" });
          }}
        />
      )}
      {view.name === "detail" && (
        <DetailView
          book={shelf.find((b) => b.id === view.id) ?? null}
          onBack={() => setView({ name: "list" })}
          onPatch={patch}
          onDelete={async (id) => {
            try {
              await api.remove(id);
              setShelf((prev) => prev.filter((b) => b.id !== id));
              setView({ name: "list" });
              showToast(t("toast.removed"));
            } catch {
              showToast(t("toast.removeFail"));
            }
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ─── 리스트 (벤치마크: 칩 탭 + 정렬 바텀시트 + 가변 커버 그리드) ─── */
function ListView({
  shelf,
  onOpenSearch,
  onOpenScan,
  onOpenDetail,
  onToggleLike,
  onAddRecommend,
}: {
  shelf: ShelfBook[];
  onOpenSearch: () => void;
  onOpenScan: () => void;
  onOpenDetail: (id: string) => void;
  onToggleLike: (b: ShelfBook) => void;
  onAddRecommend: (r: Recommendation) => void;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  // 뷰 모드 (카드/캘린더) — 마지막 선택 기억
  const [mode, setMode] = useState<"grid" | "calendar">(() => {
    try { return localStorage.getItem("bookshelf-view") === "calendar" ? "calendar" : "grid"; } catch { return "grid"; }
  });
  const switchMode = (m: "grid" | "calendar") => {
    setMode(m);
    try { localStorage.setItem("bookshelf-view", m); } catch { /* */ }
  };

  const items = useMemo(() => {
    const filtered = shelf.filter(TAB_FILTER[tab]);
    const sorted = [...filtered];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    else if (sort === "rating") sorted.sort((a, b) => b.rating - a.rating);
    else sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return sorted;
  }, [shelf, tab, sort]);

  return (
    <div className="scroll">
      <div className="filterbar">
        {TABS.map((tb) => (
          <button key={tb} className={`chip ${tab === tb ? "active" : ""}`} onClick={() => setTab(tb)}>
            {t(`tab.${tb}` as MessageKey)}
          </button>
        ))}
        <div className="addbtns">
          <button className="searchbtn" onClick={onOpenSearch}>🔍 {t("list.search")}</button>
          <button className="searchbtn" onClick={onOpenScan}>📷 {t("scan.button")}</button>
        </div>
      </div>

      <div className="titlerow">
        <h3>
          {tab === "all" ? t("list.title") : t(`tab.${tab}` as MessageKey)}
          <span className="count">{items.length}</span>
        </h3>
        <div className="titletools">
          <div className="viewtoggle">
            <button className={mode === "grid" ? "active" : ""} onClick={() => switchMode("grid")}>⊞ {t("view.grid")}</button>
            <button className={mode === "calendar" ? "active" : ""} onClick={() => switchMode("calendar")}>📅 {t("view.calendar")}</button>
          </div>
          {mode === "grid" && (
            <div className="sortwrap">
              <button className="sortbtn" onClick={() => setSortOpen((v) => !v)}>{t(`sort.${sort}` as MessageKey)} ▾</button>
              {sortOpen && (
                <SortMenu
                  options={SORTS.map((s) => ({ value: s, label: t(`sort.${s}` as MessageKey) }))}
                  active={sort}
                  onSelect={(v) => setSort(v as Sort)}
                  onClose={() => setSortOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {mode === "calendar" ? (
        <CalendarView items={items} locale={locale} onOpenDetail={onOpenDetail} />
      ) : items.length === 0 ? (
        <div className="empty">
          {shelf.length === 0 ? (
            <>
              {t("list.empty.none")}
              <br />
              <button className="cta" onClick={onOpenSearch}>{t("list.empty.cta")}</button>
            </>
          ) : (
            t("list.empty.filter")
          )}
        </div>
      ) : (
        <div className="grid">
          {items.map((b) => (
            <div key={b.id} className="card" onClick={() => onOpenDetail(b.id)}>
              <div className="cover">
                {b.thumbnail ? (
                  <img
                    src={b.thumbnail}
                    alt={b.title}
                    loading="lazy"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', b.thumbnail!);
                      window.parent.postMessage({ source: 'mycrew-bookshelf', type: 'drag.start', payload: { url: b.thumbnail, name: b.title } }, '*');
                    }}
                    onDragEnd={() => window.parent.postMessage({ source: 'mycrew-bookshelf', type: 'drag.end', payload: {} }, '*')}
                  />
                ) : <span className="noimg">📖</span>}
                <span className={`badge ${b.status}`}>{t(`status.${b.status}` as MessageKey)}</span>
              </div>
              <div className="btitle">{b.title}</div>
              <div className="bauthor">{b.authors.join(", ") || b.publisher || " "}</div>
              <div className="cardmeta">
                <Stars rating={b.rating} />
                <button
                  className={`heart ${b.liked ? "on" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onToggleLike(b); }}
                  aria-label={t("detail.like")}
                >
                  {b.liked ? "♥" : "♡"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <RecommendSection hasBooks={shelf.length > 0} onAdd={onAddRecommend} />
    </div>
  );
}

/* ─── AI 다음 책 추천 — 버튼 클릭 시 로드, 결과는 도서 카드와 동일한 카드 UI ─── */
function RecommendSection({ hasBooks, onAdd }: { hasBooks: boolean; onAdd: (r: Recommendation) => void }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    api.recommend(locale)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  return (
    <div className="recsec">
      <div className="rechead">
        <h4>✨ {t("rec.title")}</h4>
        {hasBooks && !loading && (
          <button className="recbtn" onClick={load}>{items ? t("rec.refresh") : t("rec.button")}</button>
        )}
      </div>
      {!hasBooks && <div className="recnote">{t("rec.empty")}</div>}
      {loading && <div className="recnote">{t("rec.loading")}</div>}
      {!loading && error && <div className="recnote">{t("rec.fail")} — {error}</div>}
      {!loading && !error && items && (
        // 가로 카드 리스트 — 좌측 축소 썸네일 + 우측 제목/저자/추천이유. 클릭 시 등록 폼 프리필.
        <div className="reclist">
          {items.map((r, i) => (
            <div key={`${r.title}-${i}`} className="reccard" title={t("scan.save")} onClick={() => onAdd(r)}>
              <div className="recthumb">
                {r.thumbnail ? <img src={r.thumbnail} alt={r.title} loading="lazy" /> : <span className="noimg">📖</span>}
              </div>
              <div className="recbody">
                <div className="btitle">{r.title}</div>
                <div className="bauthor">{r.author || t("search.unknownAuthor")}</div>
                <div className="recreason">{r.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── 캘린더 뷰 — 추가·상태 변경 이벤트 기준 월별 표시 (탭 필터 공유) ─── */
type CalKind = "added" | ReadStatus;
interface CalEvent { book: ShelfBook; kind: CalKind }

function CalendarView({
  items,
  locale,
  onOpenDetail,
}: {
  items: ShelfBook[];
  locale: string;
  onOpenDetail: (id: string) => void;
}) {
  const { t } = useI18n();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const localKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // 이벤트(추가·상태 변경) → 로컬 날짜 키로 그룹핑. 같은 책이 여러 날짜에 나타날 수 있음
  // (예: 1일 추가, 20일 완독). 같은 책·같은 날 복수 이벤트는 마지막 것만 표시.
  // events 없는 구버전 데이터는 addedAt으로 폴백. UTC slice 대신 로컬 변환 (전날 밀림 방지).
  const byDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const b of items) {
      const evs = b.events?.length ? b.events : [{ type: "added" as const, at: b.addedAt }];
      const perDay = new Map<string, CalKind>();
      for (const ev of evs) {
        const key = localKey(new Date(ev.at));
        perDay.set(key, ev.type === "added" ? "added" : (ev.status ?? b.status));
      }
      for (const [key, kind] of perDay) {
        const arr = map.get(key) ?? [];
        arr.push({ book: b, kind });
        map.set(key, arr);
      }
    }
    return map;
  }, [items]);

  // 일요일 시작 6주(42칸) 그리드
  const cells = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - month.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    // 2023-01-01 = 일요일 기준 7일
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  }, [locale]);

  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(month);
  const todayKey = localKey(new Date());
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const monthHasBooks = [...byDate.keys()].some((k) => k.startsWith(monthPrefix));
  // 하루 2권 이상은 드물어 커버 2개를 크게 표시, 초과분은 셀 우측 상단 +n 라벨
  const MAX_COVERS = 2;
  const kindLabel = (k: CalKind) => (k === "added" ? t("cal.added") : t(`status.${k}` as MessageKey));
  const LEGEND: CalKind[] = ["added", "todo", "reading", "done"];

  return (
    <div className="calendar">
      <div className="calhead">
        <span className="month">{monthLabel}</span>
        <div className="calnav">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="prev">‹</button>
          <button className="todaybtn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>
            {t("cal.today")}
          </button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="next">›</button>
        </div>
      </div>

      <div className="callegend">
        {LEGEND.map((k) => (
          <span key={k} className="lg">
            <i className={`dot ${k}`} />{kindLabel(k)}
          </span>
        ))}
      </div>

      <div className="calgrid">
        {weekdays.map((w) => (
          <div key={w} className="calwd">{w}</div>
        ))}
        {cells.map((d) => {
          const key = localKey(d);
          const events = byDate.get(key) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div key={key} className={`calcell ${inMonth ? "" : "dim"}`}>
              <span className={`day ${key === todayKey ? "today" : ""}`}>{d.getDate()}</span>
              {events.length > MAX_COVERS && <span className="calmore">+{events.length - MAX_COVERS}</span>}
              {events.length > 0 && (
                <div className="calbooks">
                  {events.slice(0, MAX_COVERS).map((ev) => (
                    <span
                      key={`${ev.book.id}-${ev.kind}`}
                      className="calbook"
                      title={`${ev.book.title} — ${kindLabel(ev.kind)}`}
                      onClick={() => onOpenDetail(ev.book.id)}
                    >
                      {ev.book.thumbnail
                        ? <img
                            src={ev.book.thumbnail}
                            alt={ev.book.title}
                            loading="lazy"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', ev.book.thumbnail!);
                              window.parent.postMessage({ source: 'mycrew-bookshelf', type: 'drag.start', payload: { url: ev.book.thumbnail, name: ev.book.title } }, '*');
                            }}
                            onDragEnd={() => window.parent.postMessage({ source: 'mycrew-bookshelf', type: 'drag.end', payload: {} }, '*')}
                          />
                        : <span className="noimg">📖</span>}
                      <i className={`dot ${ev.kind}`} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!monthHasBooks && <div className="hint">{t("cal.empty")}</div>}
    </div>
  );
}

/* ─── 검색 (네이버/카카오/Google/OpenLibrary 체인 → 추가) ─── */
function SearchView({
  shelf,
  onBack,
  onAdded,
}: {
  shelf: ShelfBook[];
  onBack: () => void;
  onAdded: (item: ShelfBook, duplicated: boolean) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const inShelf = useMemo(() => {
    const keys = new Set<string>();
    for (const b of shelf) {
      if (b.sourceId) keys.add(b.sourceId);
      if (b.isbn) keys.add(b.isbn);
    }
    return keys;
  }, [shelf]);

  const runSearch = useCallback((query: string) => {
    if (!query.trim()) { setResults(null); return; }
    setLoading(true);
    api.search(query.trim())
      .then((r) => setResults(r.items))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const onChange = (v: string) => {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(v), 400);
  };

  return (
    <div className="scroll">
      <div className="searchhead">
        <div className="searchwrap">
          <span className="icon">🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch(q)}
            placeholder={t("search.placeholder")}
          />
        </div>
        <button className="cancel" onClick={onBack}>{t("search.cancel")}</button>
      </div>

      <div className="results">
        {loading && <div className="hint">{t("search.loading")}</div>}
        {!loading && results === null && <div className="hint">{t("search.hint")}</div>}
        {!loading && results !== null && results.length === 0 && <div className="hint">{t("search.noresult")}</div>}
        {!loading &&
          results?.map((r) => {
            const added = (r.sourceId && inShelf.has(r.sourceId)) || (r.isbn ? inShelf.has(r.isbn) : false);
            return (
              <div key={r.sourceId} className="result">
                <div className="rcover">{r.thumbnail ? <img src={r.thumbnail} alt={r.title} loading="lazy" /> : "📖"}</div>
                <div className="rinfo">
                  <div className="rtitle">{r.title}</div>
                  <div className="rmeta">{r.authors.join(", ") || t("search.unknownAuthor")}</div>
                  <div className="rmeta">{[r.publisher, r.publishedDate].filter(Boolean).join(" · ")}</div>
                </div>
                <button
                  className="addbtn"
                  disabled={added || adding === r.sourceId}
                  onClick={async () => {
                    setAdding(r.sourceId);
                    try {
                      const res = await api.add(r);
                      onAdded(res.item, Boolean(res.duplicated));
                    } finally {
                      setAdding(null);
                    }
                  }}
                >
                  {added ? t("search.added") : adding === r.sourceId ? t("search.adding") : t("search.add")}
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ─── 표지 촬영/업로드로 등록 — 비전 추출 결과를 폼에 프리필 후 확인 저장 ─── */
// 촬영 원본은 수 MB가 흔해 최대 1280px JPEG로 축소 후 전송 (서버 base64 한도 대비)
async function fileToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = raw; });
  const MAX = 1280;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 1_500_000) return raw;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// EAN-13 바코드 값이 ISBN(978/979 프리픽스)인지 판별
function isIsbnBarcode(v: string): boolean {
  return /^97[89]\d{10}$/.test(v);
}

// getUserMedia 라이브 프리뷰 모달 — BarcodeDetector 지원 시 ISBN 실시간 감지 + 촬영 버튼
function CameraModal({
  onBarcode,
  onCapture,
  onError,
  onClose,
}: {
  onBarcode: (isbn: string) => void;
  onCapture: (dataUrl: string) => void;
  onError: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false); // 바코드/촬영 중복 발화 방지
  const [barcodeReady, setBarcodeReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => { /* autoplay 정책 — playsInline+muted로 대부분 통과 */ });
        }
        // (a) ISBN 바코드 경로 — 지원 브라우저(Chrome/Android 등)만. Safari 등은 촬영 경로만 동작.
        const Detector = window.BarcodeDetector;
        if (Detector) {
          const detector = new Detector({ formats: ["ean_13"] });
          setBarcodeReady(true);
          timer = setInterval(async () => {
            const v = videoRef.current;
            if (!v || v.readyState < 2 || doneRef.current) return;
            try {
              const codes = await detector.detect(v);
              const isbn = codes.map((c) => c.rawValue).find(isIsbnBarcode);
              if (isbn && !doneRef.current) { doneRef.current = true; onBarcode(isbn); }
            } catch { /* 프레임 미준비 등 — 다음 틱 재시도 */ }
          }, 400);
        }
      } catch {
        // 권한 거부·카메라 없음·비보안 컨텍스트 → 파일 선택 폴백
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (b) 표지 비전 경로 — 프레임 캡처 후 기존 1280px 다운스케일 규칙 재사용
  const capture = () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0 || doneRef.current) return;
    doneRef.current = true;
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.85));
  };

  return (
    <div className="cammodal">
      <video ref={videoRef} playsInline muted />
      {barcodeReady && <div className="camhint">{t("scan.cameraHint")}</div>}
      <div className="camrow">
        <button className="cbtn ghost" onClick={onClose}>{t("search.cancel")}</button>
        <button className="camshot" onClick={capture}>{t("scan.capture")}</button>
      </div>
    </div>
  );
}

function ScanView({
  onBack,
  onAdded,
  initialDraft,
}: {
  onBack: () => void;
  onAdded: (item: ShelfBook, duplicated: boolean) => void;
  initialDraft?: CoverScan;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<CoverScan | null>(initialDraft ?? null);
  const [camOpen, setCamOpen] = useState(false);
  const [camBlocked, setCamBlocked] = useState(false);
  // getUserMedia 가능 여부 — 비보안 컨텍스트/미지원/직전 실패 시 파일 선택 폴백
  const canUseCamera = !camBlocked && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;

  const scan = async (dataUrl: string) => {
    setError("");
    setDraft(null);
    setScanning(true);
    try {
      setPreview(dataUrl);
      const { item } = await api.scanCover(dataUrl);
      // 비전 결과에 ISBN이 있으면 그 ISBN으로도 조회해 빈 필드 보강
      if (item.isbn) {
        try {
          const { item: found } = await api.lookupIsbn(item.isbn);
          item.title = item.title || found.title;
          item.author = item.author || found.author;
          item.publisher = item.publisher || found.publisher;
        } catch { /* 보강 실패는 무시 — 비전 결과만 사용 */ }
      }
      setDraft(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const onFile = async (file: File) => {
    setError("");
    try {
      await scan(await fileToDataUrl(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 바코드로 ISBN 인식 → 촬영 없이 즉시 책 정보 검색
  const onBarcode = async (isbn: string) => {
    setCamOpen(false);
    setError("");
    setPreview("");
    setDraft(null);
    setLookup(true);
    try {
      const { item } = await api.lookupIsbn(isbn);
      setDraft(item);
    } catch {
      setDraft({ title: "", author: "", publisher: "", isbn });
      setError(t("scan.lookupFail"));
    } finally {
      setLookup(false);
    }
  };

  const onCamError = () => {
    setCamOpen(false);
    setCamBlocked(true);
    setError(t("scan.cameraFail"));
    fileRef.current?.click(); // 사용자 활성화가 남아 있으면 즉시 파일 선택으로 전환
  };

  const openCapture = () => {
    setError("");
    if (canUseCamera) setCamOpen(true);
    else fileRef.current?.click();
  };

  // "표지로 등록" 진입 즉시 카메라를 연다(중간 안내 화면 스킵). 바코드 등으로 draft가 이미 있으면 제외.
  // 카메라 차단/미지원 시 openCapture가 파일 선택으로 폴백한다.
  useEffect(() => {
    if (!initialDraft) openCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    setSaving(true);
    try {
      const res = await api.add({
        sourceId: draft.isbn.trim() || `scan-${Date.now()}`,
        title: draft.title.trim(),
        authors: draft.author.split(",").map((a) => a.trim()).filter(Boolean),
        publisher: draft.publisher.trim(),
        publishedDate: "",
        description: "",
        categories: [],
        isbn: draft.isbn.trim() || null,
        thumbnail: "",
        pageCount: null,
      });
      onAdded(res.item, Boolean(res.duplicated));
    } catch {
      setError(t("toast.saveFail"));
      setSaving(false);
    }
  };

  const set = (k: keyof CoverScan, v: string) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="scroll">
      <div className="searchhead">
        <h3 className="scantitle">📷 {t("scan.title")}</h3>
        <button className="cancel" onClick={onBack}>{t("search.cancel")}</button>
      </div>

      <div className="scanbody">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
        {camOpen && (
          <CameraModal
            onBarcode={(isbn) => void onBarcode(isbn)}
            onCapture={(dataUrl) => { setCamOpen(false); void scan(dataUrl); }}
            onError={onCamError}
            onClose={() => setCamOpen(false)}
          />
        )}
        {preview && <img className="scanpreview" src={preview} alt="cover preview" />}
        {!scanning && !lookup && (
          <button className="memosave" onClick={openCapture}>
            {canUseCamera ? t("scan.camera") : preview ? t("scan.retry") : t("scan.pick")}
          </button>
        )}
        {!preview && !scanning && !lookup && !draft && <div className="hint">{t("scan.hint")}</div>}
        {scanning && <div className="hint">{t("scan.scanning")}</div>}
        {lookup && <div className="hint">{t("scan.lookup")}</div>}
        {!scanning && !lookup && error && <div className="hint scanerror">{error}</div>}

        {!scanning && !lookup && draft && (
          <div className="scanform">
            <label>
              <span>{t("scan.form.title")}</span>
              <input value={draft.title} onChange={(e) => set("title", e.target.value)} />
            </label>
            <label>
              <span>{t("scan.form.author")}</span>
              <input value={draft.author} onChange={(e) => set("author", e.target.value)} />
            </label>
            <label>
              <span>{t("scan.form.publisher")}</span>
              <input value={draft.publisher} onChange={(e) => set("publisher", e.target.value)} />
            </label>
            <label>
              <span>ISBN</span>
              <input value={draft.isbn} onChange={(e) => set("isbn", e.target.value)} />
            </label>
            <button className="memosave" disabled={!draft.title.trim() || saving} onClick={() => void save()}>
              {saving ? t("scan.saving") : t("scan.save")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 상세 (벤치마크: 블러 히어로 + pill 버튼 + 정보/메모 섹션) ─── */
function DetailView({
  book,
  onBack,
  onPatch,
  onDelete,
}: {
  book: ShelfBook | null;
  onBack: () => void;
  onPatch: (id: string, p: { status?: ReadStatus; liked?: boolean; rating?: number; memo?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [descOpen, setDescOpen] = useState(false);
  const [memo, setMemo] = useState(book?.memo ?? "");
  // window.confirm은 대시보드 iframe sandbox(allow-modals 부재)에서 항상 false — 인앱 확인 UI 사용
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => { setMemo(book?.memo ?? ""); setConfirmOpen(false); }, [book?.id]);

  if (!book) {
    return (
      <div className="scroll">
        <div className="empty">
          {t("detail.notfound")}
          <br />
          <button className="cta" onClick={onBack}>{t("detail.backToList")}</button>
        </div>
      </div>
    );
  }

  const memoDirty = memo !== book.memo;

  return (
    <div className="scroll">
      <div className="detailbody">
        <div className="detailnav">
          <button className="navbtn" onClick={onBack} aria-label={t("detail.backToList")}>‹</button>
          <span />
        </div>

        <div className="hero">
          <div className={`herobg ${book.thumbnail ? "" : "nocover"}`} style={book.thumbnail ? { backgroundImage: `url(${book.thumbnail})` } : undefined} />
          <div className="herocover">
            {book.thumbnail ? <img src={book.thumbnail} alt={book.title} /> : <span className="noimg">📖</span>}
          </div>
        </div>

        <div className="dtitle">
          <h1>{book.title}</h1>
          <p>{book.authors.join(", ") || t("search.unknownAuthor")}</p>
        </div>

        <div className="pillrow">
          <button className={`pill ${book.liked ? "liked" : ""}`} onClick={() => void onPatch(book.id, { liked: !book.liked })}>
            {book.liked ? "♥" : "♡"} {t("detail.like")}
          </button>
          {STATUSES.map((s) => (
            <button key={s} className={`pill ${book.status === s ? "status-on" : ""}`} onClick={() => void onPatch(book.id, { status: s })}>
              {t(`status.${s}` as MessageKey)}
            </button>
          ))}
        </div>

        <div className="section">
          <h4>{t("detail.rating")}</h4>
          <div className="ratingrow">
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} className={s <= book.rating ? "on" : ""} onClick={() => void onPatch(book.id, { rating: book.rating === s ? 0 : s })}>
                ★
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <h4>{t("detail.memo")}</h4>
          <textarea className="memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("detail.memo.placeholder")} />
          <button className="memosave" disabled={!memoDirty} onClick={() => void onPatch(book.id, { memo })}>
            {memoDirty ? t("detail.memo.save") : t("detail.memo.saved")}
          </button>
        </div>

        {book.description && (
          <div className="section">
            <h4>{t("detail.desc")}</h4>
            <div className={`desc ${descOpen ? "" : "clamp"}`}>{book.description}</div>
            <button className="morebtn" onClick={() => setDescOpen(!descOpen)}>{descOpen ? t("detail.less") : t("detail.more")}</button>
          </div>
        )}

        <div className="section">
          <h4>{t("detail.info")}</h4>
          <div className="metatable">
            {book.publisher && <div><b>{t("detail.publisher")}</b>{book.publisher}</div>}
            {book.publishedDate && <div><b>{t("detail.pubdate")}</b>{book.publishedDate}</div>}
            {book.isbn && <div><b>ISBN</b>{book.isbn}</div>}
            {book.pageCount != null && <div><b>{t("detail.pages")}</b>{book.pageCount}{t("detail.pagesUnit")}</div>}
            {book.categories.length > 0 && <div><b>{t("detail.category")}</b>{book.categories.join(", ")}</div>}
            <div><b>{t("detail.addedAt")}</b>{book.addedAt.slice(0, 10)}</div>
          </div>
        </div>

        <div className="section">
          {!confirmOpen ? (
            <button className="dangerbtn" onClick={() => setConfirmOpen(true)}>
              {t("detail.remove")}
            </button>
          ) : (
            <div className="confirmbox">
              <p>{t("detail.removeConfirm", { title: book.title })}</p>
              <div className="confirmrow">
                <button className="cbtn ghost" onClick={() => setConfirmOpen(false)}>{t("search.cancel")}</button>
                <button className="cbtn danger" onClick={() => void onDelete(book.id)}>{t("detail.remove")}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { useColorScheme } from "./theme";
import { htmlToText, loadNotes } from "./notes";
import type {
  BookSource, Deck, DeckSummary, Grade, NoteSource, QueueCard, QuizItem, SourceType, SrsCard, Stats,
} from "./types";

// ── 화면 라우팅 (단일 상태 — 프록시 하위 경로라 history 라우팅 대신 메모리 뷰) ──
type View =
  | { name: "dashboard" }
  | { name: "create" }
  | { name: "deck"; id: string }
  | { name: "review"; deckId?: string }
  | { name: "quiz"; deckId: string };

/** KST(UTC+9) 기준 오늘 날짜 — 서버 due 계산과 동일 기준 */
function kstToday(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 서버 applySm2와 동일한 규칙으로 다음 간격 미리보기 (평가 버튼 라벨용) */
function previewInterval(card: SrsCard, grade: Grade): number {
  const ease = typeof card.ease === "number" ? card.ease : 2.5;
  if (grade === "again") return 0;
  if (grade === "hard") return card.reps === 0 ? 1 : Math.max(1, Math.ceil(card.intervalDays * 1.2));
  if (grade === "good") {
    return card.reps === 0 ? 1 : card.reps === 1 ? 3 : Math.max(1, Math.round(card.intervalDays * ease));
  }
  return card.reps === 0 ? 4 : Math.max(1, Math.round(card.intervalDays * (ease + 0.15) * 1.3));
}

const SOURCE_ICON: Record<SourceType, string> = { paste: "📝", book: "📚", note: "🗒️", file: "📄", link: "🔗" };

// 업로드 파일 → 텍스트 추출. PDF는 pdfjs를 동적 import(초기 번들 경량 유지), 그 외는 평문으로.
async function extractFileText(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return file.text();
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    if (out.length > 60_000) break; // 서버가 16k만 사용 — 과도한 추출 방지
  }
  return out;
}

export function App() {
  useColorScheme();
  const { t } = useI18n();
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  return (
    <div className="app">
      {view.name === "dashboard" && (
        <Dashboard
          onCreate={() => setView({ name: "create" })}
          onOpenDeck={(id) => setView({ name: "deck", id })}
          onReviewAll={() => setView({ name: "review" })}
          showToast={showToast}
        />
      )}
      {view.name === "create" && (
        <CreateDeck
          onBack={() => setView({ name: "dashboard" })}
          onCreated={(deck) => {
            showToast(t("toast.created", { title: deck.title }));
            setView({ name: "deck", id: deck.id });
          }}
        />
      )}
      {view.name === "deck" && (
        <DeckDetail
          id={view.id}
          onBack={() => setView({ name: "dashboard" })}
          onReview={() => setView({ name: "review", deckId: view.id })}
          onQuiz={() => setView({ name: "quiz", deckId: view.id })}
          onRemoved={() => {
            showToast(t("toast.removed"));
            setView({ name: "dashboard" });
          }}
          showToast={showToast}
        />
      )}
      {view.name === "review" && (
        <ReviewSession
          deckId={view.deckId}
          onExit={() => setView(view.deckId ? { name: "deck", id: view.deckId } : { name: "dashboard" })}
          showToast={showToast}
        />
      )}
      {view.name === "quiz" && (
        <QuizSession
          deckId={view.deckId}
          onExit={() => setView({ name: "deck", id: view.deckId })}
          showToast={showToast}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ── ① 대시보드 ─────────────────────────────────────────────────────────────
function Dashboard(props: {
  onCreate: () => void;
  onOpenDeck: (id: string) => void;
  onReviewAll: () => void;
  showToast: (m: string) => void;
}) {
  const { t } = useI18n();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    Promise.all([api.listDecks(), api.stats()])
      .then(([d, s]) => {
        setDecks(d.items);
        setStats(s);
      })
      .catch(() => props.showToast(t("toast.loadFail")));
    // eslint 없이 최초 1회 로드
  }, []);

  const due = stats?.dueCount ?? 0;

  return (
    <div className="scroll">
      <div className="dashhead">
        <h1>🎓 {t("app.title")}</h1>
      </div>

      {due > 0 ? (
        <button className="reviewcta" onClick={props.onReviewAll}>
          <span>
            <span className="big">{t("dash.reviewCta", { n: due })}</span>
            <div className="sub">
              {t("dash.stat.streak")} {stats?.streak ?? 0}{t("dash.dayUnit")} 🔥
            </div>
          </span>
          <span className="go">→</span>
        </button>
      ) : (
        <div className="reviewcta empty">
          <span>
            <span className="big">{t("dash.reviewEmpty")}</span>
            <div className="sub">{t("dash.reviewDoneHint")}</div>
          </span>
        </div>
      )}

      <div className="statrow">
        <div className="stat">
          <div className="num">{stats?.todayReviews ?? 0}<span className="unit">{t("dash.cardUnit")}</span></div>
          <div className="lbl">{t("dash.stat.today")}</div>
        </div>
        <div className="stat">
          <div className="num">{due}<span className="unit">{t("dash.cardUnit")}</span></div>
          <div className="lbl">{t("dash.stat.due")}</div>
        </div>
        <div className="stat">
          <div className="num">{stats?.totalCards ?? 0}<span className="unit">{t("dash.cardUnit")}</span></div>
          <div className="lbl">{t("dash.stat.total")}</div>
        </div>
        <div className="stat streak">
          <div className="num">{stats?.streak ?? 0}<span className="unit">{t("dash.dayUnit")}</span></div>
          <div className="lbl">{t("dash.stat.streak")}</div>
        </div>
      </div>

      <div className="sectionhead">
        <h3>
          {t("dash.decks")}
          <span className="count">{decks.length}</span>
        </h3>
        <button className="newdeckbtn" onClick={props.onCreate}>{t("dash.newDeck")}</button>
      </div>

      {decks.length === 0 ? (
        <div className="empty">
          {t("dash.empty")}
          <br />
          <button className="cta" onClick={props.onCreate}>{t("dash.empty.cta")}</button>
        </div>
      ) : (
        <div className="deckgrid">
          {decks.map((d) => (
            <button key={d.id} className="deckcard" onClick={() => props.onOpenDeck(d.id)}>
              <div className="dtop">
                <span>{SOURCE_ICON[d.source.type] ?? "📝"}</span>
                <span className="dtitle">{d.title}</span>
              </div>
              {d.summary && <div className="dsummary">{d.summary}</div>}
              <div className="dmeta">
                {d.dueCount > 0 && <span className="tag due">{t("deck.due", { n: d.dueCount })}</span>}
                {d.newCount > 0 && <span className="tag new">{t("deck.new", { n: d.newCount })}</span>}
                <span className="tag">{t("deck.cards", { n: d.cardCount })}</span>
                {d.quizCount > 0 && <span className="tag">{t("deck.quiz", { n: d.quizCount })}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ② 덱 생성 (붙여넣기 / 책장 / 노트 → AI 생성) ──────────────────────────
type SrcTab = "paste" | "file" | "link" | "book" | "note";

function CreateDeck(props: { onBack: () => void; onCreated: (deck: Deck) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SrcTab>("paste");
  const [pasteText, setPasteText] = useState("");
  const [books, setBooks] = useState<BookSource[] | null>(null);
  const [notes, setNotes] = useState<NoteSource[] | null>(null);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 탭 진입 시 소스 지연 로드 — 책장은 서버 API, 노트는 same-origin IndexedDB
  useEffect(() => {
    if (tab === "book" && books === null) {
      api.bookSources().then((r) => setBooks(r.items)).catch(() => setBooks([]));
    }
    if (tab === "note" && notes === null) {
      loadNotes().then(setNotes);
    }
  }, [tab, books, notes]);

  const onFile = async (f: File) => {
    setError("");
    setFileName(f.name);
    setFileText("");
    setExtracting(true);
    try {
      const text = await extractFileText(f);
      setFileText(text);
      if (text.trim().length < 30) setError(t("create.file.tooShort"));
    } catch {
      setError(t("create.file.readFail"));
      setFileName("");
    } finally {
      setExtracting(false);
    }
  };

  // paste/book/note/file 은 로컬에서 즉시 텍스트 구성. link 는 generate 시 서버에서 추출.
  const buildSource = (): { text: string; type: SourceType; title: string } | null => {
    if (tab === "paste") {
      const text = pasteText.trim();
      if (text.length < 30) return null;
      return { text, type: "paste", title: text.slice(0, 40) };
    }
    if (tab === "file") {
      const text = fileText.trim();
      if (text.length < 30) return null;
      return { text, type: "file", title: fileName || t("source.file") };
    }
    if (tab === "book") {
      const b = books?.find((x) => x.id === selectedBook);
      if (!b) return null;
      const text = [
        `제목: ${b.title}`,
        b.authors.length ? `저자: ${b.authors.join(", ")}` : "",
        b.publisher ? `출판사: ${b.publisher}` : "",
        b.description ? `설명: ${b.description}` : "",
        b.memo ? `내 메모: ${b.memo}` : "",
      ].filter(Boolean).join("\n");
      if (text.length < 30) return null;
      return { text, type: "book", title: b.title };
    }
    if (tab === "note") {
      const n = notes?.find((x) => x.id === selectedNote);
      if (!n) return null;
      const body = htmlToText(n.content);
      const text = `${n.title}\n\n${body}`;
      if (text.trim().length < 30) return null;
      return { text, type: "note", title: n.title };
    }
    return null;
  };

  const canGenerate = tab === "link"
    ? /^https?:\/\/.+/i.test(url.trim())
    : !extracting && buildSource() !== null;

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      let text: string, type: SourceType, title: string;
      if (tab === "link") {
        const ex = await api.extractUrl(url.trim());
        text = ex.text;
        type = "link";
        title = ex.title || url.trim();
      } else {
        const src = buildSource();
        if (!src) {
          setError(t("create.tooShort"));
          setBusy(false);
          return;
        }
        ({ text, type, title } = src);
      }
      const { item } = await api.generateDeck(text, type, title);
      props.onCreated(item);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <button className="backbtn" onClick={props.onBack} disabled={busy}>← {t("create.back")}</button>
        <h2>{t("create.title")}</h2>
      </div>
      <div className="scroll">
        <div className="createbody">
          {busy ? (
            <div className="genprogress">
              <div className="spinner" />
              <div>{t("create.generating")}</div>
              <div className="hintline">{t("create.generatingHint")}</div>
            </div>
          ) : (
            <>
              <div className="srctabs">
                {(["paste", "file", "link", "book", "note"] as SrcTab[]).map((k) => (
                  <button key={k} className={`srctab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
                    {SOURCE_ICON[k]} {t(`create.tab.${k}` as "create.tab.paste")}
                  </button>
                ))}
              </div>

              {tab === "paste" && (
                <textarea
                  className="pastearea"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={t("create.paste.placeholder")}
                />
              )}

              {tab === "file" && (
                <div className="filearea">
                  <label className="filezone">
                    <input
                      type="file"
                      accept=".txt,.md,.markdown,.text,.pdf,text/plain,text/markdown,application/pdf"
                      hidden
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
                    />
                    <span className="fzicon">{extracting ? "⏳" : "📄"}</span>
                    <span className="fztext">
                      {extracting ? t("create.file.reading") : fileName || t("create.file.pick")}
                    </span>
                    <span className="fzhint">{t("create.file.types")}</span>
                  </label>
                  {fileText && !extracting && (
                    <div className="hintnote">{t("create.file.chars", { n: fileText.length.toLocaleString() })}</div>
                  )}
                </div>
              )}

              {tab === "link" && (
                <div className="linkarea">
                  <input
                    type="url"
                    className="linkinput"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t("create.link.placeholder")}
                  />
                  <div className="hintnote">{t("create.link.hint")}</div>
                </div>
              )}

              {tab === "book" && (
                books === null ? (
                  <div className="hintnote">{t("create.book.loading")}</div>
                ) : books.length === 0 ? (
                  <div className="hintnote">{t("create.book.empty")}</div>
                ) : (
                  <div className="srclist">
                    {books.map((b) => (
                      <button
                        key={b.id}
                        className={`srcitem ${selectedBook === b.id ? "selected" : ""}`}
                        onClick={() => setSelectedBook(b.id)}
                      >
                        <span className="sicon">📚</span>
                        <span className="sbody">
                          <div className="stitle">{b.title}</div>
                          <div className="smeta">
                            {[b.authors.join(", "), b.publisher].filter(Boolean).join(" · ")}
                            {b.description ? ` — ${b.description}` : ""}
                          </div>
                        </span>
                        {selectedBook === b.id && <span className="check">✓</span>}
                      </button>
                    ))}
                  </div>
                )
              )}

              {tab === "note" && (
                notes === null ? (
                  <div className="hintnote">{t("create.note.loading")}</div>
                ) : notes.length === 0 ? (
                  <div className="hintnote">{t("create.note.empty")}</div>
                ) : (
                  <div className="srclist">
                    {notes.map((n) => (
                      <button
                        key={n.id}
                        className={`srcitem ${selectedNote === n.id ? "selected" : ""}`}
                        onClick={() => setSelectedNote(n.id)}
                      >
                        <span className="sicon">🗒️</span>
                        <span className="sbody">
                          <div className="stitle">{n.title || t("source.untitled")}</div>
                          <div className="smeta">{htmlToText(n.content).slice(0, 140)}</div>
                        </span>
                        {selectedNote === n.id && <span className="check">✓</span>}
                      </button>
                    ))}
                  </div>
                )
              )}

              {error && <div className="generr">{error}</div>}
              <button className="genbtn" onClick={generate} disabled={!canGenerate}>
                ✨ {t("create.generate")}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── ③ 덱 상세 ─────────────────────────────────────────────────────────────
function DeckDetail(props: {
  id: string;
  onBack: () => void;
  onReview: () => void;
  onQuiz: () => void;
  onRemoved: () => void;
  showToast: (m: string) => void;
}) {
  const { t } = useI18n();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openConcept, setOpenConcept] = useState<number | null>(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api.getDeck(props.id)
      .then((r) => setDeck(r.item))
      .catch(() => props.showToast(t("toast.loadFail")))
      .finally(() => setLoaded(true));
  }, [props.id]);

  const today = kstToday();
  const dueCount = useMemo(
    () => (deck ? deck.cards.filter((c) => c.due <= today).length : 0),
    [deck, today],
  );

  const remove = async () => {
    try {
      await api.removeDeck(props.id);
      props.onRemoved();
    } catch {
      props.showToast(t("toast.removeFail"));
    }
  };

  if (!loaded) return <div className="scroll" />;
  if (!deck) {
    return (
      <>
        <div className="topbar">
          <button className="backbtn" onClick={props.onBack}>← {t("detail.back")}</button>
        </div>
        <div className="empty">{t("detail.notfound")}</div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <button className="backbtn" onClick={props.onBack}>← {t("detail.back")}</button>
      </div>
      <div className="scroll">
        <div className="detailbody">
          <div className="deckhero">
            <h1>{deck.title}</h1>
            <div className="heromenta">
              <span className="tag src">{SOURCE_ICON[deck.source.type]} {t(`source.${deck.source.type}` as "source.paste")}</span>
              <span className="tag">{t("deck.cards", { n: deck.cards.length })}</span>
              {deck.quiz.length > 0 && <span className="tag">{t("deck.quiz", { n: deck.quiz.length })}</span>}
            </div>
          </div>

          <div className="actionrow">
            <button className="actionbtn" onClick={props.onReview} disabled={dueCount === 0}>
              {dueCount > 0 ? `🔁 ${t("detail.review", { n: dueCount })}` : t("detail.noDue")}
            </button>
            <button className="actionbtn secondary" onClick={props.onQuiz} disabled={deck.quiz.length === 0}>
              ❓ {t("detail.startQuiz", { n: deck.quiz.length })}
            </button>
          </div>

          {deck.summary && (
            <div className="section">
              <h4>{t("detail.summary")}</h4>
              <div className="summarybox">{deck.summary}</div>
            </div>
          )}

          {deck.keyConcepts.length > 0 && (
            <div className="section">
              <h4>{t("detail.concepts")}</h4>
              <div className="accordion">
                {deck.keyConcepts.map((k, i) => (
                  <div className="accitem" key={i}>
                    <button className="acchead" onClick={() => setOpenConcept(openConcept === i ? null : i)}>
                      <span>{k.term}</span>
                      <span className={`arrow ${openConcept === i ? "open" : ""}`}>▾</span>
                    </button>
                    {openConcept === i && <div className="accbody">{k.explanation}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="section">
            <h4>{t("detail.cards")}</h4>
            <div className="cardlist">
              {deck.cards.map((c) => (
                <div className="cardrow" key={c.id}>
                  <div className="cfront">{c.front}</div>
                  <div className="cback">{c.back}</div>
                  <span className={`cdue ${c.reps === 0 ? "new" : c.due <= today ? "today" : ""}`}>
                    {c.reps === 0
                      ? t("detail.newCard")
                      : c.due <= today
                        ? t("detail.today")
                        : t("detail.dueIn", {
                            n: Math.max(1, Math.round((new Date(`${c.due}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000)),
                          })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="dangerzone">
            {confirming ? (
              <div className="confirmbox">
                <p>{t("detail.removeConfirm", { title: deck.title })}</p>
                <div className="confirmrow">
                  <button className="cbtn ghost" onClick={() => setConfirming(false)}>{t("detail.cancel")}</button>
                  <button className="cbtn danger" onClick={remove}>{t("detail.confirmRemove")}</button>
                </div>
              </div>
            ) : (
              <button className="dangerbtn" onClick={() => setConfirming(true)}>{t("detail.remove")}</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── ④ 복습 세션 (카드 플립 + SM-2 4단계 평가) ─────────────────────────────
function ReviewSession(props: { deckId?: string; onExit: () => void; showToast: (m: string) => void }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<QueueCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<Record<Grade, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => {
    api.reviewQueue(props.deckId)
      .then((r) => setQueue(r.items))
      .catch(() => {
        props.showToast(t("toast.loadFail"));
        setQueue([]);
      });
  }, [props.deckId]);

  if (queue === null) return <div className="scroll" />;

  const total = queue.length;
  const card = queue[idx];
  const done = !card;

  const grade = async (g: Grade) => {
    if (!card) return;
    setTally((prev) => ({ ...prev, [g]: prev[g] + 1 }));
    setReviewed((n) => n + 1);
    // again은 세션 내 재출제 (Anki 방식) — 큐 끝에 다시 넣는다
    if (g === "again") {
      setQueue((q) => (q ? [...q, { ...card, reps: 0, intervalDays: 0 }] : q));
    }
    setFlipped(false);
    setIdx((i) => i + 1);
    try {
      await api.answer(card.id, g);
    } catch (e) {
      props.showToast((e as Error).message);
    }
  };

  const intervalLabel = (g: Grade) => {
    const days = card ? previewInterval(card, g) : 0;
    return days === 0 ? t("review.intervalToday") : t("review.intervalDays", { n: days });
  };

  return (
    <>
      <div className="topbar">
        <button className="backbtn" onClick={props.onExit}>✕ {t("review.exit")}</button>
        <h2>{t("review.title")}</h2>
      </div>
      <div className="scroll" style={{ display: "flex", flexDirection: "column" }}>
        <div className="reviewwrap">
          {total === 0 ? (
            <div className="donecard">
              <h2>{t("review.empty")}</h2>
              <button className="cta" onClick={props.onExit}>{t("review.exit")}</button>
            </div>
          ) : done ? (
            <div className="donecard">
              <h2>{t("review.done.title")}</h2>
              <div className="sub">{t("review.done.count", { n: reviewed })}</div>
              <div className="donestats">
                <span className="donestat again">{t("review.again")} {tally.again}</span>
                <span className="donestat hard">{t("review.hard")} {tally.hard}</span>
                <span className="donestat good">{t("review.good")} {tally.good}</span>
                <span className="donestat easy">{t("review.easy")} {tally.easy}</span>
              </div>
              <button className="cta" onClick={props.onExit}>{t("review.exit")}</button>
            </div>
          ) : (
            <>
              <div className="progressbar">
                <div className="fill" style={{ width: `${Math.round((idx / total) * 100)}%` }} />
              </div>
              <div className="progresstext">{idx + 1} / {total}</div>

              <div className="flipzone">
                {/* key로 카드 전환 시 플립 상태를 애니메이션 없이 리셋 */}
                <button
                  key={`${card.id}-${idx}`}
                  className={`flipcard ${flipped ? "flipped" : ""}`}
                  onClick={() => setFlipped(true)}
                  aria-label={flipped ? "answer" : "question"}
                >
                  <span className="face front">
                    <span className="facelabel">Q</span>
                    <span className="facedeck">{card.deckTitle}</span>
                    <span className="facetext">{card.front}</span>
                  </span>
                  <span className="face back">
                    <span className="facelabel">A</span>
                    <span className="facedeck">{card.deckTitle}</span>
                    <span className="facetext">{card.back}</span>
                  </span>
                </button>
              </div>

              {!flipped ? (
                <button className="showanswer" onClick={() => setFlipped(true)}>{t("review.showAnswer")}</button>
              ) : (
                <div className="gradesrow">
                  <button className="gradebtn again" onClick={() => grade("again")}>
                    <span className="glabel">{t("review.again")}</span>
                    <span className="ginterval">{intervalLabel("again")}</span>
                  </button>
                  <button className="gradebtn hard" onClick={() => grade("hard")}>
                    <span className="glabel">{t("review.hard")}</span>
                    <span className="ginterval">{intervalLabel("hard")}</span>
                  </button>
                  <button className="gradebtn good" onClick={() => grade("good")}>
                    <span className="glabel">{t("review.good")}</span>
                    <span className="ginterval">{intervalLabel("good")}</span>
                  </button>
                  <button className="gradebtn easy" onClick={() => grade("easy")}>
                    <span className="glabel">{t("review.easy")}</span>
                    <span className="ginterval">{intervalLabel("easy")}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── ⑤ 퀴즈 모드 (4지선다 + 즉시 정오답·해설) ─────────────────────────────
function QuizSession(props: { deckId: string; onExit: () => void; showToast: (m: string) => void }) {
  const { t } = useI18n();
  const [quiz, setQuiz] = useState<QuizItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    api.getDeck(props.deckId)
      .then((r) => setQuiz(r.item.quiz))
      .catch(() => {
        props.showToast(t("toast.loadFail"));
        setQuiz([]);
      });
  }, [props.deckId]);

  if (quiz === null) return <div className="scroll" />;

  const q = quiz[idx];
  const isLast = idx >= quiz.length - 1;

  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    if (q && i === q.answerIndex) setCorrect((c) => c + 1);
  };

  const next = () => {
    setPicked(null);
    if (isLast) setFinished(true);
    else setIdx((i) => i + 1);
  };

  const retry = () => {
    setIdx(0);
    setPicked(null);
    setCorrect(0);
    setFinished(false);
  };

  return (
    <>
      <div className="topbar">
        <button className="backbtn" onClick={props.onExit}>✕ {t("quiz.exit")}</button>
        <h2>{t("quiz.title")}</h2>
      </div>
      <div className="scroll">
        <div className="quizwrap">
          {quiz.length === 0 ? (
            <div className="donecard">
              <h2>{t("quiz.empty")}</h2>
              <button className="cta" onClick={props.onExit}>{t("quiz.exit")}</button>
            </div>
          ) : finished ? (
            <div className="donecard">
              <h2>{t("quiz.result.title")}</h2>
              <div className="scorering">
                {correct}<span className="of"> / {quiz.length}</span>
              </div>
              <div className="sub">{t("quiz.result.score", { correct, total: quiz.length })}</div>
              <div className="donestats">
                <button className="donestat" onClick={retry}>🔄 {t("quiz.retry")}</button>
              </div>
              <button className="cta" onClick={props.onExit}>{t("quiz.exit")}</button>
            </div>
          ) : q ? (
            <>
              <div className="progressbar">
                <div className="fill" style={{ width: `${Math.round(((idx + (picked !== null ? 1 : 0)) / quiz.length) * 100)}%` }} />
              </div>
              <div className="progresstext">{idx + 1} / {quiz.length}</div>
              <div className="quizq">{q.question}</div>
              <div className="choices">
                {q.choices.map((c, i) => {
                  let cls = "choice";
                  if (picked !== null) {
                    if (i === q.answerIndex) cls += " correct";
                    else if (i === picked) cls += " wrong";
                  }
                  return (
                    <button key={i} className={cls} onClick={() => pick(i)} disabled={picked !== null}>
                      <span className="cno">{i + 1}</span>
                      <span>{c}</span>
                    </button>
                  );
                })}
              </div>
              {picked !== null && (
                <>
                  <div className={`verdict ${picked === q.answerIndex ? "ok" : "no"}`}>
                    <b>{picked === q.answerIndex ? `✅ ${t("quiz.correct")}` : `❌ ${t("quiz.wrong")}`}</b>
                    {q.explanation && (
                      <span className="vex">{t("quiz.explanation")}: {q.explanation}</span>
                    )}
                  </div>
                  <button className="nextbtn" onClick={next}>
                    {isLast ? t("quiz.finish") : t("quiz.next")}
                  </button>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

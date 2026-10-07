import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { HISTORY_DIR, PROJECT_SELF_DIR, toKstDate } from "../config.js";
import { runGatewayClaude } from "./ai-gateway.js";
import { logCost } from "./jobs.js";
import { addTodo } from "./todos.js";
import { checkGroqQuota, recordGroqUsage, isGroqRateLimitError } from "./groq-usage.js";
import { transcribeLocal } from "@mycrew/whisper-local";
import { transcribeWithGemini } from "./voice-stt.js";

import { processWithMeetingMemory, saveMeetingMemoryArtifacts } from "./meeting-memory.js";

export const RECORDINGS_DIR = join(HISTORY_DIR, "recordings");
export const MEETINGS_DIR = join(HISTORY_DIR, "outputs", "meetings");

export type MeetingLanguage = "ko" | "en" | "ja";

const TOKEN_RE = /^[0-9a-f]{32}$/;
const ALLOWED_AUDIO_EXT = new Set(["webm", "wav", "mp3", "m4a", "ogg", "opus"]);
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024; // 1GB

export function ensureMeetingDirs(): void {
  for (const d of [RECORDINGS_DIR, MEETINGS_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function generateShareToken(): string {
  // 32자 hex (128-bit entropy). 충돌 시 재생성.
  for (let i = 0; i < 5; i++) {
    const t = randomBytes(16).toString("hex");
    const htmlPath = join(MEETINGS_DIR, `${t}.html`);
    const metaPath = join(MEETINGS_DIR, `${t}.meta.json`);
    if (!existsSync(htmlPath) && !existsSync(metaPath)) return t;
  }
  throw new Error("토큰 생성 실패: 5회 시도 후 충돌");
}

export function isValidToken(s: string): boolean {
  return TOKEN_RE.test(s);
}

export function getShareBaseUrl(port: number): string {
  return process.env.TUNNEL_URL || process.env.NGROK_URL || `http://localhost:${port}`;
}

export interface RecordingMeta {
  id: string;
  ext: string;
  path: string;       // 절대 경로
  size: number;
  durationSec?: number;
  source: "mic" | "upload";
  originalName?: string;
  createdAt: string;
}

export async function persistRecording(
  file: File,
  source: "mic" | "upload",
  durationSec?: number,
): Promise<RecordingMeta> {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error(`녹음 파일이 너무 큼 (${file.size} bytes, 최대 1GB)`);
  }
  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  if (!ALLOWED_AUDIO_EXT.has(ext)) {
    throw new Error(`허용되지 않는 확장자: ${ext} (허용: ${[...ALLOWED_AUDIO_EXT].join(", ")})`);
  }
  const today = toKstDate();
  const dir = join(RECORDINGS_DIR, today);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const filename = `${id}.${ext}`;
  const fullPath = join(dir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  writeFileSync(fullPath, buf);
  const meta: RecordingMeta = {
    id,
    ext,
    path: fullPath,
    size: buf.length,
    durationSec,
    source,
    originalName: file.name,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(`${fullPath}.json`, JSON.stringify(meta, null, 2));
  return meta;
}

export function listRecordings(limit = 50): RecordingMeta[] {
  if (!existsSync(RECORDINGS_DIR)) return [];
  const out: RecordingMeta[] = [];
  for (const date of readdirSync(RECORDINGS_DIR).sort().reverse()) {
    const sub = join(RECORDINGS_DIR, date);
    if (!statSync(sub).isDirectory()) continue;
    for (const f of readdirSync(sub)) {
      if (!f.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(readFileSync(join(sub, f), "utf-8")) as RecordingMeta;
        if (existsSync(meta.path)) out.push(meta);
      } catch { /* skip */ }
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export interface MeetingMeta {
  token: string;
  title: string;
  recordingPath: string;
  durationSec?: number;
  status: "processing" | "ready" | "failed";
  shareUrl: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  // 크로스앱 연결용 — 요약·액션 아이템을 구조화 저장(할일/노트 전송에 재사용).
  shortSummary?: string;
  actionItems?: { task: string; owner?: string; dueDate?: string }[];
  // STT에 실제 사용된 엔진 — Groq 무료 티어 초과/에러 시 로컬 whisper.cpp로 폴백된 경우 "local".
  sttEngine?: "groq" | "gemini" | "local";
  // 회의 언어 — STT 인식 언어 + AI 요약 출력 언어. 미지정 시 "ko"(회귀 방지 기본값).
  language?: MeetingLanguage;
  transcriptionProvider?: "groq" | "gemini";
  memoryJobId?: string;
}

export function saveMeetingMeta(meta: MeetingMeta): void {
  ensureMeetingDirs();
  const p = join(MEETINGS_DIR, `${meta.token}.meta.json`);
  writeFileSync(p, JSON.stringify(meta, null, 2));
}

// 디스크의 .meta.json 파일이 과거 비정규 필드(`recording`/`failedAt`)로 저장된 경우를
// 표준 MeetingMeta 스키마로 정규화한다. 2026-06-19 planner-researcher 워커가
// `saveMeetingMeta()`를 우회하고 직접 JSON을 작성하면서 발생한 스키마 드리프트 백워드 호환.
function normalizeMeetingMeta(raw: any, fallbackToken?: string): MeetingMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const token = typeof raw.token === "string" ? raw.token : fallbackToken;
  if (!token) return null;
  const createdAt = raw.createdAt ?? raw.failedAt ?? raw.completedAt ?? new Date(0).toISOString();
  return {
    token,
    title: typeof raw.title === "string" ? raw.title : "",
    recordingPath: raw.recordingPath ?? raw.recording ?? "",
    durationSec: typeof raw.durationSec === "number" ? raw.durationSec : undefined,
    status: raw.status === "ready" || raw.status === "failed" ? raw.status : "processing",
    shareUrl: typeof raw.shareUrl === "string" ? raw.shareUrl : "",
    createdAt,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
    errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage : undefined,
    shortSummary: typeof raw.shortSummary === "string" ? raw.shortSummary : undefined,
    sttEngine: raw.sttEngine === "groq" || raw.sttEngine === "gemini" || raw.sttEngine === "local" ? raw.sttEngine : undefined,
    language: raw.language === "ko" || raw.language === "en" || raw.language === "ja" ? raw.language : undefined,
    transcriptionProvider: raw.transcriptionProvider === "gemini" ? "gemini" : "groq",
    memoryJobId: typeof raw.memoryJobId === "string" ? raw.memoryJobId : undefined,
    actionItems: Array.isArray(raw.actionItems)
      ? raw.actionItems
          .filter((a: any) => a && typeof a.task === "string")
          .map((a: any) => ({
            task: a.task as string,
            owner: typeof a.owner === "string" ? a.owner : undefined,
            dueDate: typeof a.dueDate === "string" ? a.dueDate : undefined,
          }))
      : undefined,
  };
}

export function readMeetingMeta(token: string): MeetingMeta | null {
  if (!isValidToken(token)) return null;
  const p = join(MEETINGS_DIR, `${token}.meta.json`);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    return normalizeMeetingMeta(raw, token);
  } catch {
    return null;
  }
}

export function readMeetingHtml(token: string): string | null {
  if (!isValidToken(token)) return null;
  const p = join(MEETINGS_DIR, `${token}.html`);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

export function deleteRecording(id: string): boolean {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const items = listRecordings(500);
  const r = items.find((x) => x.id === id);
  if (!r) return false;
  try {
    if (existsSync(r.path)) rmSync(r.path);
    const sidecar = `${r.path}.json`;
    if (existsSync(sidecar)) rmSync(sidecar);
    return true;
  } catch {
    return false;
  }
}

export function deleteMeeting(token: string): boolean {
  if (!isValidToken(token)) return false;
  const metaPath = join(MEETINGS_DIR, `${token}.meta.json`);
  const htmlPath = join(MEETINGS_DIR, `${token}.html`);
  let any = false;
  try {
    if (existsSync(metaPath)) { rmSync(metaPath); any = true; }
    if (existsSync(htmlPath)) { rmSync(htmlPath); any = true; }
    for (const extension of ['md', 'ontology.json']) {
      const artifactPath = join(MEETINGS_DIR, `${token}.${extension}`);
      if (existsSync(artifactPath)) { rmSync(artifactPath); any = true; }
    }
    return any;
  } catch {
    return false;
  }
}

export function listMeetings(limit = 50): MeetingMeta[] {
  if (!existsSync(MEETINGS_DIR)) return [];
  const out: MeetingMeta[] = [];
  for (const f of readdirSync(MEETINGS_DIR)) {
    if (!f.endsWith(".meta.json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(MEETINGS_DIR, f), "utf-8"));
      const token = f.replace(/\.meta\.json$/, "");
      const meta = normalizeMeetingMeta(raw, token);
      if (meta) out.push(meta);
    } catch { /* skip */ }
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, limit);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderProcessingPage(meta: MeetingMeta): string {
  const title = escapeHtml(meta.title || "회의록 생성 중");
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · 처리 중</title>
<style>
  body { font-family: -apple-system, "Pretendard", sans-serif; max-width: 560px; margin: 80px auto; padding: 0 24px; color: #0F172A; background: #F8F9FA; line-height: 1.6; }
  h1 { font-size: 22px; margin-bottom: 12px; }
  .meta { color: #64748B; font-size: 13px; margin-bottom: 24px; }
  .box { background: #fff; border: 1px solid #E5E5E5; border-radius: 12px; padding: 24px; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #E5E5E5; border-top-color: #1E49B7; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-color-scheme: dark) {
    body { background: #0F172A; color: #F3F4F6; }
    .box { background: #1F2937; border-color: #374151; }
  }
</style>
<meta http-equiv="refresh" content="15">
</head><body>
<h1>${title}</h1>
<div class="meta">생성: ${escapeHtml(meta.createdAt)}</div>
<div class="box">
  <p><span class="spinner"></span>회의록을 생성 중입니다.</p>
  <p style="font-size: 13px; color: #64748B; margin-top: 12px;">전사·요약 처리에 1~5분 정도 걸려요. 이 페이지는 15초마다 자동 새로고침됩니다.</p>
</div>
</body></html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>회의록을 찾을 수 없어요</title>
<style>
  body { font-family: -apple-system, "Pretendard", sans-serif; max-width: 560px; margin: 80px auto; padding: 0 24px; color: #0F172A; background: #F8F9FA; line-height: 1.6; text-align: center; }
  h1 { font-size: 22px; margin-bottom: 12px; }
  p { color: #64748B; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0F172A; color: #F3F4F6; }
    p { color: #9CA3AF; }
  }
</style>
</head><body>
<h1>회의록을 찾을 수 없어요</h1>
<p>잘못된 링크이거나, 회의록이 삭제되었을 수 있어요.</p>
</body></html>`;
}

/**
 * 헨젤 디자인 명세에 맞춰 헬퍼: 요약 JSON을 받아 단독 HTML 빌드.
 * Phase 1에서는 planner-researcher가 직접 변수 치환을 수행하지만, 안정성 폴백으로 서버측 빌더도 제공.
 */
export interface MeetingPayload {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  date?: string;
  time?: string;
  duration?: string;
  location?: string;
  attendees?: { name: string; role?: string }[];
  recordingDuration?: string;
  transcriptLength?: number;
  summary: string[]; // 3줄 요약
  decisions: { id?: string; title: string; description?: string }[];
  actionItems: {
    id?: string;
    task: string;
    owner?: string;
    dueDate?: string;
    status?: "done" | "progress" | "ready" | "blocked";
    statusLabel?: string;
    note?: string;
    done?: boolean;
  }[];
  transcript?: { body: string; length?: number; duration?: number };
}

// 헨젤 v2 명세서(meeting-template-v2-component-spec_designer_2026-05-29.md) P1 컴포넌트.
// sample.html은 디자이너 산출물(writePaths 외)이라 코드에서 inject — 디자이너가 sample을
// 직접 갱신하면 idempotent하게 중복 inject 회피(MEETING_P1_MARKER 검사).
const MEETING_P1_MARKER = "/* p1-tokens-v2 */";

const MEETING_P1_CSS = `${MEETING_P1_MARKER}
:root {
  --danger-bg:  #FEF2F2;
  --success-bg: #F0FDF4;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --danger-bg:  #2A1717;
    --success-bg: #142A1A;
  }
}
:root[data-theme="dark"] {
  --danger-bg:  #2A1717;
  --success-bg: #142A1A;
}
.callout { display: grid; grid-template-columns: 32px 1fr; gap: 12px; padding: 16px 20px; margin: 20px 0; border-radius: 8px; border: 1px solid var(--border-soft); border-left-width: 3px; }
.callout-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; background: var(--bg-card); }
.callout-title { font-family: var(--sans); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
.callout-body p { font-family: var(--serif); font-size: 14px; line-height: 1.7; color: var(--text-secondary); margin: 0; }
.callout--danger    { border-left-color: var(--blocked);      background: var(--danger-bg); }
.callout--danger    .callout-icon, .callout--danger .callout-title { color: var(--blocked); }
.callout--warning   { border-left-color: var(--progress);     background: var(--bg-warm); }
.callout--warning   .callout-icon { color: var(--progress); }
.callout--warning   .callout-title { color: var(--text); }
.callout--decision  { border-left-color: var(--accent);       background: var(--accent-bg); }
.callout--decision  .callout-icon { color: var(--accent); }
.callout--decision  .callout-title { color: var(--accent-dark); }
.callout--highlight { border-left-color: var(--accent-light); background: var(--accent-bg); }
.callout--highlight .callout-icon { color: var(--accent); }
.callout--highlight .callout-title { color: var(--accent-dark); }
.callout--success   { border-left-color: var(--done);         background: var(--success-bg); }
.callout--success   .callout-icon, .callout--success .callout-title { color: var(--done); }
.codeblock { margin: 20px 0; background: var(--bg-subtle); border: 1px solid var(--border-soft); border-radius: 8px; overflow: hidden; }
.codeblock-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-warm); border-bottom: 1px solid var(--border-soft); }
.codeblock-lang { font-family: var(--mono); font-size: 11px; color: var(--text-muted); text-transform: lowercase; }
.codeblock-copy { display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font: inherit; font-family: var(--sans); font-size: 11px; color: var(--text-secondary); transition: all 0.15s; }
.codeblock-copy:hover { background: var(--bg-elevated); border-color: var(--border-strong); color: var(--text); }
.codeblock-copy:active { transform: scale(0.97); }
.codeblock-copy.is-copied { background: var(--success-bg); border-color: var(--done); color: var(--done); }
.codeblock-copy.is-copied .codeblock-copy-label::before { content: '✓ '; font-weight: 700; }
.codeblock pre { margin: 0; padding: 16px 20px; font-family: var(--mono); font-size: 13px; line-height: 1.6; color: var(--text); overflow-x: auto; }
.codeblock code { font-family: inherit; background: transparent; }
.scroll-progress { position: fixed; top: 0; left: 0; right: 0; height: 2px; background: transparent; z-index: 100; pointer-events: none; }
.scroll-progress-fill { height: 100%; width: 0; background: linear-gradient(90deg, var(--accent), var(--accent-light)); transition: width 0.05s linear; box-shadow: 0 0 8px var(--accent); }
@media (prefers-reduced-motion: reduce) { .scroll-progress-fill { transition: none; box-shadow: none; } }
@media print { .scroll-progress { display: none; } }
`;

const MEETING_P1_FOUC_SCRIPT = `<script>
(function(){
  try {
    var saved = localStorage.getItem('meeting-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) { /* localStorage 차단 환경 */ }
})();
</script>`;

const MEETING_P1_PROGRESS_HTML = `<div class="scroll-progress" role="progressbar" aria-label="페이지 읽기 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="scroll-progress-fill"></div></div>`;

const MEETING_P1_RUNTIME_SCRIPT = `<script>
(function(){
  var fill = document.querySelector('.scroll-progress-fill');
  var bar = document.querySelector('.scroll-progress');
  if (fill && bar) {
    var ticking = false;
    function update() {
      var h = document.documentElement;
      var denom = h.scrollHeight - h.clientHeight;
      var scrolled = denom > 0 ? h.scrollTop / denom : 0;
      var pct = Math.min(100, Math.max(0, scrolled * 100));
      fill.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', Math.round(pct));
      ticking = false;
    }
    document.addEventListener('scroll', function(){
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }
  document.querySelectorAll('.codeblock-copy').forEach(function(btn){
    btn.addEventListener('click', async function(){
      var sel = btn.getAttribute('data-copy-target');
      if (!sel) return;
      var target = document.querySelector(sel);
      if (!target) return;
      var text = target.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('is-copied');
        var label = btn.querySelector('.codeblock-copy-label');
        var prev = label ? label.textContent : null;
        if (label) label.textContent = '복사됨';
        setTimeout(function(){
          btn.classList.remove('is-copied');
          if (label && prev !== null) label.textContent = prev;
        }, 2000);
      } catch (e) { /* clipboard 차단 */ }
    });
  });
  try {
    var mo = new MutationObserver(function(mutations){
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'data-theme') {
          var t = document.documentElement.getAttribute('data-theme');
          if (t === 'dark' || t === 'light') {
            try { localStorage.setItem('meeting-theme', t); } catch(e){}
          }
        }
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* MutationObserver 없는 환경 */ }
})();
</script>`;

function injectMeetingP1(html: string): string {
  if (html.includes(MEETING_P1_MARKER)) return html;
  const styleClose = html.lastIndexOf("</style>");
  if (styleClose !== -1) {
    html = html.slice(0, styleClose) + "\n" + MEETING_P1_CSS + "\n" + html.slice(styleClose);
  }
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    html = html.slice(0, headClose) + "\n" + MEETING_P1_FOUC_SCRIPT + "\n" + html.slice(headClose);
  }
  html = html.replace(/(<body[^>]*>)/i, `$1\n${MEETING_P1_PROGRESS_HTML}`);
  const bodyClose = html.lastIndexOf("</body>");
  if (bodyClose !== -1) {
    html = html.slice(0, bodyClose) + "\n" + MEETING_P1_RUNTIME_SCRIPT + "\n" + html.slice(bodyClose);
  }
  return html;
}

export function renderMeetingHtml(payload: MeetingPayload, opts: { token: string; shareUrl: string; language?: MeetingLanguage }): string {
  const lang = opts.language || "ko";
  // 헨젤 샘플 HTML을 베이스로 변수+섹션 치환. 외부 의존 0, 인라인 CSS·JS.
  // 본문 섹션은 샘플의 HTML 주석 마커(<!-- Decisions --> 등) 사이를 통째 교체한다.
  // 1순위: 커밋되는 경로(git 추적, 재유실 방지). 2순위: 디자이너 오버라이드(history/는 gitignore라 유실 가능).
  const committedTemplatePath = join(PROJECT_SELF_DIR, "config", "templates", "meeting-sample.html");
  const designerTemplatePath = join(HISTORY_DIR, "outputs", "designer", "meeting-html-sample.html");
  let template = "";
  try {
    template = readFileSync(committedTemplatePath, "utf-8");
  } catch {
    try {
      template = readFileSync(designerTemplatePath, "utf-8");
    } catch {
      // 디자이너 산출물(history/는 gitignore)이 사라지면 조용히 기본 폴백 HTML로 강등되던 문제 —
      // 2026-07-12 사용자 제보로 발견. 재발 시 즉시 로그로 드러나도록 경고 추가.
      console.warn(`[meetings] 디자인 템플릿 없음 (${committedTemplatePath}, ${designerTemplatePath}) — 기본 폴백 HTML 사용`);
      template = "";
    }
  }

  const e = escapeHtml;
  const title = e(payload.title || "회의록");
  const eyebrow = e(payload.eyebrow || payload.date || toKstDate());
  const subtitle = e(payload.subtitle || "");
  const date = e(payload.date || toKstDate());
  const time = e(payload.time || "");
  const duration = e(payload.duration || "");
  const location = e(payload.location || "");

  const attendeesHtml = (payload.attendees || [])
    .map((a) => `<strong>${e(a.name)}</strong>${a.role ? ` (${e(a.role)})` : ""}`)
    .join(" · ");

  const recordingDuration = e(payload.recordingDuration || duration || "");
  const transcriptLengthNum = payload.transcriptLength ?? payload.transcript?.length ?? 0;
  const transcriptLength = String(transcriptLengthNum);
  const transcriptDurationSec = payload.transcript?.duration ?? 0;

  const summaryHtml = payload.summary.map((s) => `<li>${e(s)}</li>`).join("\n          ");

  const decisionsCardsHtml = payload.decisions
    .map(
      (d, i) => `<article class="item-card done">
          <div class="card-head">
            <h3 class="card-title">${e(d.title)}</h3>
            <span class="state-badge done">결정</span>
          </div>
          <div class="card-cat">${e(d.id || `DEC-${String(i + 1).padStart(3, "0")}`)}</div>
          ${d.description ? `<p class="card-desc">${e(d.description)}</p>` : ""}
        </article>`,
    )
    .join("\n        ");

  const statusLabelMap: Record<string, string> = { done: "완료", progress: "진행중", ready: "대기", blocked: "블록" };
  const actionItemsCardsHtml = payload.actionItems
    .map((a, i) => {
      const status = a.status || "ready";
      const label = a.statusLabel || statusLabelMap[status] || "대기";
      const id = e(a.id || `AI-${String(i + 1).padStart(3, "0")}`);
      const checked = a.done ? "checked" : "";
      return `<article class="item-card action-item ${status}">
          <div class="card-head">
            <label class="checkbox"><input type="checkbox" ${checked}><span></span></label>
            <h3 class="card-title">${e(a.task)}</h3>
            <span class="state-badge ${status}">${e(label)}</span>
          </div>
          <div class="card-cat">${id}</div>
          <div class="action-meta">
            ${a.owner ? `<span class="owner">${e(a.owner)}</span>` : ""}
            ${a.dueDate ? `<span class="due">${e(a.dueDate)}</span>` : ""}
          </div>
          ${a.note ? `<p class="card-desc" style="margin-top:10px">${e(a.note)}</p>` : ""}
        </article>`;
    })
    .join("\n        ");

  const emptyCard = `<div style="color:var(--text-muted);font-size:13px;padding:12px 4px">(없음)</div>`;

  const summarySectionBody = `
      <h2 class="section-title" id="summary">
        <span class="num">i.</span> 3줄 요약
      </h2>
      <section class="summary-box" aria-labelledby="summary">
        <div class="label">CORE TAKEAWAYS</div>
        <ol>
          ${summaryHtml}
        </ol>
      </section>

      `;

  const decisionsSectionBody = `
      <h2 class="section-title" id="decisions">
        <span class="num">ii.</span> 핵심 결정사항 <span class="count">${payload.decisions.length} items</span>
      </h2>
      <div class="cards-grid">
        ${decisionsCardsHtml || emptyCard}
      </div>

      `;

  const actionItemsSectionBody = `
      <h2 class="section-title" id="actions">
        <span class="num">iii.</span> 액션 아이템 <span class="count">${payload.actionItems.length} items</span>
      </h2>
      <div class="cards-grid">
        ${actionItemsCardsHtml || emptyCard}
      </div>

      `;

  const tDurationLabel = transcriptDurationSec
    ? ` · 약 ${Math.max(1, Math.round(transcriptDurationSec / 60))}분`
    : (recordingDuration ? ` · ${recordingDuration}` : "");
  const tBody = payload.transcript?.body
    ? `<p>${e(payload.transcript.body)}</p>`
    : `<p style="color:var(--text-muted)">(전사 결과 없음)</p>`;
  const transcriptSectionBody = `
      <h2 class="section-title" id="transcript">
        <span class="num">iv.</span> 전체 전사
      </h2>
      <details class="transcript-card">
        <summary>
          <span class="t-label">발화별 전사 보기</span>
          <span class="t-meta">${transcriptLength}자${tDurationLabel}</span>
        </summary>
        <div class="transcript-body">
          ${tBody}
        </div>
      </details>

      `;

  if (template) {
    const replaceBetween = (html: string, start: string, end: string, body: string): string => {
      const s = html.indexOf(start);
      if (s === -1) return html;
      const after = s + start.length;
      const eIdx = html.indexOf(end, after);
      if (eIdx === -1) return html;
      return html.slice(0, after) + body + html.slice(eIdx);
    };

    let out = template;
    out = replaceBetween(out, "<!-- 3-line Summary -->", "<!-- Decisions -->", summarySectionBody);
    out = replaceBetween(out, "<!-- Decisions -->", "<!-- Action Items -->", decisionsSectionBody);
    out = replaceBetween(out, "<!-- Action Items -->", "<!-- Transcript -->", actionItemsSectionBody);
    out = replaceBetween(out, "<!-- Transcript -->", "<!-- Footer -->", transcriptSectionBody);

    const attendeesDd = attendeesHtml || `<span style="color:var(--text-muted)">(참석자 정보 없음)</span>`;
    out = out.replace(
      /(<dt>참석<\/dt>\s*<dd>)[\s\S]*?(<\/dd>)/,
      () => `<dt>참석</dt>\n          <dd>${attendeesDd}</dd>`,
    );

    out = out
      .replace(/\{\{meeting\.title\}\}/g, title)
      .replace(/\{\{meeting\.eyebrow\}\}/g, eyebrow)
      .replace(/\{\{meeting\.subtitle\}\}/g, subtitle || "")
      .replace(/\{\{meeting\.date\}\}/g, date)
      .replace(/\{\{meeting\.time\}\}/g, time)
      .replace(/\{\{meeting\.duration\}\}/g, duration)
      .replace(/\{\{meeting\.location\}\}/g, location)
      .replace(/\{\{meeting\.recordingDuration\}\}/g, recordingDuration)
      .replace(/\{\{meeting\.transcriptLength\}\}/g, transcriptLength)
      .replace(/\{\{meeting\.id\}\}/g, opts.token.slice(0, 8))
      .replace(/\{\{meeting\.fullToken\}\}/g, e(opts.token))
      .replace(/\{\{meeting\.shareUrl\}\}/g, e(opts.shareUrl));
    return injectMeetingP1(out);
  }

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.65}</style>
</head><body>
<h1>${title}</h1>
<p>${eyebrow} · ${duration}</p>
<h2>요약</h2><ul>${summaryHtml}</ul>
<h2>결정 사항</h2>${decisionsCardsHtml || "<p>(없음)</p>"}
<h2>액션 아이템</h2>${actionItemsCardsHtml || "<p>(없음)</p>"}
${payload.transcript?.body ? `<div>${e(payload.transcript.body)}</div>` : ""}
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────
// 서버 사이드 Groq STT + 요약 직접 처리 (planner-researcher 권한 한계 우회용 핫픽스 2026-05-22)
// planner-researcher 어댑터는 allowedTools=WebSearch/WebFetch/Agent 만 가지고 bashCommands가 없어
// multipart 파일 업로드(Groq Whisper)·curl·node 실행이 불가능. v3.1 Q1 결정 실행 불가.
// → 서버 사이드 fetch로 Groq Whisper-large-v3 + LLaMA-3.3-70B 직접 호출.
//   planner-researcher 위임 흐름은 routes.ts에 그대로 남아있지만, 본 함수가 먼저 status=ready로 마킹.
// ──────────────────────────────────────────────────────────────────────────

interface GroqWhisperSegment { start?: number; end?: number; text?: string }
interface GroqWhisperResponse { text?: string; segments?: GroqWhisperSegment[] }
interface GroqSummary {
  shortSummary?: string;
  keyPoints?: string[];
  decisions?: string[];
  actionItems?: { task?: string; assignee?: string; due?: string }[];
  keywords?: string[];
}

const GROQ_WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const GROQ_WHISPER_CHUNK_BYTES = 20 * 1024 * 1024; // 20MB per chunk (safe margin)

function getAudioDuration(audioPath: string): number {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    return parseFloat(out.trim()) || 0;
  } catch (err) {
    throw new Error(`ffprobe failed (install via: brew install ffmpeg): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function callGroqWhisperSingle(audioPath: string, apiKey: string, language: MeetingLanguage = "ko", vocabHint?: string): Promise<GroqWhisperResponse> {
  const ext = (audioPath.split(".").pop() || "webm").toLowerCase();
  const mimeMap: Record<string, string> = {
    webm: "audio/webm", wav: "audio/wav", mp3: "audio/mpeg",
    m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg",
  };
  const mime = mimeMap[ext] || "audio/webm";
  const fileBuf = readFileSync(audioPath);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(fileBuf)], { type: mime });
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-large-v3");
  form.append("language", language);
  form.append("response_format", "verbose_json");
  // 고유명사(에이전트 이름) 오인식 방지용 어휘 힌트 — Whisper prompt 파라미터.
  if (vocabHint) form.append("prompt", vocabHint);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq Whisper ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as GroqWhisperResponse;
}

// Jarvis 음성 뷰(voice.ts)용 얇은 래퍼 — 단일 파일(25MB 이하 가정) Groq Whisper 전사만 필요하므로
// 청크 분할이 포함된 callGroqWhisper 대신 callGroqWhisperSingle을 그대로 노출한다.
// 호출자는 GROQ_API_KEY 존재 여부와 checkGroqQuota를 직접 확인한 뒤 사용해야 한다.
export async function transcribeFileGroq(audioPath: string, language: string = "ko", vocabHint?: string): Promise<{ text: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");
  const lang = (language as MeetingLanguage) || "ko";
  const result = await callGroqWhisperSingle(audioPath, apiKey, lang, vocabHint);
  return { text: (result.text || "").trim() };
}

async function callGroqWhisper(audioPath: string, apiKey: string, language: MeetingLanguage = "ko"): Promise<GroqWhisperResponse> {
  const stats = statSync(audioPath);
  if (stats.size <= GROQ_WHISPER_MAX_BYTES) {
    return callGroqWhisperSingle(audioPath, apiKey, language);
  }

  // 25MB 초과 → ffmpeg 청크 분할
  const duration = getAudioDuration(audioPath);
  if (duration <= 0) throw new Error("audio duration <= 0 (corrupt file or ffprobe failure)");
  const numChunks = Math.ceil(stats.size / GROQ_WHISPER_CHUNK_BYTES);
  const chunkDuration = duration / numChunks;
  const ext = (audioPath.split(".").pop() || "webm").toLowerCase();
  const tmpDir = join(tmpdir(), `groq-whisper-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const chunkPaths: string[] = [];
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkDuration;
      const chunkPath = join(tmpDir, `chunk_${String(i).padStart(3, "0")}.${ext}`);
      execSync(
        `ffmpeg -y -v error -ss ${start.toFixed(3)} -t ${chunkDuration.toFixed(3)} -i "${audioPath}" -c copy "${chunkPath}"`,
        { timeout: 60000 },
      );
      chunkPaths.push(chunkPath);
    }

    const allSegments: GroqWhisperSegment[] = [];
    const allTexts: string[] = [];
    let timeOffset = 0;

    for (let i = 0; i < chunkPaths.length; i++) {
      const resp = await callGroqWhisperSingle(chunkPaths[i], apiKey, language);
      if (resp.text) allTexts.push(resp.text.trim());
      if (resp.segments) {
        for (const seg of resp.segments) {
          allSegments.push({
            start: (seg.start ?? 0) + timeOffset,
            end: (seg.end ?? 0) + timeOffset,
            text: seg.text,
          });
        }
      }
      timeOffset += chunkDuration;
    }

    return { text: allTexts.join("\n"), segments: allSegments };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* cleanup failure — ignore */ }
  }
}

// CLI 답변에서 JSON만 추출(코드펜스·주변 텍스트 허용).
function parseSummaryJson(text: string): GroqSummary {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as GroqSummary;
}

// 언어별 요약 프롬프트 지침 + 시스템 프롬프트. JSON 스키마 필드명은 언어와 무관하게 고정(코드 계약).
const SUMMARY_INSTRUCTION: Record<MeetingLanguage, string> = {
  ko: "다음은 한국어 회의 녹취록입니다. 회의록을 아래 JSON 스키마로만 출력하세요 (다른 설명 없이 순수 JSON만, 모든 문자열 값은 한국어로 작성).",
  en: "The following is a meeting transcript. Output the meeting minutes strictly as the JSON schema below (JSON only, no extra text; write all string values in English).",
  ja: "以下は会議の書き起こしです。会議録を下記のJSONスキーマのみで出力してください(他の説明なしに純粋なJSONのみ、すべての文字列値は日本語で記述してください)。",
};

const SUMMARY_SYSTEM_PROMPT: Record<MeetingLanguage, string> = {
  ko: "당신은 회의록 요약 전문 어시스턴트입니다. 항상 유효한 JSON만 출력합니다.",
  en: "You are an expert meeting-minutes summarization assistant. Always output valid JSON only.",
  ja: "あなたは会議録要約の専門アシスタントです。常に有効なJSONのみを出力します。",
};

const SUMMARY_SCHEMA_HINT: Record<MeetingLanguage, string> = {
  ko: `{
  "shortSummary": "회의 전체를 2-3문장으로 요약한 문자열",
  "keyPoints": ["주요 논의 사항 1", "주요 논의 사항 2", "..."],
  "decisions": ["결정 사항 1", "결정 사항 2", "..."],
  "actionItems": [{"task": "할 일", "assignee": "담당자 또는 빈 문자열", "due": "기한 또는 빈 문자열"}],
  "keywords": ["키워드1", "키워드2", "..."]
}`,
  en: `{
  "shortSummary": "a 2-3 sentence summary of the whole meeting",
  "keyPoints": ["key discussion point 1", "key discussion point 2", "..."],
  "decisions": ["decision 1", "decision 2", "..."],
  "actionItems": [{"task": "task description", "assignee": "owner name or empty string", "due": "due date or empty string"}],
  "keywords": ["keyword1", "keyword2", "..."]
}`,
  ja: `{
  "shortSummary": "会議全体を2〜3文で要約した文字列",
  "keyPoints": ["主要な議論事項1", "主要な議論事項2", "..."],
  "decisions": ["決定事項1", "決定事項2", "..."],
  "actionItems": [{"task": "タスク内容", "assignee": "担当者名または空文字列", "due": "期限または空文字列"}],
  "keywords": ["キーワード1", "キーワード2", "..."]
}`,
};

// 회의록 요약을 호스트 AI 게이트웨이(Claude 구독·비용집계 일원화)로 생성.
// 기존 Groq LLaMA(유료 클라우드) 대체 — STT는 여전히 Groq Whisper 사용(오디오는 게이트웨이 미지원).
async function summarizeViaGateway(transcript: string, language: MeetingLanguage = "ko"): Promise<GroqSummary> {
  const prompt = `${SUMMARY_INSTRUCTION[language]}

${SUMMARY_SCHEMA_HINT[language]}

녹취록:
"""
${transcript.slice(0, 60000)}
"""`;

  const r = await runGatewayClaude({
    prompt,
    systemPrompt: SUMMARY_SYSTEM_PROMPT[language],
    timeoutMs: 180_000,
  });
  logCost("app:meetings", undefined, {
    costUsd: r.costUsd ?? 0,
    inputTokens: r.usage?.inputTokens ?? 0,
    outputTokens: r.usage?.outputTokens ?? 0,
    cacheReadTokens: r.usage?.cacheReadTokens ?? 0,
    cacheCreateTokens: r.usage?.cacheCreateTokens ?? 0,
    durationMs: r.durationMs ?? 0,
  }, "app:meetings:summary");
  return parseSummaryJson(r.text);
}

function markMeetingFailed(token: string, errorMessage: string): void {
  const meta = readMeetingMeta(token);
  if (!meta) return;
  meta.status = "failed";
  meta.errorMessage = errorMessage.slice(0, 1000);
  meta.completedAt = new Date().toISOString();
  saveMeetingMeta(meta);
}

// Groq Whisper(무료 티어 한도 내) 1순위 → 한도 초과/429/에러 시 로컬 whisper.cpp(@mycrew/whisper-local,
// apps/mymovie와 공유하는 공용 모듈) 2순위로 자동 폴백. 실패 시 Error throw — 호출자(processMeetingInBackground)가
// markMeetingFailed 처리.
async function transcribeWithFallback(
  token: string,
  recordingPath: string,
  language: MeetingLanguage = "ko",
): Promise<{ transcript: string; engine: "groq" | "gemini" | "local" }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey) {
    let estimatedAudioSec = 0;
    try {
      estimatedAudioSec = getAudioDuration(recordingPath);
    } catch {
      estimatedAudioSec = 0; // 추정 실패 시 게이팅 없이 Groq 시도 (과잉 설계 금지)
    }
    const quota = checkGroqQuota(estimatedAudioSec);
    if (quota.ok) {
      try {
        const whisper = await callGroqWhisper(recordingPath, apiKey, language);
        recordGroqUsage(estimatedAudioSec);
        const transcript = (whisper.text || "").trim();
        if (transcript) return { transcript, engine: "groq" };
        console.warn(`[meetings] ${token} Groq 응답에 텍스트 없음 — 로컬 폴백 시도`);
      } catch (err) {
        const reason = isGroqRateLimitError(err) ? "rate limit" : "호출 실패";
        console.warn(`[meetings] ${token} Groq ${reason} — 로컬 폴백:`, err);
      }
    } else {
      console.log(`[meetings] ${token} Groq 무료 티어 한도 도달 (${quota.reason}) — 로컬 폴백`);
    }
  } else {
    console.log(`[meetings] ${token} GROQ_API_KEY 미설정 — 로컬 whisper.cpp 사용`);
  }

  // 2단 폴백: Gemini STT (voice-stt 공용 클라이언트 재사용) — Groq 불가 시 로컬(느림) 전에 받는다.
  if (process.env.GEMINI_API_KEY) {
    try {
      const gtext = (await transcribeWithGemini(recordingPath, language)).trim();
      if (gtext) return { transcript: gtext, engine: "gemini" };
      console.warn(`[meetings] ${token} Gemini 응답에 텍스트 없음 — 로컬 폴백`);
    } catch (err) {
      console.warn(`[meetings] ${token} Gemini 호출 실패 — 로컬 폴백:`, err);
    }
  }
  const local = await transcribeLocal(recordingPath, { tmpDir: join(tmpdir(), "meetings-whisper"), language });
  return { transcript: local.text.trim(), engine: "local" };
}

export async function processMeetingInBackground(
  token: string,
  recordingPath: string,
  title: string,
): Promise<void> {
  try {
    const existing = readMeetingMeta(token);
    if (existing?.status === "ready") {
      console.log(`[meetings] ${token} 이미 ready — 중복 처리 스킵`);
      return;
    }

    if (!(process.env.MEETING_MEMORY_URL && existing?.memoryJobId) && !existsSync(recordingPath)) {
      markMeetingFailed(token, `recording file not found: ${recordingPath}`);
      return;
    }

    if (process.env.MEETING_MEMORY_URL && existing) {
      if (existing.language && existing.language !== 'ko') {
        throw new Error('meeting_memory_korean_only');
      }
      const result = await processWithMeetingMemory({
        token, title, recordingPath,
        jobId: existing.memoryJobId,
        date: existing.createdAt.slice(0, 10),
        provider: existing.transcriptionProvider ?? 'groq',
        onQueued: id => {
          existing.memoryJobId = id;
          saveMeetingMeta(existing);
        },
      });
      await saveMeetingMemoryArtifacts(MEETINGS_DIR, token, result);
      const payload: MeetingPayload = {
        title,
        subtitle: '검수 전 초안',
        summary: [...result.summary.summary, ...(result.summary.reviewIssues ?? []).map(issue => '[확인 필요] ' + issue.message)],
        decisions: result.summary.summary.map(title => ({ title })),
        actionItems: result.summary.actions.map(action => ({
          task: action.task,
          owner: action.owner ?? undefined,
          dueDate: action.due ?? undefined,
        })),
        transcript: {
          body: result.transcript.map(segment =>
            '[' + segment.start + '–' + segment.end + 's] ' + segment.speaker + ': ' + segment.text,
          ).join('\n'),
        },
      };
      writeFileSync(join(MEETINGS_DIR, token + '.html'), renderMeetingHtml(payload, {
        token, shareUrl: existing.shareUrl, language: 'ko',
      }));
      saveMeetingMeta({
        ...existing,
        status: 'ready',
        completedAt: new Date().toISOString(),
        errorMessage: undefined,
        sttEngine: existing.transcriptionProvider ?? 'groq',
        shortSummary: result.summary.summary.join('\n'),
        actionItems: payload.actionItems,
      });
      return;
    }
    const language: MeetingLanguage = existing?.language || "ko";
    console.log(`[meetings] ${token} STT 시작 (${recordingPath}, lang=${language})`);
    const { transcript, engine } = await transcribeWithFallback(token, recordingPath, language);
    if (!transcript) {
      markMeetingFailed(token, "STT 응답에 텍스트 없음 (무음·노이즈·인식 실패 가능, Groq+로컬 모두 시도)");
      return;
    }

    console.log(`[meetings] ${token} 요약 시작 (게이트웨이, transcript=${transcript.length}자)`);
    const summary = await summarizeViaGateway(transcript, language);

    const meta = readMeetingMeta(token);
    if (!meta) {
      console.warn(`[meetings] meta 사라짐: ${token}`);
      return;
    }

    const keyPoints = (summary.keyPoints || []).filter(Boolean);
    const decisions = (summary.decisions || []).filter(Boolean);
    const actionItems = (summary.actionItems || []).filter((a) => a?.task);
    const shortSummary = (summary.shortSummary || "").trim();

    const summaryThree = (keyPoints.length >= 3
      ? keyPoints.slice(0, 3)
      : [shortSummary, ...keyPoints].filter(Boolean).slice(0, 3));

    const payload: MeetingPayload = {
      title,
      eyebrow: meta.createdAt.slice(0, 10),
      subtitle: shortSummary,
      date: meta.createdAt.slice(0, 10),
      duration: meta.durationSec ? `${Math.round(meta.durationSec / 60)}분` : "",
      summary: summaryThree.length > 0 ? summaryThree : ["(요약 생성 실패)"],
      decisions: decisions.map((d) => ({ title: d })),
      actionItems: actionItems.map((a) => ({
        task: a.task!,
        owner: a.assignee || undefined,
        dueDate: a.due || undefined,
        status: "ready" as const,
      })),
      transcript: { body: transcript, length: transcript.length },
    };
    const html = renderMeetingHtml(payload, { token, shareUrl: meta.shareUrl, language });
    const htmlPath = join(MEETINGS_DIR, `${token}.html`);
    writeFileSync(htmlPath, html);

    meta.status = "ready";
    meta.completedAt = new Date().toISOString();
    meta.sttEngine = engine;
    // 크로스앱 연결용 구조화 데이터 저장(할일 전송 등에서 재사용).
    meta.shortSummary = shortSummary;
    meta.actionItems = payload.actionItems.map((a) => ({ task: a.task, owner: a.owner, dueDate: a.dueDate }));
    saveMeetingMeta(meta);
    console.log(`[meetings] ${token} ready ✓`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[meetings] ${token} 처리 실패:`, msg);
    markMeetingFailed(token, msg);
  }
}

// 크로스앱: 회의 액션 아이템을 마이크루 할일(todos)로 전송한다.
export function meetingActionsToTodos(token: string): { ok: boolean; created: number; error?: string } {
  const meta = readMeetingMeta(token);
  if (!meta) return { ok: false, created: 0, error: "meeting not found" };
  const items = meta.actionItems ?? [];
  if (items.length === 0) return { ok: true, created: 0 };
  let created = 0;
  for (const a of items) {
    const parts = [a.task];
    if (a.owner) parts.push(`(담당: ${a.owner})`);
    if (a.dueDate) parts.push(`(기한: ${a.dueDate})`);
    try {
      addTodo("meeting", `[회의: ${meta.title}] ${parts.join(" ")}`);
      created++;
    } catch { /* 개별 실패는 건너뛰고 계속 */ }
  }
  return { ok: true, created };
}

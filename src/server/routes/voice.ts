// Jarvis 음성 뷰 서버 라우트 — TTS(Supertonic sidecar)/STT(Groq Whisper)/채팅 프록시.
// src/client는 별도 에이전트가 동시 작업 중이므로 이 파일은 절대 건드리지 않는다.
import { Hono } from "hono";
import type { Context } from "hono";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { HISTORY_DIR } from "../../config.js";
import { getVoiceProfile, listVoiceProfiles, type VoiceProfile } from "../voice-profiles.js";
import { sendMessage } from "../chat.js";
import { checkGroqQuota, recordGroqUsage, isGroqRateLimitError } from "../groq-usage.js";
import { transcribeAudio, availableSttEngines, sttEngineOrder } from "../voice-stt.js";
import { normalizeForSpeech } from "../speech-normalize.js";

export const voiceRoutes = new Hono();

const SUPERTONIC_URL = process.env.SUPERTONIC_URL || "http://127.0.0.1:7788";
const VOICE_CACHE_DIR = join(HISTORY_DIR, "voice-cache");
const VOICE_TMP_DIR = join(HISTORY_DIR, "voice-tmp");
const TEXT_MAX_CHARS = 600;
const FALLBACK_VOICE = "M1";

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── 음성 합성용 텍스트 정제 ──────────────────────────────────────────────
function sanitizeForSpeech(raw: string): string {
  let text = raw;
  // 코드펜스 → 안내 문구로 치환
  text = text.replace(/```[\s\S]*?```/g, "코드는 화면에 표시했습니다.");
  // HTML 주석 제거
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // URL 제거
  text = text.replace(/https?:\/\/\S+/g, "");
  // 인라인 코드/굵게/헤더 마크다운 기호 제거
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/\*\*([^*]*)\*\*/g, "$1");
  text = text.replace(/^#{1,6}\s*/gm, "");
  // 한국어 발음 정규화 — 숫자·버전·단위·기호 오독 방지 (speech-normalize.ts, 왕복 실측 기반)
  text = normalizeForSpeech(text);
  // 이모지 제거 (기본 이모지 유니코드 범위)
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");
  // 공백 정리
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > TEXT_MAX_CHARS) text = text.slice(0, TEXT_MAX_CHARS);
  return text;
}

function cacheKeyFor(agentId: string, voice: string, speed: number, text: string): string {
  const hash = createHash("sha1").update(`${agentId}|${voice}|${speed}|${text}`).digest("hex");
  return `${hash}.wav`;
}

async function synthesizeWithSupertonic(
  text: string,
  voice: string,
  speed: number,
  lang: string,
): Promise<Response> {
  return fetch(`${SUPERTONIC_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "supertonic-3",
      input: text,
      voice,
      lang,
      response_format: "wav",
      speed,
    }),
  });
}

// GET /api/voice/health
voiceRoutes.get("/health", async (c: Context) => {
  let tts = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${SUPERTONIC_URL}/v1/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    tts = res.ok;
  } catch {
    tts = false;
  }
  const engines = availableSttEngines();
  return c.json({ tts, stt: engines.length > 0, sttEngines: sttEngineOrder() });
});

// GET /api/voice/agents
voiceRoutes.get("/agents", (c: Context) => {
  return c.json(listVoiceProfiles());
});

// POST /api/voice/tts
voiceRoutes.post("/tts", async (c: Context) => {
  const body = await c.req.json<{ agentId?: string; text?: string; kind?: string }>().catch(() => ({}) as { agentId?: string; text?: string; kind?: string });
  const agentId = body.agentId?.trim();
  const rawText = body.text?.trim();
  if (!agentId || !rawText) {
    return c.json({ error: "agentId and text required" }, 400);
  }

  const text = sanitizeForSpeech(rawText);
  if (!text) {
    return c.json({ error: "tts_unavailable" }, 503);
  }

  const profile: VoiceProfile = getVoiceProfile(agentId);
  const speed = profile.speed ?? 1.0;
  ensureDir(VOICE_CACHE_DIR);
  const cacheFile = join(VOICE_CACHE_DIR, cacheKeyFor(agentId, profile.voice, speed, text));

  if (existsSync(cacheFile)) {
    const buf = readFileSync(cacheFile);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "audio/wav", "X-Voice-Cache": "hit" },
    });
  }

  try {
    let res = await synthesizeWithSupertonic(text, profile.voice, speed, profile.lang);
    let fallbackApplied = false;
    if (!res.ok && res.status >= 400 && res.status < 500 && profile.voice !== FALLBACK_VOICE) {
      // 커스텀 스타일 미등록 등 4xx → 프리셋 M1로 1회 폴백 재시도
      res = await synthesizeWithSupertonic(text, FALLBACK_VOICE, speed, profile.lang);
      fallbackApplied = true;
    }
    if (!res.ok) {
      return c.json({ error: "tts_unavailable" }, 503);
    }
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    writeFileSync(cacheFile, buf);
    const headers: Record<string, string> = { "Content-Type": "audio/wav", "X-Voice-Cache": "miss" };
    if (fallbackApplied) headers["X-Voice-Fallback"] = FALLBACK_VOICE;
    return new Response(new Uint8Array(buf), { status: 200, headers });
  } catch (err) {
    console.error("[voice/tts] sidecar 호출 실패:", err);
    return c.json({ error: "tts_unavailable" }, 503);
  }
});

// POST /api/voice/stt (multipart/form-data, field: audio)
voiceRoutes.post("/stt", async (c: Context) => {
  if (availableSttEngines().length === 0) {
    return c.json({ error: "stt_unavailable" }, 503);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return c.json({ error: "audio field required" }, 400);
  }

  ensureDir(VOICE_TMP_DIR);
  const ext = (audio.type.split("/")[1] || "webm").split(";")[0];
  const tmpPath = join(VOICE_TMP_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);

  try {
    const arrayBuf = await audio.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    writeFileSync(tmpPath, buf);

    const estimatedSec = Math.max(1, Math.round(buf.byteLength / 16000)); // 대략치, 게이팅용
    // Groq 쿼터 초과 시에도 Gemini 폴백은 가능하므로 여기서 막지 않고 엔진 순서만 조정한다.
    const groqQuotaOk = checkGroqQuota(estimatedSec).ok;
    if (!groqQuotaOk && !process.env.GEMINI_API_KEY) {
      return c.json({ error: "stt_unavailable" }, 503);
    }

    const result = await transcribeAudio(tmpPath, "ko");
    if (result.engine === "groq") recordGroqUsage(estimatedSec);
    return c.json({ text: result.text, engine: result.engine, ms: result.ms });
  } catch (err) {
    if (isGroqRateLimitError(err)) {
      return c.json({ error: "stt_unavailable" }, 503);
    }
    console.error("[voice/stt] 전사 실패:", err);
    return c.json({ error: "stt_unavailable" }, 503);
  } finally {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch (cleanupErr) {
      console.error("[voice/stt] 임시파일 삭제 실패:", cleanupErr);
    }
  }
});

// POST /api/voice/chat — routes.ts의 POST /api/chat과 동일한 위임 경로를 음성 UI 전용으로 노출.
voiceRoutes.post("/chat", async (c: Context) => {
  const body = await c.req.json<{ text?: string; browserId?: string }>().catch(() => ({}) as { text?: string; browserId?: string });
  const message = body.text?.trim();
  if (!message) {
    return c.json({ error: "text required" }, 400);
  }
  try {
    const reply = await sendMessage(message, undefined, body.browserId);
    return c.json(reply);
  } catch (err) {
    if (err instanceof Error && err.message === "genie_queued") {
      const pendingId = (err as Error & { pendingId?: string }).pendingId ?? "";
      return c.json({
        id: pendingId,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
        pending: true,
        queued: true,
      });
    }
    throw err;
  }
});

// Jarvis 음성 뷰 — STT 엔진 추상화.
// 기본 Groq(whisper-large-v3, 최단 지연) → 실패/미설정 시 Gemini Flash 폴백.
// 두 엔진 모두 사내 에이전트 이름을 어휘 힌트로 받아 고유명사 오인식을 막는다.
// (힌트 없으면 "마이크루"가 "마이크로"로 전사되어 라우팅이 깨진다 — 2026-08-24 실측)
import { readFileSync } from "node:fs";
import { getAllWorkerAgents } from "../agent-registry.js";
import { getGenieName } from "./chat.js";
import { transcribeFileGroq } from "./meetings.js";

export type SttEngine = "groq" | "gemini";

export interface SttResult {
  text: string;
  engine: SttEngine;
  ms: number;
}

const GEMINI_MODEL = process.env.VOICE_STT_GEMINI_MODEL || "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// 에이전트 이름 목록 — 어휘 힌트용. 레지스트리가 바뀌어도 자동으로 따라간다.
let vocabCache: { at: number; value: string } | null = null;
export function agentVocabulary(): string {
  if (vocabCache && Date.now() - vocabCache.at < 60_000) return vocabCache.value;
  const names = new Set<string>();
  try {
    const genie = getGenieName();
    if (genie && genie !== "MyCrew") names.add(genie);
  } catch {
    /* 온보딩 전이면 무시 */
  }
  try {
    for (const a of getAllWorkerAgents()) {
      if (a.name) names.add(a.name);
    }
  } catch {
    /* 레지스트리 실패 시 기본 이름만 사용 */
  }
  const value = Array.from(names).join(", ");
  vocabCache = { at: Date.now(), value };
  return value;
}

export function availableSttEngines(): SttEngine[] {
  const out: SttEngine[] = [];
  if (process.env.GROQ_API_KEY) out.push("groq");
  if (process.env.GEMINI_API_KEY) out.push("gemini");
  return out;
}

function mimeForExt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "webm";
  const map: Record<string, string> = {
    webm: "audio/webm", wav: "audio/wav", mp3: "audio/mp3",
    m4a: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
  };
  return map[ext] || "audio/webm";
}

export async function transcribeWithGemini(path: string, language = "ko"): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 미설정");
  const b64 = readFileSync(path).toString("base64");
  const prompt =
    `다음은 사내 AI 에이전트 이름 목록입니다(정확히 이 표기를 사용): ${agentVocabulary()}.\n` +
    `이 오디오를 ${language === "ko" ? "한국어" : language}로 정확히 전사하세요. ` +
    `전사한 문장만 출력하고 설명·따옴표·머리말은 붙이지 마세요.`;

  const res = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeForExt(path), data: b64 } }] }],
      generationConfig: { temperature: 0 },
    }),
  });
  const json = (await res.json()) as {
    error?: { code?: number; message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (json.error) throw new Error(`Gemini ${json.error.code}: ${json.error.message?.slice(0, 120)}`);
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini 응답에 전사 텍스트 없음");
  return text;
}

// 엔진 순서: VOICE_STT_ENGINE 지정값 우선 → 나머지 사용 가능한 엔진으로 폴백.
export function sttEngineOrder(): SttEngine[] {
  const available = availableSttEngines();
  const preferred = process.env.VOICE_STT_ENGINE as SttEngine | undefined;
  if (preferred && available.includes(preferred)) {
    return [preferred, ...available.filter((e) => e !== preferred)];
  }
  return available;
}

export async function transcribeAudio(path: string, language = "ko"): Promise<SttResult> {
  const order = sttEngineOrder();
  if (order.length === 0) throw new Error("사용 가능한 STT 엔진 없음");
  let lastErr: unknown = null;
  for (const engine of order) {
    const started = Date.now();
    try {
      const text =
        engine === "groq"
          ? (await transcribeFileGroq(path, language, agentVocabulary())).text
          : await transcribeWithGemini(path, language);
      return { text, engine, ms: Date.now() - started };
    } catch (err) {
      lastErr = err;
      console.warn(`[voice/stt] ${engine} 실패 → 폴백 시도:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr ?? new Error("모든 STT 엔진 실패");
}

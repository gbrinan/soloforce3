// Groq Whisper 무료 티어 사용량 추적/게이팅.
// 디스크에 영속화(재시작에도 유지)해 RPM/RPD/시간당·일일 오디오초 한도를 넘기 전에 로컬 폴백을 유도한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

const USAGE_FILE = join(HISTORY_DIR, "groq-stt-usage.json");

// https://console.groq.com/docs/rate-limits (whisper-large-v3, free tier)
export const GROQ_FREE_TIER_LIMITS = {
  rpm: 20,
  rpd: 2000,
  ashSec: 7200, // audio-seconds / hour
  asdSec: 28800, // audio-seconds / day
};

interface UsageEntry {
  ts: number; // epoch ms
  audioSec: number;
}

function loadUsage(): UsageEntry[] {
  if (!existsSync(USAGE_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(USAGE_FILE, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveUsage(entries: UsageEntry[]): void {
  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(USAGE_FILE, JSON.stringify(entries));
}

function pruneOld(entries: UsageEntry[], now: number): UsageEntry[] {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return entries.filter((e) => e.ts >= cutoff);
}

export interface GroqQuotaCheck {
  ok: boolean;
  reason?: string;
}

/** 추정 오디오 길이(초) 기준 Groq 무료 티어 한도 초과 여부 사전 검사. */
export function checkGroqQuota(estimatedAudioSec: number): GroqQuotaCheck {
  const now = Date.now();
  const entries = pruneOld(loadUsage(), now);

  const lastMinute = entries.filter((e) => now - e.ts < 60_000);
  if (lastMinute.length >= GROQ_FREE_TIER_LIMITS.rpm) {
    return { ok: false, reason: `RPM 한도 초과 (${lastMinute.length}/${GROQ_FREE_TIER_LIMITS.rpm})` };
  }
  if (entries.length >= GROQ_FREE_TIER_LIMITS.rpd) {
    return { ok: false, reason: `RPD 한도 초과 (${entries.length}/${GROQ_FREE_TIER_LIMITS.rpd})` };
  }

  const lastHour = entries.filter((e) => now - e.ts < 60 * 60_000);
  const hourAudioSec = lastHour.reduce((s, e) => s + e.audioSec, 0);
  if (hourAudioSec + estimatedAudioSec > GROQ_FREE_TIER_LIMITS.ashSec) {
    return {
      ok: false,
      reason: `시간당 오디오 한도 초과 (${Math.round(hourAudioSec)}+${Math.round(estimatedAudioSec)}/${GROQ_FREE_TIER_LIMITS.ashSec}초)`,
    };
  }

  const dayAudioSec = entries.reduce((s, e) => s + e.audioSec, 0);
  if (dayAudioSec + estimatedAudioSec > GROQ_FREE_TIER_LIMITS.asdSec) {
    return {
      ok: false,
      reason: `일일 오디오 한도 초과 (${Math.round(dayAudioSec)}+${Math.round(estimatedAudioSec)}/${GROQ_FREE_TIER_LIMITS.asdSec}초)`,
    };
  }

  return { ok: true };
}

/** Groq 호출 성공 후 사용량 기록. */
export function recordGroqUsage(audioSec: number): void {
  const now = Date.now();
  const entries = pruneOld(loadUsage(), now);
  entries.push({ ts: now, audioSec: Math.max(0, audioSec) });
  saveUsage(entries);
}

/** Groq 에러가 429/rate-limit 성격인지 판별 (callGroqWhisper*가 던지는 Error 메시지 파싱). */
export function isGroqRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b/.test(msg) || /rate.?limit/i.test(msg);
}

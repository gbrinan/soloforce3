// POST /api/tts
// Body: { text: string, voice?: string }
// → macOS `say`(무료 로컬 TTS)로 aiff 생성 → afconvert로 m4a 변환 → 저장 경로 반환.
// 유료 TTS API 미사용. 기본 보이스는 한국어 Yuna.

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { uploadsDir } from "@/lib/core/paths";
import { TMP_DIR } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

const SAY_BIN = "/usr/bin/say";
const AFCONVERT_BIN = "/usr/bin/afconvert";
const TTS_DIR = resolve(uploadsDir(), "tts");
const DEFAULT_VOICE = "Yuna";
const MAX_TEXT_CHARS = 5000;
const EXEC_TIMEOUT_MS = 180_000;
// Voice names are plain identifiers ("Yuna", "Samantha (Enhanced)").
const VOICE_RE = /^[A-Za-z0-9 ()_.-]{1,64}$/;

interface TtsBody {
  text?: string;
  voice?: string;
}

/** ffprobe로 오디오 길이(ms) 조회 — 실패 시 0 (best-effort). */
async function probeAudioDurationMs(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", path],
      { timeout: 30_000 },
    );
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    const sec = Number(parsed.format?.duration ?? "0");
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 0;
  } catch {
    return 0;
  }
}

async function cleanupQuiet(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((p) =>
      unlink(p).catch(() => {
        /* best-effort cleanup */
      }),
    ),
  );
}

export async function POST(req: Request) {
  let body: TtsBody;
  try {
    body = (await req.json()) as TtsBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { ok: false, error: `text too long (max ${MAX_TEXT_CHARS} chars)` },
      { status: 400 },
    );
  }
  const voice = body.voice?.trim() || DEFAULT_VOICE;
  if (!VOICE_RE.test(voice)) {
    return NextResponse.json({ ok: false, error: "invalid voice name" }, { status: 400 });
  }

  const id = randomUUID();
  const scriptPath = resolve(TMP_DIR, `tts_${id}.txt`);
  const aiffPath = resolve(TMP_DIR, `tts_${id}.aiff`);
  const m4aPath = resolve(TTS_DIR, `${id}.m4a`);

  try {
    await mkdir(TMP_DIR, { recursive: true });
    await mkdir(TTS_DIR, { recursive: true });
    // Script goes through a file (-f) so leading "-" in user text can't be
    // parsed as a say flag.
    await writeFile(scriptPath, text, "utf8");
    await execFileAsync(SAY_BIN, ["-v", voice, "-o", aiffPath, "-f", scriptPath], {
      timeout: EXEC_TIMEOUT_MS,
    });
    await execFileAsync(AFCONVERT_BIN, ["-f", "m4af", "-d", "aac", aiffPath, m4aPath], {
      timeout: EXEC_TIMEOUT_MS,
    });
    const durationMs = await probeAudioDurationMs(m4aPath);
    await cleanupQuiet([scriptPath, aiffPath]);
    return NextResponse.json({ ok: true, path: m4aPath, voice, durationMs });
  } catch (e) {
    await cleanupQuiet([scriptPath, aiffPath, m4aPath]);
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    const detail = err.stderr?.trim() || err.message || String(e);
    const msg = err.killed
      ? `TTS timed out after ${EXEC_TIMEOUT_MS / 1000}s`
      : `TTS 실패: ${detail.slice(0, 300)}`;
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

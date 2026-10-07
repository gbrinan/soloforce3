import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { uploadsDir } from "@/lib/core/paths";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BGM_DIR = resolve(uploadsDir(), "bgm");
const ALLOWED_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const MAX_BYTES = 100 * 1024 * 1024; // 100MB

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `multipart parse 실패: ${(err as Error).message}` },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "file 필드가 없습니다" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "오디오 파일은 100MB 이하여야 합니다" }, { status: 400 });
  }
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      { ok: false, error: `지원하지 않는 오디오 포맷입니다 (허용: ${Array.from(ALLOWED_EXT).join(", ")})` },
      { status: 400 },
    );
  }

  try {
    await mkdir(BGM_DIR, { recursive: true });
  } catch {}
  const savedPath = resolve(BGM_DIR, `${randomUUID()}${ext}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(savedPath, buf);

  return NextResponse.json({ ok: true, path: savedPath, name: file.name });
}

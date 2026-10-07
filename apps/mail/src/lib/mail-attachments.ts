import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const BASE = join(homedir(), ".config", "mycrew", "mail-attachments");

export const ATTACHMENT_ID_RE = /^[0-9a-f-]{36}$/i;

function sanitize(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/[^\w.\-가-힣 ()]/g, "_").slice(0, 200) || "file";
}

export interface StoredAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

export async function saveAttachment(buf: Buffer, name: string, mimeType: string): Promise<StoredAttachment> {
  const id = randomUUID();
  const dir = join(BASE, id);
  await mkdir(dir, { recursive: true });
  const safe = sanitize(name);
  await writeFile(join(dir, safe), buf);
  return { id, name: safe, size: buf.length, mimeType };
}

export async function readAttachment(id: string): Promise<{ buffer: Buffer; name: string } | null> {
  if (!ATTACHMENT_ID_RE.test(id)) return null;
  const dir = join(BASE, id);
  try {
    const files = await readdir(dir);
    if (files.length === 0) return null;
    const name = files[0];
    const buffer = await readFile(join(dir, name));
    return { buffer, name };
  } catch {
    return null;
  }
}

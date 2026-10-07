import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

export function parseCodexSessionModel(content: string): string | null {
  let model: string | null = null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const payload = record.payload as Record<string, unknown> | undefined;
      if (record.type === "turn_context" && typeof payload?.model === "string" && payload.model.trim()) {
        model = payload.model.trim();
      }
    } catch {
      // 손상된 JSONL 레코드는 건너뛴다.
    }
  }
  return model;
}

function collectJsonl(directory: string, output: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true }) as Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectJsonl(path, output);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(path);
  }
}

function mtime(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

export function findLatestCodexSessionModel(sessionDirectory: string): string | null {
  const files: string[] = [];
  collectJsonl(sessionDirectory, files);
  files.sort((a, b) => mtime(b) - mtime(a));
  for (const file of files) {
    try {
      const model = parseCodexSessionModel(readFileSync(file, "utf-8"));
      if (model) return model;
    } catch {
      // 읽을 수 없는 세션은 다음 파일로 넘어간다.
    }
  }
  return null;
}

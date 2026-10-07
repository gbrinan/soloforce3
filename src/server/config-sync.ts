import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, extname, relative, dirname } from "node:path";
import { createRequire } from "node:module";

// node-diff3 is CJS-only; load via createRequire to bypass ESM type resolution
const _require = createRequire(import.meta.url);
type Diff3Region<T> =
  | { ok: T[] }
  | { conflict: { a: T[]; aIndex: number; o: T[]; oIndex: number; b: T[]; bIndex: number } };
const { diff3Merge } = _require("node-diff3") as {
  diff3Merge: <T>(
    a: T[],
    o: T[],
    b: T[],
    options?: { excludeFalseConflicts?: boolean }
  ) => Diff3Region<T>[];
};

// ── Types ─────────────────────────────────────────────────────────────────

export type SyncConflict = {
  file: string;
  base: string;
  incoming: string;
  working: string;
  diffPreview: string;
};

export type SyncResult = {
  autoApplied: Array<{ file: string }>;
  conflicts: SyncConflict[];
  skipped: Array<{ file: string; reason: string }>;
};

// ── Paths ─────────────────────────────────────────────────────────────────

const CONFIG_DIR = resolve(".", "config");
const BASELINE_DIR = join(CONFIG_DIR, ".baseline");
const INCOMING_DIR = join(CONFIG_DIR, ".incoming");

const TEXT_EXTS = new Set([".md", ".txt", ".yml", ".yaml"]);
const JSON_EXTS = new Set([".json"]);

// ── 14-A: Baseline 초기화 ─────────────────────────────────────────────────

export function ensureBaseline(): void {
  if (existsSync(BASELINE_DIR)) return;
  mkdirSync(BASELINE_DIR, { recursive: true });
  _copyDir(CONFIG_DIR, BASELINE_DIR);
}

function _copyDir(src: string, dest: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (_isExcluded(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      _copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

function _isExcluded(name: string): boolean {
  return name === ".baseline" || name === ".incoming" || name === "external-agents.json";
}

// ── 14-B: 텍스트 3-way merge ─────────────────────────────────────────────

export function mergeText(
  base: string,
  incoming: string,
  working: string
): { merged: string; conflicts: boolean } {
  const regions = diff3Merge(working.split("\n"), base.split("\n"), incoming.split("\n"), {
    excludeFalseConflicts: true,
  });
  const lines: string[] = [];
  let conflicts = false;
  for (const region of regions) {
    if ("ok" in region) {
      lines.push(...region.ok);
    } else {
      conflicts = true;
      lines.push(
        "<<<<<<< working",
        ...region.conflict.a,
        "=======",
        ...region.conflict.b,
        ">>>>>>> incoming"
      );
    }
  }
  return { merged: lines.join("\n"), conflicts };
}

// ── 14-C: JSON 재귀 비교 ─────────────────────────────────────────────────

export function mergeJson(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  working: Record<string, unknown>
): { merged: Record<string, unknown>; conflicts: string[] } {
  const conflicts: string[] = [];
  const merged = _mergeJsonRec(base, incoming, working, "", conflicts);
  return { merged, conflicts };
}

function _mergeJsonRec(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  working: Record<string, unknown>,
  path: string,
  conflicts: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...working };
  const allKeys = new Set([
    ...Object.keys(base),
    ...Object.keys(incoming),
    ...Object.keys(working),
  ]);

  for (const key of allKeys) {
    const kPath = path ? `${path}.${key}` : key;
    const bv = base[key];
    const iv = incoming[key];
    const wv = working[key];
    const bSer = JSON.stringify(bv);
    const iSer = JSON.stringify(iv);
    const wSer = JSON.stringify(wv);

    if (!(key in base) && key in incoming) {
      result[key] = iv; // 신규 씨앗 키 → 자동 추가
      continue;
    }
    if (key in base && !(key in incoming)) {
      if (wSer === bSer) delete result[key]; // 씨앗 삭제 + working 미수정 → 삭제 반영
      continue;
    }
    if (iSer === bSer) continue; // incoming 변경 없음
    if (wSer === bSer) {
      result[key] = iv; // 사용자 수정 없음 → incoming 자동 적용
      continue;
    }
    if (wSer === iSer) continue; // 이미 동일
    if (_isPObj(bv) && _isPObj(iv) && _isPObj(wv)) {
      result[key] = _mergeJsonRec(
        bv as Record<string, unknown>,
        iv as Record<string, unknown>,
        wv as Record<string, unknown>,
        kPath,
        conflicts
      );
    } else {
      conflicts.push(kPath); // 충돌 — working 값 유지 (spread에서 이미 할당됨)
    }
  }
  return result;
}

function _isPObj(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── 14-D: Diff 계산 (read-only) ──────────────────────────────────────────

export function computeDiff(incomingDir?: string): SyncResult {
  ensureBaseline();
  const effIncoming = incomingDir ?? BASELINE_DIR;
  const result: SyncResult = { autoApplied: [], conflicts: [], skipped: [] };

  _walkFiles(effIncoming, (relPath) => {
    const baseFile = join(BASELINE_DIR, relPath);
    const incomingFile = join(effIncoming, relPath);
    const workingFile = join(CONFIG_DIR, relPath);

    if (!existsSync(incomingFile)) return;

    const incomingContent = readFileSync(incomingFile, "utf-8");

    if (!existsSync(baseFile)) {
      result.autoApplied.push({ file: relPath }); // 신규 씨앗 파일
      return;
    }

    const baseContent = readFileSync(baseFile, "utf-8");
    if (incomingContent === baseContent) return; // incoming 변경 없음

    if (!existsSync(workingFile)) {
      result.autoApplied.push({ file: relPath }); // working 없음 → 자동 추가
      return;
    }

    const workingContent = readFileSync(workingFile, "utf-8");
    if (workingContent === baseContent) {
      result.autoApplied.push({ file: relPath }); // 사용자 수정 없음
      return;
    }
    if (workingContent === incomingContent) return; // 이미 동일

    const ext = extname(relPath).toLowerCase();

    if (JSON_EXTS.has(ext)) {
      try {
        const { conflicts } = mergeJson(
          JSON.parse(baseContent) as Record<string, unknown>,
          JSON.parse(incomingContent) as Record<string, unknown>,
          JSON.parse(workingContent) as Record<string, unknown>
        );
        if (conflicts.length === 0) {
          result.autoApplied.push({ file: relPath });
        } else {
          result.conflicts.push({
            file: relPath,
            base: baseContent,
            incoming: incomingContent,
            working: workingContent,
            diffPreview: `JSON conflicts: ${conflicts.slice(0, 3).join(", ")}`,
          });
        }
      } catch {
        result.skipped.push({ file: relPath, reason: "JSON parse error" });
      }
    } else if (TEXT_EXTS.has(ext)) {
      const { merged, conflicts } = mergeText(baseContent, incomingContent, workingContent);
      if (!conflicts) {
        result.autoApplied.push({ file: relPath });
      } else {
        const preview = merged
          .split("\n")
          .filter((l) => l.startsWith("<<<<<<<") || l.startsWith("=======") || l.startsWith(">>>>>>>"))
          .slice(0, 4)
          .join("\n");
        result.conflicts.push({
          file: relPath,
          base: baseContent,
          incoming: incomingContent,
          working: workingContent,
          diffPreview: preview,
        });
      }
    } else {
      result.conflicts.push({
        file: relPath,
        base: baseContent,
        incoming: incomingContent,
        working: workingContent,
        diffPreview: "(binary/unknown format)",
      });
    }
  });

  // baseline에 있지만 incoming에서 삭제된 씨앗 파일 알림
  _walkFiles(BASELINE_DIR, (relPath) => {
    if (!existsSync(join(effIncoming, relPath))) {
      result.skipped.push({ file: relPath, reason: "removed in incoming (manual review needed)" });
    }
  });

  return result;
}

// ── 14-F: 자동 적용 + 롤백 ──────────────────────────────────────────────

export function applyAutoMergeable(syncResult: SyncResult, incomingDir?: string): void {
  const effIncoming = incomingDir ?? INCOMING_DIR;
  if (!existsSync(effIncoming)) return;

  // 원래 base 스냅샷 보존 (3-way merge용 — 백업보다 먼저 읽어야 함)
  const baseSnap = new Map<string, string>();
  for (const item of syncResult.autoApplied) {
    const p = join(BASELINE_DIR, item.file);
    if (existsSync(p)) baseSnap.set(item.file, readFileSync(p, "utf-8"));
  }

  // 백업: 현재 config/ → baseline/ (롤백 포인트)
  _copyDir(CONFIG_DIR, BASELINE_DIR);

  for (const item of syncResult.autoApplied) {
    const incomingFile = join(effIncoming, item.file);
    const workingFile = join(CONFIG_DIR, item.file);
    if (!existsSync(incomingFile)) continue;

    const incomingContent = readFileSync(incomingFile, "utf-8");
    const baseContent = baseSnap.get(item.file);

    if (!baseContent || !existsSync(workingFile)) {
      mkdirSync(dirname(workingFile), { recursive: true });
      writeFileSync(workingFile, incomingContent);
      continue;
    }

    const workingContent = readFileSync(workingFile, "utf-8");
    if (workingContent === baseContent) {
      writeFileSync(workingFile, incomingContent);
      continue;
    }

    const ext = extname(item.file).toLowerCase();
    if (JSON_EXTS.has(ext)) {
      try {
        const { merged } = mergeJson(
          JSON.parse(baseContent) as Record<string, unknown>,
          JSON.parse(incomingContent) as Record<string, unknown>,
          JSON.parse(workingContent) as Record<string, unknown>
        );
        writeFileSync(workingFile, JSON.stringify(merged, null, 2));
      } catch {
        writeFileSync(workingFile, incomingContent);
      }
    } else if (TEXT_EXTS.has(ext)) {
      const { merged } = mergeText(baseContent, incomingContent, workingContent);
      writeFileSync(workingFile, merged);
    } else {
      writeFileSync(workingFile, incomingContent);
    }
  }
}

export function applyUserChoice(
  choices: { acceptIncoming: string[]; keepWorking: string[] },
  incomingDir?: string
): void {
  const effIncoming = incomingDir ?? INCOMING_DIR;
  if (!existsSync(effIncoming)) return;
  _copyDir(CONFIG_DIR, BASELINE_DIR); // 백업
  for (const relPath of choices.acceptIncoming) {
    const src = join(effIncoming, relPath);
    const dest = join(CONFIG_DIR, relPath);
    if (existsSync(src)) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(src));
    }
  }
  // keepWorking → no action needed (user version already in config/)
}

export function rollback(): void {
  if (!existsSync(BASELINE_DIR)) return;
  _copyDir(BASELINE_DIR, CONFIG_DIR);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function _walkFiles(dir: string, cb: (relPath: string) => void, base = dir): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (_isExcluded(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      _walkFiles(fullPath, cb, base);
    } else if (entry.isFile()) {
      cb(relative(base, fullPath));
    }
  }
}

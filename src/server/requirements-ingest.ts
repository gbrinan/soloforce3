// 요구사항 자동 인제스트 — 결정적(deterministic) 스캔·중복 판정·정산 (SPEC R12)
//
// 이 파일이 하는 일은 "무엇을 처리해야 하는가"를 계산하는 것뿐이다. 실제 정규화(요구사항 md 작성)는
// 에이전트가 한다. 규칙은 config/guides/corpus-gates.md(공통 게이트)와 ingest-pitfalls.md(함정)에
// 있고 여기 다시 적지 않는다 — 두 곳에 두면 갈라진다.
//
// 여기에만 있는 것: raw/ 파일의 중복·판본 판정과 정산 산식.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { atomicWriteFileSync } from "./utils/atomic-write.js";
import { nfc } from "./utils/path-normalize.js";
import { PROJECTS_DIR, HISTORY_DIR } from "../config.js";

export type IngestState = "new" | "unchanged" | "revised" | "superseded" | "skipped";

export interface IngestEntry {
  file: string;          // raw/ 기준 상대경로 (NFC 정규화)
  hash: string;          // sha256 (콘텐츠)
  size: number;
  mtime: string;
  series: string;        // 판본 계열 키 (날짜·버전 접미사를 뺀 이름)
  state: IngestState;
  basisDate: string;     // 판본 비교 기준일 (파일명 날짜 우선, 없으면 수정시각)
  basisFrom: "파일명" | "수정시각";
  supersededBy?: string; // superseded일 때 유효 판본 파일명
  reason?: string;       // skipped 사유
  ingestedAt?: string;   // 정규화 완료 기록(에이전트가 갱신)
}

export interface IngestManifest {
  version: 1;
  project: string;
  updatedAt: string;
  entries: IngestEntry[];
}

const MANIFEST = "_ingest-manifest.json";
const RAW_DIR = join("10-requirements", "raw");
// 원본이 아닌 것: 삭제 보관함과 OS 부산물. 삭제는 물리삭제 대신 _deleted/ 이동이라 스캔에서 뺀다.
const EXCLUDE_DIRS = new Set(["_deleted"]);
const EXCLUDE_FILES = new Set(["thumbs.db", ".ds_store"]);

// NFD/NFC 정규화(구 nfc())는 ./utils/path-normalize.ts로 공용화됨(ingest-pitfalls #5).
// qa-auto-judge의 산출물 실존 해석과 같은 단일 소스를 쓴다.

/**
 * 판본 계열 키. 같은 문서의 다른 판본(날짜·버전 접미사만 다른 것)을 한 계열로 묶는다.
 * 예) 2026-08-03_요구사항.txt / 2026-08-10_요구사항.txt → 계열 "요구사항"
 *     과정개요서_v1.pdf / 과정개요서_v2.pdf           → 계열 "과정개요서"
 */
export function seriesKey(fileName: string): string {
  let s = nfc(basename(fileName, extname(fileName)));
  s = s.replace(/^\d{4}[-_.]?\d{2}[-_.]?\d{2}[-_ ]*/, "");   // 앞 날짜
  s = s.replace(/[-_ ]*\d{4}[-_.]?\d{2}[-_.]?\d{2}$/, "");   // 뒤 날짜
  s = s.replace(/[-_ ]*[vV]\d+(\.\d+)*$/, "");               // v1, v2.1
  s = s.replace(/[-_ ]*\(\d+\)$/, "");                       // (1) 사본
  s = s.replace(/[-_ ]*(최종|final|수정본|revised)$/i, "");
  return s.trim() || nfc(fileName);
}

/**
 * 판본 비교 기준일. 파일 mtime은 복사만 해도 갱신되므로 신뢰할 수 없다 —
 * 파일명에 담긴 날짜가 있으면 그것이 기준일이다(ingest-pitfalls #6: "기준일이 늦은 쪽을 유효로").
 */
export function basisDateOf(fileName: string, mtimeIso: string): { date: string; from: "파일명" | "수정시각" } {
  const m = nfc(basename(fileName)).match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`, from: "파일명" };
  return { date: mtimeIso, from: "수정시각" };
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function projectAbs(projectRel: string): string {
  return join(PROJECTS_DIR, projectRel);
}

export function loadManifest(projectRel: string): IngestManifest | null {
  const p = join(projectAbs(projectRel), "10-requirements", MANIFEST);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as IngestManifest;
  } catch {
    return null;   // 깨진 매니페스트는 없는 것으로 보고 재생성한다(원본이 진실).
  }
}

export function saveManifest(projectRel: string, m: IngestManifest): void {
  const primary = join(projectAbs(projectRel), "10-requirements");
  const json = JSON.stringify(m, null, 2);
  try {
    mkdirSync(primary, { recursive: true });
    atomicWriteFileSync(join(primary, MANIFEST), json);
  } catch (err) {
    // 정규 경로가 writePaths/권한 밖이라 쓰기 실패 → 명시적 폴백 경로에 저장하고
    // 그 사실을 로그로 남긴다(조용한 유실 방지 — retrospective DENIED 재발 대응).
    const fallbackDir = join(HISTORY_DIR, "outputs", "_ingest-fallback", projectRel.replace(/[\\/]+/g, "_"));
    mkdirSync(fallbackDir, { recursive: true });
    const fp = join(fallbackDir, MANIFEST);
    atomicWriteFileSync(fp, json);
    console.warn(
      `[ingest] 매니페스트 정규 경로 저장 실패(${err instanceof Error ? err.message : String(err)}) → 폴백 저장: ${fp}`,
    );
  }
}

/**
 * raw/ 를 스캔해 각 원본의 처리 상태를 판정한다. 원본은 읽기만 한다.
 *
 * 판정:
 * - new        : 매니페스트에 없는 해시
 * - unchanged  : 같은 경로·같은 해시 (이미 처리됨)
 * - revised    : 같은 경로·다른 해시 (내용이 바뀜 → 재처리 필요)
 * - superseded : 같은 계열에 더 늦은 판본이 있음 (지우지 않고 표시만 — ingest-pitfalls #6)
 * - skipped    : 0바이트 등 읽을 것이 없는 파일
 */
export function scanRequirements(projectRel: string): {
  manifest: IngestManifest;
  reconciliation: { discovered: number; toProcess: number; notProcessed: number; balanced: boolean };
} {
  const rawAbs = join(projectAbs(projectRel), RAW_DIR);
  const prev = loadManifest(projectRel);
  const prevByFile = new Map((prev?.entries ?? []).map((e) => [e.file, e]));

  const found: IngestEntry[] = [];
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const name = nfc(d.name);
      if (name.startsWith(".")) continue;
      if (d.isDirectory()) {
        if (EXCLUDE_DIRS.has(name)) continue;
        walk(join(dir, d.name), rel ? `${rel}/${name}` : name);
        continue;
      }
      if (EXCLUDE_FILES.has(name.toLowerCase())) continue;
      const abs = join(dir, d.name);
      const st = statSync(abs);
      const relPath = rel ? `${rel}/${name}` : name;
      if (st.size === 0) {
        const b0 = basisDateOf(name, st.mtime.toISOString());
        found.push({ file: relPath, hash: "", size: 0, mtime: st.mtime.toISOString(), series: seriesKey(name), basisDate: b0.date, basisFrom: b0.from, state: "skipped", reason: "0바이트" });
        continue;
      }
      const hash = sha256(readFileSync(abs));
      const before = prevByFile.get(relPath);
      // 스캔에 잡혔다는 것과 정규화가 끝났다는 것은 다르다. ingestedAt이 없으면 아직 미처리다 —
      // 발견만으로 "처리됨"이 되면 조용히 빠진 파일이 생긴다(corpus-gates: 정산이 맞아야 끝난다).
      const state: IngestState = !before
        ? "new"
        : before.hash !== hash
          ? "revised"
          : before.ingestedAt ? "unchanged" : "new";
      const basis = basisDateOf(name, st.mtime.toISOString());
      found.push({
        file: relPath,
        hash,
        size: st.size,
        mtime: st.mtime.toISOString(),
        series: seriesKey(name),
        basisDate: basis.date,
        basisFrom: basis.from,
        state,
        ...(before?.ingestedAt && before.hash === hash ? { ingestedAt: before.ingestedAt } : {}),
      });
    }
  };
  walk(rawAbs, "");

  // (1) 완전 동일 내용의 사본을 먼저 접는다. 대표본은 파일명에 기준일이 있는 쪽 > 이름이 짧은 쪽.
  //     "(1)" 같은 사본이 mtime만 최신이라는 이유로 대표가 되지 않게 한다.
  const canonicalRank = (e: IngestEntry): [number, number, string] =>
    [e.basisFrom === "파일명" ? 0 : 1, e.file.length, e.file];
  const byHash = new Map<string, IngestEntry[]>();
  for (const e of found) {
    if (!e.hash || e.state === "skipped") continue;
    const arr = byHash.get(e.hash) ?? [];
    arr.push(e);
    byHash.set(e.hash, arr);
  }
  for (const [, arr] of byHash) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => {
      const [ra, la, fa] = canonicalRank(a);
      const [rb, lb, fb] = canonicalRank(b);
      return ra - rb || la - lb || fa.localeCompare(fb);
    });
    for (const e of sorted.slice(1)) {
      e.state = "superseded";
      e.supersededBy = sorted[0].file;
      e.reason = "동일 내용 사본";
    }
  }

  // (2) 계열별 판본 판정 — 기준일(파일명 날짜 우선)이 가장 늦은 것만 유효.
  //     mtime은 복사만 해도 갱신되므로 단독 기준으로 쓰지 않는다(ingest-pitfalls #6).
  const bySeries = new Map<string, IngestEntry[]>();
  for (const e of found) {
    if (e.state === "skipped" || e.state === "superseded") continue;
    const arr = bySeries.get(e.series) ?? [];
    arr.push(e);
    bySeries.set(e.series, arr);
  }
  for (const [, arr] of bySeries) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) =>
      b.basisDate.localeCompare(a.basisDate)
      || (a.basisFrom === "파일명" ? 0 : 1) - (b.basisFrom === "파일명" ? 0 : 1)
      || b.mtime.localeCompare(a.mtime));
    const valid = sorted[0];
    for (const e of sorted.slice(1)) {
      e.state = "superseded";
      e.supersededBy = valid.file;
    }
  }

  const manifest: IngestManifest = {
    version: 1,
    project: projectRel,
    updatedAt: new Date().toISOString(),
    entries: found.sort((a, b) => a.file.localeCompare(b.file)),
  };

  const toProcess = found.filter((e) => e.state === "new" || e.state === "revised").length;
  const notProcessed = found.length - toProcess;
  return {
    manifest,
    reconciliation: {
      discovered: found.length,
      toProcess,
      notProcessed,
      balanced: found.length === toProcess + notProcessed,
    },
  };
}

/**
 * 정규화가 끝난 원본에 완료 시각을 남긴다. 이 기록이 있어야 다음 스캔에서 unchanged로 빠진다.
 * 완료 보고는 에이전트가 하고, 기록은 서버가 한다 — 처리 주체와 판정 주체를 분리한다.
 */
export function markIngested(projectRel: string, files: string[]): { marked: string[]; unknown: string[] } {
  const m = loadManifest(projectRel);
  if (!m) return { marked: [], unknown: files };
  const at = new Date().toISOString();
  const marked: string[] = [];
  const unknown: string[] = [];
  const byFile = new Map(m.entries.map((e) => [e.file, e]));
  for (const f of files) {
    const e = byFile.get(f.normalize("NFC"));
    if (!e) { unknown.push(f); continue; }
    e.ingestedAt = at;
    marked.push(e.file);
  }
  if (marked.length) { m.updatedAt = at; saveManifest(projectRel, m); }
  return { marked, unknown };
}

/** 에이전트에게 넘길 작업 지시. 규칙은 가이드에 있고 여기서는 대상과 산출물만 지정한다. */
export function buildIngestRequest(projectRel: string, m: IngestManifest): string {
  const targets = m.entries.filter((e) => e.state === "new" || e.state === "revised");
  const skipped = m.entries.filter((e) => e.state !== "new" && e.state !== "revised");
  const lines = [
    `[요구사항 인제스트] 프로젝트: ${projectRel}`,
    ``,
    `먼저 SafeRead로 다음을 읽고 그 규칙을 따르세요: config/guides/corpus-gates.md, config/guides/ingest-pitfalls.md, config/guides/requirements-ingest.md`,
    ``,
    `처리 대상 ${targets.length}건 (10-requirements/raw/ 기준):`,
    ...targets.map((e) => `- ${e.file} (${e.state === "new" ? "신규" : "내용 변경"})`),
    ``,
    `처리하지 않는 것 ${skipped.length}건 — 정산에 그대로 세되 내용은 읽지 마세요:`,
    ...skipped.map((e) => `- ${e.file} (${e.state}${e.supersededBy ? ` → 유효본 ${e.supersededBy}` : ""}${e.reason ? `, ${e.reason}` : ""})`),
    ``,
    `산출물: 10-requirements/requirements.md 갱신, 10-requirements/_changelog.md에 변경 1줄 추가.`,
    `정산 보고: 발견 ${m.entries.length}건 = 처리 ${targets.length}건 + 미처리 ${skipped.length}건.`,
  ];
  return lines.join("\n");
}

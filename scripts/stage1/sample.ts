// Stage 1 표본 추출 — 사전 등록 규칙(docs/tool-use-redesign/findings.md «Stage 1 사전 등록»)대로 뽑는다.
//   npx tsx scripts/stage1/sample.ts --history <archive/jobs 폴더> --out <출력 폴더> [--n 30] [--seed 20261008] [--verify]
// 원문은 출력 폴더(리포 밖)에만 쓴다. 표준출력에는 집계와 표본 ID 해시만 낸다.
// --verify: 같은 규칙으로 다시 뽑아 기존 sample.json 의 해시와 비교한다(G10). 불일치면 종료 코드 1.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 레인으로 남는 에이전트 — 흡수 후보에서 뺀다(README «레인을 띄우는 기준»). */
export const LANE_AGENTS = new Set([
  "genie", "dev-pm", "backend-dev", "frontend-dev", "tester", "qa", "gpt-runner",
  "ingestiger", "ingest-crab", "corpus-keeper",
]);
/** 실시간 상태가 필요한 요청 — 과거 상태를 재현할 수 없어 자기완결 비교에서 뺀다. */
export const LIVE_STATE = /메일|gmail|노션|notion|캘린더|일정|카톡|카카오|발송|보내|리드|정산|장부|배송|드라이브|drive|슬랙/i;
/** 한 에이전트가 표본을 독식하지 않게 하는 상한(30건 기준 비율). */
export const PER_AGENT_CAP_RATIO = 0.4;
const SYSTEM_MARKER = "[시스템 지시]";

export interface Candidate { id: string; agent: string; request: string; result: string; createdAt: string }

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** 시드 고정 난수(mulberry32) — 같은 시드면 같은 순서. */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function isEligible(raw: Record<string, unknown>): Candidate | null {
  const request = String(raw.request ?? "").split(SYSTEM_MARKER)[0].trim();
  const agent = String(raw.agent ?? "");
  const result = String(raw.fullResult ?? "");
  if (!request || request.startsWith("[") || request.startsWith("**[")) return null; // 시스템 지시
  if (!agent || LANE_AGENTS.has(agent)) return null;
  if (LIVE_STATE.test(request)) return null;
  if (result.length < 200 || raw.status !== "completed") return null;
  if (request.includes("�") || result.includes("�")) return null; // 깨진 인코딩
  return { id: String(raw.id), agent, request, result, createdAt: String(raw.createdAt ?? "") };
}

export function loadCandidates(historyDir: string): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const day of readdirSync(historyDir).sort()) {
    const dir = path.join(historyDir, day);
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { continue; }
    for (const f of files) {
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(path.join(dir, f), "utf-8")); } catch { continue; }
      for (const raw of Array.isArray(parsed) ? parsed : [parsed]) {
        const c = raw && typeof raw === "object" ? isEligible(raw as Record<string, unknown>) : null;
        if (!c || seen.has(c.request)) continue; // 같은 요청 재시도는 한 번만
        seen.add(c.request);
        out.push(c);
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** 시드 셔플 후 에이전트별 상한을 지키며 n건을 고른다. 앞 k건이 파일럿이 되도록 순서를 보존한다. */
export function pickSample(cands: Candidate[], n: number, seed: number, capRatio = PER_AGENT_CAP_RATIO): Candidate[] {
  const r = rng(seed);
  const shuffled = [...cands];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const cap = Math.max(1, Math.floor(n * capRatio));
  const count = new Map<string, number>();
  const picked: Candidate[] = [];
  for (const c of shuffled) {
    if (picked.length >= n) break;
    const k = count.get(c.agent) ?? 0;
    if (k >= cap) continue;
    count.set(c.agent, k + 1);
    picked.push(c);
  }
  return picked;
}

/** 결과·프롬프트 파일 이름으로 쓸 수 있게 ID를 바꾼다(채팅 ID에는 «#»이 들어간다). */
export const fileId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "_");

export const sampleHash = (s: Candidate[]): string =>
  createHash("sha256").update(s.map((c) => c.id).join("\n")).digest("hex");

if (process.argv[1]?.endsWith("sample.ts")) {
  const historyDir = arg("--history");
  const outDir = arg("--out");
  const n = Number(arg("--n", "30"));
  const seed = Number(arg("--seed", "20261008"));
  if (!historyDir || !outDir || !existsSync(historyDir)) {
    console.error(`MISS: --history 폴더가 없습니다 (${historyDir ?? "미지정"})`);
    process.exit(2);
  }
  const cands = loadCandidates(historyDir);
  const sample = pickSample(cands, n, seed);
  const hash = sampleHash(sample);
  const file = path.join(outDir, "sample.json");
  if (process.argv.includes("--verify")) {
    const prev = JSON.parse(readFileSync(file, "utf-8")) as { hash: string };
    console.log(prev.hash === hash ? `VERIFY PASS ${hash}` : `VERIFY FAIL 기존 ${prev.hash} / 재생성 ${hash}`);
    process.exit(prev.hash === hash ? 0 : 1);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ seed, n, rule: "docs/tool-use-redesign/findings.md#stage-1-사전-등록", hash, cases: sample }, null, 2));
  const byAgent: Record<string, number> = {};
  for (const c of sample) byAgent[c.agent] = (byAgent[c.agent] ?? 0) + 1;
  console.log(`후보 ${cands.length}건 → 표본 ${sample.length}건 (seed ${seed})`);
  console.log(`에이전트별 ${JSON.stringify(byAgent)}`);
  console.log(`표본 ID sha256 ${hash}`);
}

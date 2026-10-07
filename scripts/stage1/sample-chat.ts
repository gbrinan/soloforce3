// Stage 1 (재설계) 표본 — 비교 단위 «아난이 채팅에 쓴 원문 → 아난이 받은 답».
//   npx tsx scripts/stage1/sample-chat.ts --conversations <history/conversations> --jobs <history/archive/jobs> --out <폴더> [--n 30] [--seed 20261008] [--verify]
// 원문 형식(chat.ts): «### [시각] 사용자 (pending?)» 블록이 아난, «### [시각] 무아 (internal?)» 블록이 genie. 시각은 KST.
// A(기존 답) = 다음 사용자 메시지 전까지 genie가 보낸 직접 답 + 완료 보고([REPORT]/[NOTIFY]로 시작하는 internal).
// 제외(하이브리드 설계에서 본체가 아니라 레인이 맡을 일 — 단일 에이전트 비교 대상이 아니다):
//   - 답 구간에 레인 에이전트(dev-pm·qa·인제스트 등) 잡이 실제로 생성된 메시지(잡 아카이브로 확인)
//   - 행동·변경 요청(배포·발송·설정 변경 등) — 읽기 전용 재실행으로 같은 일을 할 수 없다
// 원문은 --out(리포 밖)에만 쓴다.
import { gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LANE_AGENTS, pickSample, sampleHash, type Candidate } from "./sample.js";

export const ACTION_REQUEST = /배포|설치|발송|보내|전송|승인|머지|merge|재시작|삭제|지워|실행해|실행하자|켜줘|꺼줘|푸시|push|커밋|commit|결제|주문/i;
export const CHANGE_REQUEST = /(조정|변경|바꾸|바꿔|고치|고쳐|수정|추가|적용|설정|등록|구현|만들|반영)(하자|해줘|해 줘|해라|하고|해서|해)/;
export const MIN_MESSAGE_CHARS = 15;
const CONTEXT_TURNS = 4;
const CONTEXT_MAX = 4000;
const ANSWER_MAX = 8000;
const MAX_WINDOW_MS = 3 * 3600_000;

export interface Turn { speaker: "user" | "genie"; internal: boolean; at: number; text: string }
export type ChatCandidate = Candidate & { context: string; windowEnd: number };

/** «AM 12:40:51» + 날짜(KST) → epoch ms. 형식이 다르면 NaN. */
export function kstToEpoch(day: string, clock: string): number {
  const m = /^(AM|PM)\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(clock.trim());
  if (!m) return NaN;
  let h = Number(m[2]) % 12;
  if (m[1] === "PM") h += 12;
  return Date.parse(`${day}T${String(h).padStart(2, "0")}:${m[3]}:${m[4]}+09:00`);
}

export function parseConversation(raw: string, day: string): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const flush = () => { if (cur) { cur.text = cur.text.trim(); turns.push(cur); } cur = null; };
  for (const line of raw.split(/\r?\n/)) {
    const h = /^### \[([^\]]+)\] (사용자|무아)(?: \(([^)]*)\))?\s*$/.exec(line);
    if (h) {
      flush();
      cur = { speaker: h[2] === "사용자" ? "user" : "genie", internal: h[3] === "internal", at: kstToEpoch(day, h[1]), text: "" };
      continue;
    }
    if (/^## system \//.test(line)) { flush(); continue; } // 시스템 덤프는 대화가 아니다
    if (cur) cur.text += line + "\n";
  }
  flush();
  return turns;
}

const isCompletionReport = (t: Turn): boolean => t.internal && /^\s*\[(REPORT|NOTIFY)\]/.test(t.text);

export function buildChatCandidates(turns: Turn[], day: string): ChatCandidate[] {
  const out: ChatCandidate[] = [];
  turns.forEach((t, i) => {
    if (t.speaker !== "user" || Number.isNaN(t.at)) return;
    const msg = t.text.trim();
    if (msg.length < MIN_MESSAGE_CHARS || ACTION_REQUEST.test(msg) || CHANGE_REQUEST.test(msg)) return;
    const answer: string[] = [];
    let end = t.at + MAX_WINDOW_MS;
    for (let j = i + 1; j < turns.length; j++) {
      const g = turns[j];
      if (g.speaker === "user") { end = Math.min(end, g.at); break; }
      if (g.at > end) break;
      if (!g.internal || isCompletionReport(g)) answer.push(g.text);
    }
    const result = answer.join("\n\n---\n\n").slice(0, ANSWER_MAX);
    if (result.length < 200) return;
    const context = turns.slice(Math.max(0, i - CONTEXT_TURNS), i)
      .filter((p) => !p.internal)
      .map((p) => `${p.speaker === "user" ? "아난" : "비서"}: ${p.text}`)
      .join("\n\n").slice(-CONTEXT_MAX);
    out.push({ id: `${day}#${i}`, agent: "genie-chat", request: msg, result, createdAt: new Date(t.at).toISOString(), context, windowEnd: end });
  });
  return out;
}

/** 레인 에이전트 잡의 생성 시각(epoch ms) 목록. */
export function loadLaneJobTimes(jobsDir: string): number[] {
  const times: number[] = [];
  for (const day of readdirSync(jobsDir)) {
    const dir = path.join(jobsDir, day);
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { continue; }
    for (const f of files) {
      try {
        const parsed = JSON.parse(readFileSync(path.join(dir, f), "utf-8"));
        for (const j of Array.isArray(parsed) ? parsed : [parsed]) {
          if (j && LANE_AGENTS.has(String(j.agent)) && j.agent !== "genie") times.push(Date.parse(String(j.createdAt)));
        }
      } catch { /* 깨진 파일은 건너뛴다 */ }
    }
  }
  return times.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
}

export const hadLaneJob = (c: ChatCandidate, laneTimes: number[]): boolean => {
  const start = Date.parse(c.createdAt);
  return laneTimes.some((t) => t >= start && t < c.windowEnd);
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1]?.endsWith("sample-chat.ts")) {
  const convDir = arg("--conversations");
  const jobsDir = arg("--jobs");
  const outDir = arg("--out");
  const n = Number(arg("--n", "30"));
  const seed = Number(arg("--seed", "20261008"));
  if (!convDir || !jobsDir || !outDir || !existsSync(convDir) || !existsSync(jobsDir)) {
    console.error(`MISS: --conversations / --jobs 폴더가 필요합니다 (${convDir ?? "미지정"}, ${jobsDir ?? "미지정"})`);
    process.exit(2);
  }
  const laneTimes = loadLaneJobTimes(jobsDir);
  const all: ChatCandidate[] = [];
  let userMsgs = 0;
  for (const f of readdirSync(convDir).filter((x) => /\.md(\.gz)?$/.test(x)).sort()) {
    const buf = readFileSync(path.join(convDir, f));
    const raw = (f.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf-8");
    const day = f.replace(/\.md(\.gz)?$/, "");
    const turns = parseConversation(raw, day);
    userMsgs += turns.filter((t) => t.speaker === "user").length;
    all.push(...buildChatCandidates(turns, day));
  }
  const cands = all.filter((c) => !hadLaneJob(c, laneTimes));
  // 에이전트가 하나(genie-chat)라 에이전트별 상한은 의미가 없다(상한 비율 1)
  const sample = pickSample(cands, n, seed, 1);
  const hash = sampleHash(sample);
  const file = path.join(outDir, "sample.json");
  if (process.argv.includes("--verify")) {
    const prev = JSON.parse(readFileSync(file, "utf-8")) as { hash: string };
    console.log(prev.hash === hash ? `VERIFY PASS ${hash}` : `VERIFY FAIL 기존 ${prev.hash} / 재생성 ${hash}`);
    process.exit(prev.hash === hash ? 0 : 1);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ seed, n, unit: "chat", hash, cases: sample }, null, 2));
  console.log(`사용자 메시지 ${userMsgs}건 → 행동·변경 요청 제외 후 ${all.length}건 → 레인 잡 동반 제외 후 ${cands.length}건 → 표본 ${sample.length}건 (seed ${seed})`);
  console.log(`표본 ID sha256 ${hash}`);
}

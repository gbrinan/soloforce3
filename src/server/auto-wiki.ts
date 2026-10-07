/**
 * 자동 위키 갱신 — Job 완료 시 daily/<YYYY-MM-DD>.md에 한 줄 append.
 * OpenViking 자기 진화 패턴의 경량 구현. 기존 수동 <!--WIKI:...--> 흐름과 병행.
 *
 * 갱신 대상: history/agents/{agentId}/wiki/daily/{YYYY-MM-DD}.md
 *   - 보호 페이지(procedure_*, project_*, !* 등)와 충돌 없음. 인덱스 영향 0.
 *   - Librarian 정리 로직은 wiki/ 루트만 대상 → daily/ 안전.
 *
 * 가드:
 *   - job.agent 없거나 'genie'면 skip (직원만)
 *   - status가 completed/done이 아니면 skip
 *   - AUTO_WIKI_ENABLED=off면 전체 skip
 *   - fire-and-forget — Job 완료 흐름 절대 차단 안 함
 */
import { existsSync, mkdirSync, statSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { getWorkerAgent } from "../agent-registry.js";
import type { Job } from "../types.js";

const MAX_DAILY_BYTES = 50_000;
const LLM_MIN_RESULT_LEN = 1000;

function todayKst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function hhmmKst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(11, 16);
}

function shortAgentName(agentId: string): string {
  const def = getWorkerAgent(agentId);
  return def?.name ?? agentId;
}

function extractJobPreview(job: Job): string {
  const resultLine = job.logs?.find((l) => l.startsWith("[결과]"));
  if (resultLine) return resultLine.replace(/^\[결과\]\s*/, "").slice(0, 160);
  if (job.summary) return job.summary.slice(0, 160);
  if (job.fullResult) return job.fullResult.replace(/\s+/g, " ").slice(0, 160);
  const lastLog = job.logs?.slice(-1)[0] ?? "";
  return lastLog.replace(/^\[.*?\]\s*/, "").slice(0, 160);
}

function buildHeuristicLine(job: Job, agentName: string): string {
  const time = hhmmKst();
  const idShort = job.id.slice(0, 8);
  const req = job.request.replace(/\s+/g, " ").slice(0, 60);
  const preview = extractJobPreview(job).replace(/\s+/g, " ").slice(0, 120);
  return `- [${time}] ${idShort} · ${agentName} · ${req} → ${preview}`;
}

async function callGroqOneLiner(job: Job): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const result = (job.fullResult ?? job.content ?? "").trim();
  if (result.length < LLM_MIN_RESULT_LEN) return null;
  try {
    const prompt = `다음은 한국어 직원 작업 결과입니다. 위키 일일 로그에 남길 핵심 1줄(60자 이내, 마크다운 없이)로 요약하세요. 결과 본문만 출력.

요청: ${job.request.slice(0, 200)}

결과:
"""
${result.slice(0, 8000)}
"""`;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "한국어 위키 한 줄 요약 전문가. 출력은 본문 한 줄만." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 120,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return text.split("\n")[0].slice(0, 120);
  } catch {
    return null;
  }
}

export async function appendDailyWikiEntry(job: Job): Promise<void> {
  if (process.env.AUTO_WIKI_ENABLED === "off") return;
  const agent = job.agent;
  if (!agent || agent === "genie") return;
  if (job.status !== "completed" && job.status !== "done") return;

  const agentName = shortAgentName(agent);
  const dailyDir = join(HISTORY_DIR, "agents", agent, "wiki", "daily");
  try {
    if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
  } catch (err) {
    console.error("[AutoWiki] daily 디렉토리 생성 실패:", err);
    return;
  }
  const filePath = join(dailyDir, `${todayKst()}.md`);

  let header = "";
  if (!existsSync(filePath)) {
    header = `# ${agentName} ${todayKst()} 작업 로그\n\n자동 생성 — Job 완료 시 한 줄씩 누적.\n\n`;
  } else {
    try {
      const st = statSync(filePath);
      if (st.size > MAX_DAILY_BYTES) {
        console.warn(`[AutoWiki] ${filePath} 크기 초과(${st.size}B > ${MAX_DAILY_BYTES}B) — append skip`);
        return;
      }
    } catch { /* statSync 실패 시 무시하고 진행 */ }
  }

  const heuristic = buildHeuristicLine(job, agentName);
  const llmLine = await callGroqOneLiner(job);
  const body = llmLine ? `${heuristic}\n  - ${llmLine}\n` : `${heuristic}\n`;

  try {
    appendFileSync(filePath, header + body);
  } catch (err) {
    console.error("[AutoWiki] append 실패:", err);
  }
}

// 테스트·디버그용 헬퍼. 운영에서는 호출 안 됨.
export function _readDailyForTest(agent: string, date?: string): string | null {
  const d = date ?? todayKst();
  const p = join(HISTORY_DIR, "agents", agent, "wiki", "daily", `${d}.md`);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

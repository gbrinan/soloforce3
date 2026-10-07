/**
 * worker-questions.ts — 워커가 작업 중 막혔을 때의 질문 escalation (#13).
 *
 * 흐름:
 *   워커 ask 툴 → createWorkerQuestion
 *     → (a) 마이크루 자문 (sendMessage, 의견 or '모름')
 *     → (b) 대화창에 ❓ 카드 주입 (addGenieMessage)
 *   → 마스터가 카드로 답하거나, 윈도우(genie-config workerQuestionWindowSec, 기본 3분) 초과 시:
 *       마이크루 의견 있으면 그대로 적용 / 마이크루도 '모름'이면 워커 자체 판단 안내.
 *   ask 툴이 /api/worker-questions/:id 를 폴링해 답을 받아간다.
 *
 * 영속화 없음 — 서버 재시작 시 워커의 ask 폴링이 실패하면 워커가 자체 판단(무한 대기 X).
 */
import { randomUUID } from "node:crypto";
import { getWorkerAgent } from "../agent-registry.js";
import { getWorkerQuestionWindowSec } from "../agents/genie.js";
import { isOwnerAway } from "./approvals.js";

export interface WorkerQuestion {
  id: string;
  agentId: string;
  question: string;
  options: string[];
  createdAt: number;
  status: "pending" | "answered";
  answer?: string;
  answerSource?: "user" | "genie" | "worker-judge";
  genieOpinion?: string;
}

const questions = new Map<string, WorkerQuestion>();

export function createWorkerQuestion(agentId: string, question: string, options: string[]): WorkerQuestion {
  const q: WorkerQuestion = {
    id: randomUUID(),
    agentId,
    question,
    options,
    createdAt: Date.now(),
    status: "pending",
  };
  questions.set(q.id, q);
  const name = getWorkerAgent(agentId)?.name ?? agentId;
  console.log(`[WorkerQ] ${name} 질문 ${q.id.slice(0, 8)}: ${question.slice(0, 50)}`);

  // 대화창에 질문 카드 주입 (ChatBubble이 qid로 WorkerQuestionCard 렌더)
  const optList = options.length ? "\n" + options.map((o, i) => `  ${i + 1}. ${o}`).join("\n") : "";
  import("./chat.js").then((chat) => {
    chat.addGenieMessage(`❓ [워커 질문] ${name}가 작업 중 막혀 질문했습니다.\n\n${question}${optList}\n\n(qid: ${q.id})`, { internal: true });
  }).catch(() => { /* */ });

  // 마이크루 자문 (비동기 — 실패/지연돼도 타임아웃 폴백)
  consultGenie(q, name).catch((e) => console.error("[WorkerQ] 마이크루 자문 실패:", e instanceof Error ? e.message : e));

  // 윈도우 만료 시 자동 해소
  setTimeout(() => resolveOnTimeout(q.id), getWorkerQuestionWindowSec() * 1000);
  return q;
}

async function consultGenie(q: WorkerQuestion, name: string): Promise<void> {
  const optList = q.options.length ? "\n선택지: " + q.options.map((o, i) => `${i + 1}) ${o}`).join("  ") : "";
  const prompt = `[워커 질문 자문] ${name} 워커가 작업 중 막혀 질문했습니다:\n"${q.question}"${optList}\n\n워커에게 전달할 의견을 한 줄로 제시하세요. 판단이 어려우면 '모름'이라고만 답하세요.`;
  const chat = await import("./chat.js");
  const reply = await chat.sendMessage(prompt, undefined, undefined, { internal: true, source: "worker-question" });
  const opinion = (reply?.content ?? "").trim();
  const qq = questions.get(q.id);
  if (!qq || qq.status !== "pending") return;
  if (opinion) {
    qq.genieOpinion = opinion;
    console.log(`[WorkerQ] ${q.id.slice(0, 8)} 마이크루 의견: ${opinion.slice(0, 60)}`);
  }
  // 부재중이면 마이크루 의견 즉시 적용 (3분 대기 불필요) — approvals.ts ownerAway 패턴
  if (isOwnerAway()) resolveOnTimeout(q.id);
}

export function answerWorkerQuestion(id: string, answer: string, source: WorkerQuestion["answerSource"]): boolean {
  const q = questions.get(id);
  if (!q || q.status !== "pending") return false;
  q.status = "answered";
  q.answer = answer;
  q.answerSource = source;
  console.log(`[WorkerQ] ${id.slice(0, 8)} 해소 (${source}): ${(answer ?? "").slice(0, 50)}`);
  return true;
}

/** 윈도우 만료 — 마스터 무응답 시 마이크루 의견대로, 마이크루도 모르면 워커 자체 판단. */
function resolveOnTimeout(id: string): void {
  const q = questions.get(id);
  if (!q || q.status !== "pending") return;
  const op = (q.genieOpinion ?? "").trim();
  if (op && !/^모름|^모르/.test(op)) {
    answerWorkerQuestion(id, `[마이크루 의견] ${op}`, "genie");
  } else {
    answerWorkerQuestion(id, "(마스터·마이크루 모두 결정하지 못했습니다 — 본인 판단으로 진행하세요.)", "worker-judge");
  }
}

export function getWorkerQuestion(id: string): WorkerQuestion | null {
  return questions.get(id) ?? null;
}

export function getPendingWorkerQuestions(): WorkerQuestion[] {
  return [...questions.values()].filter((q) => q.status === "pending");
}

// answered 질문 메모리 정리 (30분 후)
setInterval(() => {
  const now = Date.now();
  for (const [id, q] of questions) {
    if (q.status === "answered" && now - q.createdAt > 30 * 60 * 1000) questions.delete(id);
  }
}, 5 * 60 * 1000);

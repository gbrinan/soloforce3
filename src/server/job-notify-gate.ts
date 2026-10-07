// job-notify 게이팅 — 잡 완료마다 지니(Opus)에게 무조건 알리던 기존 흐름의 토큰 낭비를 줄이기 위한 저비용 사전 필터.
//
// 배경: "할 일 없으면 응답하지 마세요"라는 지시를 따르기 위해서도 지니는 풀 턴(캐시 재작성 포함,
// 실측 ~$1+/턴)을 소비한다. 실패/승인/TODO 연계 등 "항상 알려야 하는" 케이스를 제외하면,
// 나머지 다수의 사소한 성공 잡은 이 비용을 감수할 가치가 없다.
//
// 설계 원칙 (fail-safe):
// - 항상-알림 목록(failed/outputs_missing/TODO-linked/approval-gated/에러 키워드)은 필터를 절대 거치지 않는다.
// - 휴리스틱이 애매하면(짧은 성공 결과 등) 무료 티어 분류기(Gemini Flash, telegram-triage.ts와 동일 클라이언트) 호출을 시도한다.
// - 분류기가 없거나(GEMINI_API_KEY 미설정) 실패하면 항상 "알림"으로 fail-safe (침묵으로 fail-safe 금지).
// - 이 모듈은 순수 로직 + 네트워크 호출만 담당. Job 타입/스토어(jobs.ts)에 대한 의존은 최소화(구조적 타입으로 받음).

import { callGeminiFlash, isTriageEnabled } from "./telegram-triage.js";
// type-only import — 런타임 의존 없음(위 "스토어 의존 최소화" 원칙 유지).
import type { JobStatus } from "../types.js";

/** processCallback에서 넘겨주는 최소 정보 — Job 전체 대신 게이팅에 필요한 필드만 구조적으로 정의. */
export interface JobNotifyGateInput {
  jobId: string;
  status: "completed" | "failed" | "outputs_missing";
  agent?: string;
  /** 사용자에게 이미 보여준(또는 보여줄) 요약 텍스트. 휴리스틱/분류기 판단 대상. */
  summary: string;
  /** 이 job이 어떤 TODO에 연결되어 있는지 (getTodosByJobId(jobId).length > 0). */
  isTodoLinked: boolean;
  /** 이 job이 승인(approval) 체인을 거쳤는지 (hasApprovalHistory(jobId)). */
  isApprovalGated: boolean;
}

export type JobNotifyDecisionReason =
  | "always:failed"
  | "always:outputs_missing"
  | "always:todo-linked"
  | "always:approval-gated"
  | "always:error-keyword"
  | "always:empty-or-short-output"
  | "heuristic:trivial-success"
  | "classifier:notify"
  | "classifier:skip"
  | "classifier:unavailable-failsafe-notify"
  | "classifier:error-failsafe-notify";

export interface JobNotifyDecision {
  notify: boolean;
  reason: JobNotifyDecisionReason;
}

// "주의가 필요함"을 시사하는 흔한 키워드 — 성공(completed) 잡이어도 이 키워드가 보이면 무조건 알림.
const ATTENTION_KEYWORDS = [
  "실패", "오류", "에러", "확인 필요", "문제", "차단", "불가", "경고",
  "error", "fail", "exception", "timeout", "블록", "거부",
];

// 이 길이 미만의 성공 결과는 "사소한 성공"으로 간주해 휴리스틱 스킵 후보로 취급.
const TRIVIAL_SUCCESS_MAX_LEN = 40;
// 이 길이 이상이면 분류기 호출 없이 "알림" (내용이 실질적이라고 간주).
const SUBSTANTIAL_SUCCESS_MIN_LEN = 200;

/**
 * 항상-알림 조건을 검사한다. 하나라도 해당하면 즉시 결정을 반환(분류기 호출 없음).
 */
function checkAlwaysNotify(input: JobNotifyGateInput): JobNotifyDecision | null {
  if (input.status === "failed") return { notify: true, reason: "always:failed" };
  if (input.status === "outputs_missing") return { notify: true, reason: "always:outputs_missing" };
  if (input.isTodoLinked) return { notify: true, reason: "always:todo-linked" };
  if (input.isApprovalGated) return { notify: true, reason: "always:approval-gated" };

  const lower = input.summary.toLowerCase();
  if (ATTENTION_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) {
    return { notify: true, reason: "always:error-keyword" };
  }

  // 빈 출력이거나 지나치게 짧아 실패를 은폐했을 가능성 — 안전하게 알림.
  const trimmed = input.summary.trim();
  if (trimmed.length === 0) {
    return { notify: true, reason: "always:empty-or-short-output" };
  }

  return null;
}

/**
 * 순수 휴리스틱 결정 — 네트워크 호출 없이 confident할 때만 결정을 반환.
 * null이면 confident하지 않다는 뜻이며, 호출부가 분류기(Gemini) 폴백을 시도해야 한다.
 */
export function heuristicDecide(input: JobNotifyGateInput): JobNotifyDecision | null {
  const always = checkAlwaysNotify(input);
  if (always) return always;

  const trimmed = input.summary.trim();

  // 매우 짧은 성공 결과 (예: "완료", "적용했습니다.") — 알릴 필요 낮음.
  if (trimmed.length <= TRIVIAL_SUCCESS_MAX_LEN) {
    return { notify: false, reason: "heuristic:trivial-success" };
  }

  // 충분히 긴 결과는 실질적 내용을 담고 있을 가능성이 높아 알림 쪽으로 confident.
  if (trimmed.length >= SUBSTANTIAL_SUCCESS_MIN_LEN) {
    return { notify: true, reason: "classifier:notify" };
  }

  // 애매한 구간 (TRIVIAL_SUCCESS_MAX_LEN < len < SUBSTANTIAL_SUCCESS_MIN_LEN) — 분류기에 위임.
  return null;
}

/**
 * 최종 게이팅 결정. 휴리스틱이 confident하면 그대로 사용하고, 아니면 무료 티어 분류기(Gemini Flash)를
 * 시도한다. GEMINI_API_KEY 미설정 또는 호출 실패 시 항상 "알림"으로 fail-safe.
 */
export async function decideJobNotify(input: JobNotifyGateInput): Promise<JobNotifyDecision> {
  const heuristic = heuristicDecide(input);
  if (heuristic) return heuristic;

  if (!isTriageEnabled()) {
    return { notify: true, reason: "classifier:unavailable-failsafe-notify" };
  }

  try {
    const systemPrompt =
      `너는 작업 완료 결과를 보고 "사용자에게 지금 알릴 가치가 있는가"만 판단하는 단순 분류기다. ` +
      `설명·의견·페르소나 없이 정확히 "yes" 또는 "no" 한 단어만 출력하라. ` +
      `애매하면 항상 "yes"로 답하라(놓치는 것보다 과알림이 안전하다).`;
    const question =
      `다음은 완료된 작업 결과 요약이다. 이 결과가 사용자에게 알릴 필요가 있는가?\n\n` +
      `결과 요약:\n${input.summary.slice(0, 2000)}`;
    const res = await callGeminiFlash(systemPrompt, question, [], { temperature: 0, maxOutputTokens: 8 });
    if (!res.ok) {
      return { notify: true, reason: "classifier:error-failsafe-notify" };
    }
    const answer = res.text.trim().toLowerCase();
    if (answer.startsWith("no")) {
      return { notify: false, reason: "classifier:skip" };
    }
    // "yes" 또는 애매한 응답은 모두 알림으로 처리 (fail-safe).
    return { notify: true, reason: "classifier:notify" };
  } catch {
    return { notify: true, reason: "classifier:error-failsafe-notify" };
  }
}

// ============================================================
// 배칭 — 짧은 시간 창 내 여러 job 완료를 하나의 지니 턴으로 코일레스싱.
// telegram.ts의 sendTelegramNoticeThrottled 패턴(마지막 발송 시각 + pending 카운터)을 참고했으나,
// "카운트만 누적"이 아니라 "완료 항목 목록을 누적 → 창 종료 시 하나로 합쳐 flush"하는 형태로 응용.
// ============================================================

export interface BatchedNotifyItem {
  jobId: string;
  requestPreview: string;
  statusText: string;
  summary: string;
  /** 종결 상태 원본. 배치의 저가/기본 모델 분기(notifySourceForBatch)에 쓴다. */
  status: JobStatus;
}

/**
 * 배치 → 마이크루 발화 source 판정. **보수 판정이다.**
 *
 * 전건이 `completed` 일 때만 `job:notify:ok`(저가 티어)로 보낸다.
 * `failed`/`outputs_missing`/그 외 어떤 상태든 하나라도 섞이면 배치 전체를 `job:notify:fail` 로 보낸다.
 * `outputs_missing` 은 보고 서식 검사 실패지 작업 실패는 아니지만, 재발주 판단이 필요하므로 :fail 쪽이다.
 *
 * 성공 건이 비싼 모델을 타는 손해는 감수하고, 실패가 싼 모델로 새는 것은 원천 차단한다.
 * 빈 배열은 도달하지 않지만(enqueue 가 length>0 일 때만 flush) 안전 쪽인 :fail 로 둔다.
 */
export function notifySourceForBatch(items: BatchedNotifyItem[]): "job:notify:ok" | "job:notify:fail" {
  if (items.length === 0) return "job:notify:fail";
  return items.every((it) => it.status === "completed") ? "job:notify:ok" : "job:notify:fail";
}

const DEFAULT_DEBOUNCE_MS = 7_000; // 5~10초 창 — 여러 잡이 근접 완료될 때(루프 스텝, 병렬 위임 등) 코일레싱

interface BatchState {
  items: BatchedNotifyItem[];
  timer: ReturnType<typeof setTimeout> | null;
}

const batchState: BatchState = { items: [], timer: null };

/**
 * "알림 필요" 판정을 통과한 job 하나를 배치 큐에 추가한다. debounce 창(기본 7초) 동안 추가로
 * 들어오는 항목을 계속 누적하고, 창이 끝나는 시점에 flush 콜백을 한 번만 호출한다(코일레싱).
 * 창 내에 새 항목이 들어오면 타이머를 재시작한다(telegram.ts 패턴과 동일: 마지막 항목 기준 재계산).
 */
export function enqueueBatchedNotify(
  item: BatchedNotifyItem,
  flush: (items: BatchedNotifyItem[]) => void,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): void {
  batchState.items.push(item);
  if (batchState.timer) clearTimeout(batchState.timer);
  batchState.timer = setTimeout(() => {
    const pending = batchState.items.splice(0, batchState.items.length);
    batchState.timer = null;
    if (pending.length > 0) flush(pending);
  }, debounceMs);
  batchState.timer.unref?.();
}

/** 배치를 하나의 지니 메시지 텍스트로 합성. 1건이면 기존 단건 포맷과 동일하게, 2건 이상이면 목록 형태로. */
export function formatBatchedGenieNotice(items: BatchedNotifyItem[]): string {
  if (items.length === 1) {
    const it = items[0];
    return `[시스템 알림] "${it.requestPreview}" 작업 ${it.statusText}. 결과: ${it.summary}

작업 결과는 이미 사용자에게 직접 표시되었습니다.
당신이 할 일:
1. 후속 조치가 필요하면 즉시 수행하세요 (위임, 체이닝 등).
2. 사용자에게 알릴 사항이 있으면 [REPORT]를 첫 줄에 붙여 1~2줄로 보고하세요.
   예: 후속 작업 진행 중, 특이사항 발견, 주의가 필요한 부분 등.
3. 특별히 알릴 것도 없고 후속 조치도 없으면 아무 응답 하지 마세요.
TODO 태그 사용 금지.`;
  }

  const list = items
    .map((it, i) => `${i + 1}. "${it.requestPreview}" — ${it.statusText}. 결과: ${it.summary}`)
    .join("\n\n");
  return `[시스템 알림] 작업 ${items.length}건이 완료되었습니다.

${list}

작업 결과는 이미 사용자에게 직접 표시되었습니다.
당신이 할 일:
1. 후속 조치가 필요한 항목이 있으면 즉시 수행하세요 (위임, 체이닝 등).
2. 사용자에게 알릴 사항이 있으면 [REPORT]를 첫 줄에 붙여 1~2줄로 보고하세요.
3. 특별히 알릴 것도 없고 후속 조치도 없으면 아무 응답 하지 마세요.
TODO 태그 사용 금지.`;
}

// 테스트 전용 — 모듈 전역 배치 상태를 초기화 (테스트 간 격리).
export function __resetBatchStateForTest(): void {
  if (batchState.timer) clearTimeout(batchState.timer);
  batchState.timer = null;
  batchState.items.length = 0;
}

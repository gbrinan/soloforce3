// 텔레그램 "보조 AI 트리아지" 레이어 — 저비용(무료 티어) Gemini Flash로 단순 대화를 먼저 처리하고,
// 지니(Genie)의 기억/파일/도구/위임이 필요한 요청만 기존 경로로 에스컬레이션한다.
//
// 설계 원칙:
// - GEMINI_API_KEY 미설정 시 이 모듈의 판단은 전혀 개입하지 않는다 (100% 지니 경로, 기존 동작 유지).
// - 이 모듈의 어떤 예외/타임아웃/네트워크 실패도 반드시 "지니로 폴백"으로 귀결된다 (메시지 드롭 금지).
// - 신규 npm 의존성 없음 — Node 22 전역 fetch만 사용.

// ============================================================
// 상수
// ============================================================

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 20_000;
const ESCALATE_MARKER = "<<ESCALATE>>";

// 대화 히스토리 링버퍼: chat당 최근 N개의 "보조 AI 교환"만 유지 (지니 경로 전달 건은 저장하되 모델 turn으로는 취급하지 않음)
const HISTORY_MAX_EXCHANGES = 6;

// mycrew 기능(기억/파일/도구/위임 등)이 필요한 것으로 간주되는 키워드.
// 이 목록에 매칭되면 보조 AI를 거치지 않고 곧바로 지니에게 에스컬레이션한다.
// 수정하기 쉽도록 별도 const 배열로 유지.
export const GENIE_ESCALATION_KEYWORDS: readonly string[] = [
  "위임",
  "시켜",
  "맡겨",
  "작업",
  "파일",
  "문서",
  "만들어",
  "작성",
  "수정",
  "루프",
  "자동화",
  "일정",
  "스케줄",
  "캘린더",
  "리마인더",
  "알림",
  "승인",
  "결재",
  "기억",
  "위키",
  "저장",
  "직원",
  "팀",
  "채용",
  "보고서",
  "앱",
  "프로젝트",
  "이메일 보내",
  "메시지 보내",
  "친구",
  "동료",
];

const GENIE_PREFIX_RE = /^\s*지니야[,.\s]*/;
const GENIE_COMMAND_RE = /^\s*\/genie(?:@\w+)?\s+([\s\S]+)$/i;

// ============================================================
// 타입
// ============================================================

export type ClassificationResult =
  | { route: "genie"; strippedText: string; reason: "prefix" | "command" | "keyword" }
  | { route: "assistant"; strippedText: string };

/** 보조 AI 대화 히스토리 한 턴(사용자 발화 + 모델 응답 쌍의 절반). */
export interface HistoryTurn {
  role: "user" | "model";
  text: string;
}

/** chat별 링버퍼 상태. */
export interface ChatHistoryState {
  turns: HistoryTurn[];
}

export interface AskAssistantResult {
  ok: true;
  text: string;
  escalate: boolean;
}

export interface AskAssistantFailure {
  ok: false;
  error: string;
}

export type AskAssistantResponse = AskAssistantResult | AskAssistantFailure;

// ============================================================
// 분류 로직 (순수 함수 — 네트워크 호출 없음, 테스트 용이)
// ============================================================

/**
 * 텔레그램 원문 텍스트를 분류한다.
 * - "지니야" 접두 또는 "/genie <text>" 명령 → genie 경로 (접두사/명령 제거된 본문 반환)
 * - mycrew 기능 키워드 포함 → genie 경로
 * - 그 외 → assistant 경로 (보조 AI가 먼저 응답 시도)
 */
export function classifyMessage(text: string): ClassificationResult {
  const trimmed = text.trim();

  const commandMatch = trimmed.match(GENIE_COMMAND_RE);
  if (commandMatch) {
    return { route: "genie", strippedText: commandMatch[1].trim(), reason: "command" };
  }

  if (GENIE_PREFIX_RE.test(trimmed)) {
    const stripped = trimmed.replace(GENIE_PREFIX_RE, "").trim();
    return { route: "genie", strippedText: stripped || trimmed, reason: "prefix" };
  }

  const hasKeyword = GENIE_ESCALATION_KEYWORDS.some((kw) => trimmed.includes(kw));
  if (hasKeyword) {
    return { route: "genie", strippedText: trimmed, reason: "keyword" };
  }

  return { route: "assistant", strippedText: trimmed };
}

/** 응답 텍스트에 <<ESCALATE>> 마커가 포함되어 있는지 확인 (앞뒤 공백/부가 텍스트 허용). */
export function containsEscalateMarker(responseText: string): boolean {
  return responseText.includes(ESCALATE_MARKER);
}

/** <<ESCALATE>> 마커를 제거한 순수 응답 텍스트 (에스컬레이션이 아닐 때 사용자에게 보낼 내용). */
export function stripEscalateMarker(responseText: string): string {
  return responseText.replace(new RegExp(ESCALATE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "").trim();
}

// ============================================================
// 대화 히스토리 링버퍼 (chat별, 인메모리)
// ============================================================

const historyMap = new Map<number, ChatHistoryState>();

export function getOrCreateHistory(chatId: number): ChatHistoryState {
  let state = historyMap.get(chatId);
  if (!state) {
    state = { turns: [] };
    historyMap.set(chatId, state);
  }
  return state;
}

// 데스크톱 채팅용 별도 링버퍼 (key: browserId 문자열, 없으면 "default" 단일 세션).
// 텔레그램의 historyMap(key: 숫자 chatId)과 완전히 독립적인 keyspace — 서로 섞이지 않는다.
const desktopHistoryMap = new Map<string, ChatHistoryState>();

export function getOrCreateDesktopHistory(sessionKey: string): ChatHistoryState {
  let state = desktopHistoryMap.get(sessionKey);
  if (!state) {
    state = { turns: [] };
    desktopHistoryMap.set(sessionKey, state);
  }
  return state;
}

/** 테스트 전용: 데스크톱 히스토리 맵 초기화. */
export function resetDesktopHistoryForTest(): void {
  desktopHistoryMap.clear();
}

/** 링버퍼에 턴을 추가하고 최근 HISTORY_MAX_EXCHANGES*2 개(user+model 쌍)만 유지. */
export function pushHistoryTurn(state: ChatHistoryState, turn: HistoryTurn): void {
  state.turns.push(turn);
  const maxTurns = HISTORY_MAX_EXCHANGES * 2;
  if (state.turns.length > maxTurns) {
    state.turns.splice(0, state.turns.length - maxTurns);
  }
}

/** 지니 경로로 전달된 사용자 메시지를 히스토리에 "참고용"으로만 남긴다 (모델 turn 생성 없음). */
export function recordGenieHandoff(chatId: number, originalText: string): void {
  const state = getOrCreateHistory(chatId);
  pushHistoryTurn(state, { role: "user", text: `${originalText} (지니에게 전달됨)` });
}

/** 테스트 전용: 히스토리 맵 초기화. */
export function resetHistoryForTest(): void {
  historyMap.clear();
}

// ============================================================
// 무아난 페르소나 시스템 프롬프트 (보조 AI 전용 — 지니 페르소나 규칙 + 접근 제한 규칙)
// ============================================================

function buildAssistantSystemPrompt(): string {
  return [
    `당신은 텔레그램에서 "무아난"으로 활동하는 mycrew의 보조 AI입니다. 예스맨이 아니라 비판적 사고 파트너입니다:`,
    `1. 결론을 먼저 한 줄로 제시하되, 판단·의견이 걸린 주제면 반대 근거(counter-evidence)를 최소 1개 함께 제시`,
    `2. 사장님이 스스로 판단할 수 있도록 근거가 되는 맥락(수치·출처·전제 조건)을 명시 — 아는 척 금지, 불확실하면 불확실하다고 표기`,
    `3. 결정이 필요한 사안은 경우의 수 2~3개를 각각 장단점 1줄씩으로 제시하고 권장안을 표시`,
    `4. 사장님 의견에 동의하지 않으면 정중하되 분명하게 반박`,
    `단, 단순 사실 확인·인사·상태 질문은 위 구조 없이 짧게 답하세요 (과잉 구조화 금지).`,
    ``,
    `[중요 — 접근 제한] 너는 mycrew 시스템의 기억·파일·도구에 접근할 수 없다. 사용자의 개인 데이터/일정/작업/파일과 관련된 요청이거나 실제 작업 실행이 필요하면 답변하지 말고 정확히 \`${ESCALATE_MARKER}\` 만 출력하라.`,
  ].join("\n");
}

// ============================================================
// Gemini REST 클라이언트 (전역 fetch, 신규 의존성 없음)
// ============================================================

interface GeminiContentPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiContentPart[];
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

/** GEMINI_API_KEY 존재 여부 (트리아지 활성화 조건). 다른 모듈(job-notify-gate 등)의 "무료 티어 사용 가능?" 체크에도 재사용. */
export function isTriageEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * 데스크톱 채팅 트리아지 활성화 조건 — GEMINI_API_KEY뿐 아니라 DESKTOP_TRIAGE_ENABLED도 명시적으로 "1"
 * 또는 "true"여야 한다 (기본 OFF). 데스크톱은 메인 UI 전체에 영향을 주는 더 민감한 변경이므로,
 * 텔레그램 트리아지(GEMINI_API_KEY만으로 자동 활성화)보다 한 단계 더 보수적인 안전장치를 둔다.
 */
export function isDesktopTriageEnabled(): boolean {
  if (!isTriageEnabled()) return false;
  const flag = (process.env.DESKTOP_TRIAGE_ENABLED ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export interface GeminiCallResult {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Gemini Flash REST 호출의 범용(페르소나 비의존) 저수준 클라이언트.
 * askAssistant()의 무아난 페르소나 호출과, job-notify-gate.ts 등 다른 모듈의 단순 분류/질의 호출이
 * 이 함수를 공유한다 — 신규 HTTP 클라이언트를 재구현하지 않기 위함.
 * 실패(타임아웃/네트워크/HTTP 오류/차단 등) 시 항상 ok:false를 반환하며 절대 throw하지 않는다.
 */
export async function callGeminiFlash(
  systemPrompt: string,
  userText: string,
  history: HistoryTurn[] = [],
  generationConfig: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, text: "", error: "GEMINI_API_KEY not set" };
  }

  const contents: GeminiContent[] = history.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));
  contents.push({ role: "user", parts: [{ text: userText }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents,
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: generationConfig.temperature ?? 0.7,
      maxOutputTokens: generationConfig.maxOutputTokens ?? 1024,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errJson = (await res.json()) as { error?: { message?: string } };
        if (errJson?.error?.message) detail += `: ${errJson.error.message}`;
      } catch {
        // 응답 본문 파싱 실패는 무시하고 상태 코드만 사용
      }
      return { ok: false, text: "", error: detail };
    }

    const json = (await res.json()) as GeminiGenerateContentResponse;
    if (json.promptFeedback?.blockReason) {
      return { ok: false, text: "", error: `blocked: ${json.promptFeedback.blockReason}` };
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      return { ok: false, text: "", error: "empty response" };
    }

    return { ok: true, text };
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    return {
      ok: false,
      text: "",
      error: isAbort ? `timeout after ${GEMINI_TIMEOUT_MS}ms` : err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gemini Flash에 질의한다(무아난 페르소나). 실패(타임아웃/네트워크/HTTP 오류/차단 등) 시 항상 ok:false를
 * 반환하며, 호출부는 이를 무조건 지니 폴백으로 처리해야 한다 (메시지 드롭 금지).
 */
export async function askAssistant(
  chatId: number,
  userText: string,
  history: HistoryTurn[] = [],
): Promise<AskAssistantResponse> {
  const result = await callGeminiFlash(buildAssistantSystemPrompt(), userText, history);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "unknown error" };
  }
  const escalate = containsEscalateMarker(result.text);
  return { ok: true, text: escalate ? "" : stripEscalateMarker(result.text), escalate };
}

// ============================================================
// 데스크톱 채팅 트리아지 진입점 (transport: chat.ts sendMessage() 전용)
// ============================================================

/** "🤖 " 접두 — 텔레그램 트리아지 응답 관례(telegram.ts:918)와 동일하게, 지니가 아닌 보조 AI 응답임을 표시. */
export const DESKTOP_ASSISTANT_PREFIX = "🤖 ";

export type DesktopTriageResult =
  | { handled: true; replyText: string }
  | { handled: false; reason: "disabled" | "genie-prefix" | "keyword" | "escalate" | "error"; strippedText: string };

/**
 * 데스크톱 채팅(chat.ts _sendMessageImpl 진입 전) 트리아지 진입점.
 * - 비활성(isDesktopTriageEnabled()===false) → 항상 handled:false, reason:"disabled" (지니 경로 그대로).
 * - "지니야" 접두/명령/기능 키워드 매칭 → handled:false (지니 경로로 에스컬레이션, 원문은 참고용 기록).
 * - Gemini 호출 성공 + 비-에스컬레이션 → handled:true, replyText에 "🤖 " 접두 포함.
 * - Gemini 호출 실패/예외/자가 에스컬레이션 → handled:false (반드시 지니 폴백 — 메시지 드롭 금지).
 * 이 함수는 예외를 던지지 않는다 — 호출부(chat.ts)가 항상 안전하게 폴백 분기할 수 있도록 보장한다.
 */
export async function runDesktopTriage(sessionKey: string, text: string): Promise<DesktopTriageResult> {
  if (!isDesktopTriageEnabled()) {
    return { handled: false, reason: "disabled", strippedText: text };
  }

  try {
    const classification = classifyMessage(text);
    if (classification.route === "genie") {
      // "지니야" 접두/명령/기능 키워드 매칭 → 곧바로 지니行. 원문(접두 제거본)을 히스토리에 참고용으로만 기록.
      const historyState = getOrCreateDesktopHistory(sessionKey);
      pushHistoryTurn(historyState, { role: "user", text: `${classification.strippedText} (지니에게 전달됨)` });
      const reason = classification.reason === "keyword" ? "keyword" : "genie-prefix";
      return { handled: false, reason, strippedText: classification.strippedText };
    }

    const historyState = getOrCreateDesktopHistory(sessionKey);
    const result = await askAssistant(0, classification.strippedText, historyState.turns);

    if (!result.ok) {
      // Gemini 호출 실패(타임아웃/네트워크/쿼터 등) → 메시지를 절대 드롭하지 않고 지니로 폴백.
      console.warn(`[DesktopTriage] 보조 AI 호출 실패 (session=${sessionKey}), 지니로 폴백:`, result.error);
      return { handled: false, reason: "error", strippedText: classification.strippedText };
    }

    if (result.escalate) {
      // 보조 AI가 스스로 <<ESCALATE>> 판단 → 원문을 지니에게 그대로 전달.
      pushHistoryTurn(historyState, { role: "user", text: `${classification.strippedText} (지니에게 전달됨)` });
      return { handled: false, reason: "escalate", strippedText: classification.strippedText };
    }

    // 보조 AI가 직접 응답 → 히스토리 기록 후 "🤖 " 접두로 회신.
    pushHistoryTurn(historyState, { role: "user", text: classification.strippedText });
    pushHistoryTurn(historyState, { role: "model", text: result.text });
    return { handled: true, replyText: `${DESKTOP_ASSISTANT_PREFIX}${result.text}` };
  } catch (err) {
    // 트리아지 레이어 자체의 예상치 못한 예외 → crash-safe: 지니로 폴백 (메시지 드롭 금지).
    console.warn("[DesktopTriage] 트리아지 처리 중 예외, 지니로 폴백:", err instanceof Error ? err.message : err);
    return { handled: false, reason: "error", strippedText: text };
  }
}

// 테스트 전용 export
export const __testUtils = {
  GEMINI_MODEL,
  GEMINI_TIMEOUT_MS,
  ESCALATE_MARKER,
  HISTORY_MAX_EXCHANGES,
};

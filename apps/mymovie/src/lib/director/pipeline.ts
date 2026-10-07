// AI Director 파이프라인 v0 — 시그널 수집 → LLM → Action[] → 검증 → 디스패치 → undo 기록.

import type { Footage, Action } from "../core/action-types";
import { validateActions } from "../core/action-validator";
import { inverseOf, type InverseRecord } from "../core/inverse-action-generator";
import { LLMRouter, type RouterCallResult } from "./llm/factory";
import type { LLMRouterOptions } from "./llm/types";
import {
  detectMeta,
  detectSceneCuts,
  detectSilences,
  deriveHighlights,
} from "./analyze";
import { transcribe, type TranscribeResult } from "./transcribe";
import type { DirectorSignals } from "./signals";
import {
  DIRECTOR_SYSTEM_PROMPT,
  buildDirectorUserPrompt,
  extractJsonArray,
} from "./prompt";
import { sanitizeActions, type SanitizeReport } from "./sanitize";
import { dispatchActions, type DispatchResult } from "./dispatch";

export interface DirectorRunInput {
  inputPath: string;
  clipId?: string;
  intent?: string;
  /** LLM provider 강제 선택 (auto = 자동 fallback) */
  prefer?: LLMRouterOptions["prefer"];
  /** 시그널만 수집하고 LLM은 호출하지 않음 (테스트용) */
  skipLLM?: boolean;
  /** LLM 응답을 외부에서 주입 (테스트용 — provider 우회) */
  injectLLMText?: string;
  /** STT 호출 생략 (테스트용 — 매번 ffmpeg/wisper 실행 회피) */
  skipTranscribe?: boolean;
  /** 시그널 수집 자체를 생략하고 외부에서 주입 (단위 테스트용) */
  injectSignals?: DirectorSignals;
}

export interface DirectorRunResult {
  ok: boolean;
  signals: DirectorSignals;
  transcribe: TranscribeResult | null;
  llm: RouterCallResult | null;
  sanitize: SanitizeReport;
  validation: { ok: boolean; errors: Array<{ actionId?: string; reason: string }> };
  finalActions: Action[];
  dispatch: DispatchResult | null;
  inverse: InverseRecord[];
  errors: string[];
}

const FALLBACK_FOOTAGE_CLIP_ID = "clip-1";

export async function runDirector(
  input: DirectorRunInput,
  router: LLMRouter = new LLMRouter(),
): Promise<DirectorRunResult> {
  const errors: string[] = [];
  const clipId = input.clipId ?? FALLBACK_FOOTAGE_CLIP_ID;

  // 1) 시그널 수집
  let signals: DirectorSignals;
  let transcribeResult: TranscribeResult | null = null;
  if (input.injectSignals) {
    signals = input.injectSignals;
  } else {
    const meta = await detectMeta(input.inputPath);
    if (!meta) {
      return emptyFailure("ffprobe failed — invalid input or ffmpeg not available", clipId);
    }
    const [sceneCuts, silences] = await Promise.all([
      detectSceneCuts(input.inputPath).catch((e) => {
        errors.push(`sceneCuts: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }),
      detectSilences(input.inputPath).catch((e) => {
        errors.push(`silences: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }),
    ]);
    if (!input.skipTranscribe) {
      transcribeResult = await transcribe(input.inputPath).catch((e) => {
        errors.push(`transcribe: ${e instanceof Error ? e.message : String(e)}`);
        return { ok: false, source: "stub" as const, segments: [], note: "transcribe failed" };
      });
    }
    const transcript = transcribeResult?.segments ?? [];
    const highlights = deriveHighlights(meta, sceneCuts, transcript);
    signals = { meta, transcript, sceneCuts, silences, highlights };
  }

  const footage: Footage = {
    id: clipId,
    path: input.inputPath,
    durationMs: signals.meta.durationMs,
    width: signals.meta.width,
    height: signals.meta.height,
  };

  // 2) LLM 호출 → 원본 텍스트 (또는 inject)
  let llmResult: RouterCallResult | null = null;
  let rawLLMText = input.injectLLMText ?? "";
  if (!rawLLMText && !input.skipLLM) {
    try {
      llmResult = await router.generate(
        {
          system: DIRECTOR_SYSTEM_PROMPT,
          user: buildDirectorUserPrompt({ signals, clipId, intent: input.intent }),
        },
        { prefer: input.prefer ?? "auto" },
      );
      rawLLMText = llmResult.text;
    } catch (e) {
      errors.push(`llm: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3) JSON 추출 + sanitize
  const parsed = rawLLMText ? extractJsonArray(rawLLMText) : [];
  if (rawLLMText && !parsed) {
    errors.push("llm output is not a JSON array (after fence/bracket extraction)");
  }
  const sanitize = sanitizeActions(parsed ?? [], { clipId });

  // 4) 검증
  const validation = validateActions(sanitize.accepted, footage);
  // 검증 실패 액션 id 제거 — Director는 통과 액션만 적용한다.
  const failedIds = new Set(
    validation.errors.map((e) => e.actionId).filter((x): x is string => typeof x === "string"),
  );
  const finalActions = sanitize.accepted.filter((a) => !failedIds.has(a.meta.id));

  // 5) 디스패치 + inverse
  const dispatch = await dispatchActions(finalActions, footage);
  const inverse = finalActions.map((a) => inverseOf(a));

  return {
    ok: errors.length === 0 && validation.ok && (parsed !== null || !!input.injectSignals || input.skipLLM === true),
    signals,
    transcribe: transcribeResult,
    llm: llmResult,
    sanitize,
    validation,
    finalActions,
    dispatch,
    inverse,
    errors,
  };
}

function emptyFailure(reason: string, _clipId: string): DirectorRunResult {
  return {
    ok: false,
    signals: {
      meta: { durationMs: 0, width: 0, height: 0 },
      transcript: [],
      sceneCuts: [],
      silences: [],
      highlights: [],
    },
    transcribe: null,
    llm: null,
    sanitize: { accepted: [], rejected: [] },
    validation: { ok: false, errors: [{ reason }] },
    finalActions: [],
    dispatch: null,
    inverse: [],
    errors: [reason],
  };
}

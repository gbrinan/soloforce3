// POST /api/director/script-to-video
// Body: { script: string, sourceClips?: SourceClip[], lang?: string }
// → 대본 텍스트를 (1) LLM으로 씬(문장) 단위 분해 → (2) 각 씬에 caption 액션 + (소스 있으면) cut 액션 배치
//   → (3) 내레이션은 기존 /api/tts 재사용으로 오디오 1개 생성. 최종 Action[]을 기존 action-validator로 검증 후 반환.
//
// 기존 자산 재사용 (신규 액션 타입 발명 없음):
//   - LLM: @/lib/claude-cli(runClaude/extractJson) → 게이트웨이 자동(appId "movie")
//   - Action 타입/검증: @/lib/core/action-types, @/lib/core/action-validator
//   - TTS: 기존 /api/tts 라우트(macOS say) 내부 호출

import { NextResponse } from "next/server";
import { runClaude, extractJson, claudeErrorDetail } from "@/lib/claude-cli";
import type { Action, CaptionAction, CutAction } from "@/lib/core/action-types";
import { validateActions } from "@/lib/core/action-validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // LLM 분해 + TTS 직렬 실행 대비

const CLAUDE_TIMEOUT_MS = 120_000;
const MAX_SCRIPT_CHARS = 12_000;
const MAX_TTS_CHARS = 5000; // /api/tts와 동일한 상한
const MAX_SCENES = 60;
const DEFAULT_CLIP_ID = "clip-1";
// 자막 노출 시간 추정(문자당 ms) — 한국어 낭독 기준 대략치. 정확한 타이밍은 후속 렌더에서 보정.
const MS_PER_CHAR = 180;
const MIN_SCENE_MS = 1500;
const MAX_SCENE_MS = 12_000;

interface SourceClip {
  id: string;
  durationMs?: number;
  label?: string;
}

interface ScriptToVideoBody {
  script?: string;
  sourceClips?: SourceClip[];
  lang?: string;
}

interface RawScene {
  narration?: string;
  caption?: string;
  sourceClipId?: string | null;
  durationMs?: number | null;
}

let idCounter = 0;
function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function aiMeta(prefix: string): Action["meta"] {
  return { id: freshId(prefix), createdAt: Date.now(), source: "ai" };
}

/** lang → macOS say 보이스 (ko=Yuna 기본, en=Samantha). /api/tts VOICE_RE 호환. */
function voiceForLang(lang: string): string {
  if (lang.toLowerCase().startsWith("en")) return "Samantha";
  return "Yuna";
}

function buildScenePrompt(script: string, lang: string, sourceClips: SourceClip[]): string {
  const clipHint =
    sourceClips.length > 0
      ? [
          "사용 가능한 소스 영상(각 씬에 배치할 수 있음). sourceClipId에는 아래 id 중 하나만 쓰거나 null.",
          "```json",
          JSON.stringify(
            sourceClips.map((c) => ({ id: c.id, label: c.label ?? null, durationMs: c.durationMs ?? null })),
            null,
            2,
          ),
          "```",
        ].join("\n")
      : "소스 영상은 제공되지 않았습니다. sourceClipId는 모두 null로 두세요.";

  return [
    `다음 대본을 영상 씬(문장/의미) 단위로 분해하라. 언어: ${lang}.`,
    "각 씬은 화면 자막(caption, 짧고 읽기 쉬운 한 줄)과 내레이션(narration, 낭독할 원문)을 가진다.",
    clipHint,
    "",
    `규칙: 씬은 최대 ${MAX_SCENES}개. durationMs는 선택(없으면 null, 서버가 문자수로 추정). caption은 narration을 짧게 요약/발췌한 화면용 텍스트.`,
    "출력은 JSON 배열만. 다른 텍스트 금지:",
    '[{"narration":"낭독 문장","caption":"화면 자막","sourceClipId":null,"durationMs":null}]',
    "",
    "대본:",
    script,
  ].join("\n");
}

function estimateSceneMs(text: string, override?: number | null): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, Math.round(override)));
  }
  const est = text.trim().length * MS_PER_CHAR;
  return Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, est));
}

export async function POST(req: Request) {
  let body: ScriptToVideoBody;
  try {
    body = (await req.json()) as ScriptToVideoBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const script = typeof body.script === "string" ? body.script.trim() : "";
  if (!script) {
    return NextResponse.json({ ok: false, error: "script required" }, { status: 400 });
  }
  if (script.length > MAX_SCRIPT_CHARS) {
    return NextResponse.json(
      { ok: false, error: `script too long (max ${MAX_SCRIPT_CHARS} chars)` },
      { status: 400 },
    );
  }
  const lang = typeof body.lang === "string" && body.lang.trim() ? body.lang.trim() : "ko";
  const sourceClips: SourceClip[] = Array.isArray(body.sourceClips)
    ? body.sourceClips.filter(
        (c): c is SourceClip => !!c && typeof c === "object" && typeof (c as SourceClip).id === "string",
      )
    : [];
  const clipById = new Map(sourceClips.map((c) => [c.id, c]));

  const warnings: string[] = [];

  // 1) LLM으로 씬 분해 (게이트웨이 자동 — appId "movie")
  let raw: string;
  try {
    raw = await runClaude(buildScenePrompt(script, lang, sourceClips), {
      timeoutMs: CLAUDE_TIMEOUT_MS,
      appId: "movie",
      feature: "script-to-video",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: claudeErrorDetail(e, CLAUDE_TIMEOUT_MS) },
      { status: 502 },
    );
  }
  const scenes = extractJson<RawScene[]>(raw);
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "LLM 응답에서 씬 배열을 추출하지 못했습니다" },
      { status: 502 },
    );
  }

  // 2) 씬 → Action[] (caption + 소스 있으면 cut). 전역 타임라인 커서 누적.
  const actions: Action[] = [];
  const narrationParts: string[] = [];
  let cursorMs = 0;
  let rrIndex = 0; // 소스 클립 round-robin

  for (const scene of scenes.slice(0, MAX_SCENES)) {
    const narration = typeof scene?.narration === "string" ? scene.narration.trim() : "";
    const captionText =
      typeof scene?.caption === "string" && scene.caption.trim()
        ? scene.caption.trim()
        : narration;
    if (!captionText) continue; // 빈 씬 스킵

    const durMs = estimateSceneMs(narration || captionText, scene?.durationMs ?? null);
    if (narration) narrationParts.push(narration);

    // 소스 클립 배정: 지정 id가 유효하면 그것, 아니면 round-robin.
    let clip: SourceClip | undefined;
    if (sourceClips.length > 0) {
      const wanted = typeof scene?.sourceClipId === "string" ? clipById.get(scene.sourceClipId) : undefined;
      clip = wanted ?? sourceClips[rrIndex % sourceClips.length];
      rrIndex += 1;
    }
    const clipId = clip?.id ?? DEFAULT_CLIP_ID;

    // caption 액션 (기존 CaptionAction 타입)
    const caption: CaptionAction = {
      type: "caption",
      meta: aiMeta("cap"),
      clipId,
      start: cursorMs,
      end: cursorMs + durMs,
      text: captionText,
      style: { pos: "bottom" },
    };
    actions.push(caption);

    // cut 액션 — 소스 클립 있을 때 씬 경계에 배치 (기존 CutAction 타입).
    // cut.at은 해당 클립 내부 시각이므로 클립 길이를 알면 클램프.
    if (clip) {
      const at =
        typeof clip.durationMs === "number" && clip.durationMs > 0
          ? Math.min(cursorMs, clip.durationMs)
          : cursorMs;
      const cut: CutAction = { type: "cut", meta: aiMeta("cut"), clipId: clip.id, at };
      actions.push(cut);
    }

    cursorMs += durMs;
  }

  if (actions.length === 0) {
    return NextResponse.json(
      { ok: false, error: "생성된 액션이 없습니다 (대본 분해 결과가 비어 있음)" },
      { status: 422 },
    );
  }

  // 3) 기존 validator로 검증 → 실패 액션 제거 + 경고 수집 (footage 미지정: 범위 클램프 없음)
  const validation = validateActions(actions);
  const failedIds = new Set(
    validation.errors.map((e) => e.actionId).filter((x): x is string => typeof x === "string"),
  );
  const finalActions = actions.filter((a) => !failedIds.has(a.meta.id));
  for (const err of validation.errors) {
    warnings.push(`validator: ${err.reason}${err.actionId ? ` (${err.actionId})` : ""}`);
  }

  // 4) 내레이션 오디오 — 기존 /api/tts 재사용 (macOS say). 실패해도 액션은 반환.
  let narrationAudio: string | undefined;
  const narrationText = narrationParts.join("\n").trim();
  if (narrationText) {
    let ttsText = narrationText;
    if (ttsText.length > MAX_TTS_CHARS) {
      ttsText = ttsText.slice(0, MAX_TTS_CHARS);
      warnings.push(`narration truncated to ${MAX_TTS_CHARS} chars for TTS`);
    }
    try {
      const ttsUrl = new URL("/api/tts", req.url).toString();
      const ttsRes = await fetch(ttsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: ttsText, voice: voiceForLang(lang) }),
      });
      const ttsData = (await ttsRes.json()) as { ok?: boolean; path?: string; error?: string };
      if (ttsRes.ok && ttsData.ok && typeof ttsData.path === "string") {
        narrationAudio = ttsData.path;
      } else {
        warnings.push(`TTS 실패: ${ttsData.error ?? `status ${ttsRes.status}`}`);
      }
    } catch (e) {
      warnings.push(`TTS 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    actions: finalActions,
    narrationAudio,
    warnings,
    // 참고 메타 — 타이밍은 문자수 기반 추정치.
    meta: { sceneCount: scenes.length, actionCount: finalActions.length, totalDurationMs: cursorMs },
  });
}

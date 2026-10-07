// POST /api/render/[id]
// id = jobId. director 파이프라인을 실행해 finalActions를 얻고,
// executeMany로 cut/trim/reframe + caption/bgm/transition을 영상에 chain 적용한 후
// **단일 최종 mp4 절대경로**를 반환한다. transition은 multi-clip 합성이 Step 5 범위라 warning.
//
// 보안: 입력은 jobId만 받음(임의 경로 주입 차단). inputPath는 jobs 레지스트리의 proxyPath/outputPath만 사용.

import { NextResponse } from "next/server";
import { existsSync, statSync, mkdirSync, copyFileSync, createReadStream } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { ReadStream } from "node:fs";
import { getJob } from "@/lib/ingest/jobs";
import { runDirector } from "@/lib/director/pipeline";
import {
  executeMany,
  concatClipsWithTransitions,
  type ClipSegmentInput,
} from "@/lib/core/action-executor";
import { validateActions } from "@/lib/core/action-validator";
import type { Action, BgmAction, Footage, TransitionAction } from "@/lib/core/action-types";
import type { ClipMeta } from "@/lib/core/clip-meta";
import { rendersDir } from "@/lib/core/paths";
import { probe } from "@/lib/ingest/ffmpeg";
import { serializeFcpXml } from "@/lib/core/fcp-xml-serializer";
import { loadProject } from "@/lib/core/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10분 — 긴 영상 요약 생성(LLM 디렉터)+렌더 대비

interface RenderBody {
  intent?: string;
  prefer?: "auto" | "claude-cli" | "local-oss";
  skipTranscribe?: boolean;
  /** Director를 우회하고 외부에서 finalActions를 주입 (테스트/UI 미리 합의된 액션). */
  injectActions?: unknown;
  /** Export format: "mp4" (default) | "fcpxml" */
  format?: "mp4" | "fcpxml";
  /** UI에서 전달한 멀티클립 리스트. 존재 시 project.json clips 폴백을 덮어쓴다(회귀 없음). */
  clips?: ClipMeta[];
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  const job = getJob(id);
  if (!job) return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  if (job.stage !== "done") {
    return NextResponse.json(
      { ok: false, error: `job not ready (stage=${job.stage})` },
      { status: 409 },
    );
  }
  const inputPath = job.proxyPath ?? job.outputPath;
  if (!inputPath || !existsSync(inputPath)) {
    return NextResponse.json(
      { ok: false, error: "job has no usable inputPath" },
      { status: 409 },
    );
  }

  let body: RenderBody = {};
  try {
    body = (await req.json()) as RenderBody;
  } catch {
    /* allow empty body */
  }

  // injectActions 분기 — 존재하면 director 우회 후 주입 액션을 직접 렌더.
  // 미존재(undefined) 시 기존 director 경로 그대로 유지(회귀 금지).
  const hasInject = Object.prototype.hasOwnProperty.call(body, "injectActions");
  if (hasInject) {
    if (!Array.isArray(body.injectActions)) {
      return NextResponse.json(
        { ok: false, error: "injectActions must be an array" },
        { status: 400 },
      );
    }
    return handleInjectActions(id, inputPath, body.injectActions as Action[], body.format, body.clips);
  }

  try {
    // 1) Director 호출 → finalActions
    const director = await runDirector({
      inputPath,
      intent: body.intent,
      prefer: body.prefer ?? "auto",
      skipTranscribe: body.skipTranscribe ?? false,
    });

    const actions = director.finalActions;

    // 2) probe로 footage 메타 보강
    const meta = await probe(inputPath);
    const footage: Footage = {
      id: id,
      path: inputPath,
      durationMs: meta?.durationMs ?? director.signals.meta.durationMs ?? 0,
      width: meta?.width ?? director.signals.meta.width ?? 0,
      height: meta?.height ?? director.signals.meta.height ?? 0,
    };

    // 3) 액션 실행. 디렉터가 적용할 편집이 없으면(시그널 0건 등) 원본을 그대로
    //    통과시켜 항상 결과물을 보장한다 — 빈 액션으로 렌더 전체를 실패시키지 않는다.
    let renderSource: string;
    let appliedActionIds: string[] = [];
    let failedActionIds: string[] = [];
    let warnings: { actionId: string; reason: string }[] = [];
    if (actions.length === 0) {
      renderSource = inputPath;
      warnings = [
        { actionId: "", reason: "director produced no actions — passthrough (no edits applied)" },
      ];
    } else {
      const exec = await executeMany(actions, footage);
      if (!exec.ok || !exec.lastOutput || !existsSync(exec.lastOutput)) {
        return NextResponse.json(
          {
            ok: false,
            error: "render failed",
            exec,
            director,
          },
          { status: 500 },
        );
      }
      renderSource = exec.lastOutput;
      appliedActionIds = exec.appliedActionIds;
      failedActionIds = exec.failedActionIds;
      warnings = exec.warnings ?? [];
    }

    // 4) 최종 산출물을 finals/ 디렉토리로 복사해 안정 경로 제공
    const finalsDir = resolvePath(rendersDir(), "finals");
    if (!existsSync(finalsDir)) mkdirSync(finalsDir, { recursive: true });
    const finalPath = resolvePath(finalsDir, `${id}.mp4`);
    copyFileSync(renderSource, finalPath);
    const sizeBytes = statSync(finalPath).size;

    return NextResponse.json({
      ok: true,
      jobId: id,
      finalPath,
      sizeBytes,
      appliedActionIds,
      failedActionIds,
      warnings,
      llmProvider: director.llm?.provider ?? null,
      llmAttempts: director.llm?.attempts ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// injectActions 경로 — director 우회하고 외부에서 합의된 Action[]를 직접 렌더.
// 빈 배열은 director 미실행 passthrough(원본을 그대로 finals/{id}.mp4로 복사)와 동일하게 처리.
// 검증 실패 시 422, 렌더 실패 시 500. 성공 시 director 경로와 동일한 응답 형태 + llmProvider:null.
// format=fcpxml이면 렌더링 대신 FCP XML 시리얼라이즈 후 응답.
async function handleInjectActions(
  id: string,
  inputPath: string,
  actions: Action[],
  format?: "mp4" | "fcpxml",
  bodyClips?: ClipMeta[],
): Promise<Response> {
  try {
    // 1) probe로 footage 메타 보강. director 미실행이므로 fallback은 jobs 레지스트리뿐.
    //    probe가 실패하면 0으로 두되, validation은 footage.durationMs 비교만 부분 사용한다.
    const meta = await probe(inputPath);
    const job = getJob(id);
    void job; // jobs 레지스트리에는 현재 영상 width/height/duration이 저장돼 있지 않음(인제스트 잡 메타만 보유).
    const footage: Footage = {
      id,
      path: inputPath,
      durationMs: meta?.durationMs ?? 0,
      width: meta?.width ?? 0,
      height: meta?.height ?? 0,
    };

    // 1.5) FCP XML 익스포트 분기 (렌더 미실행)
    if (format === "fcpxml") {
      const xml = serializeFcpXml(actions, footage, { projectName: `MyMovie-${id}` });
      return new Response(xml, {
        status: 200,
        headers: {
          "Content-Type": "application/xml",
          "Content-Disposition": `attachment; filename="mymovie-${id}.fcpxml"`,
        },
      });
    }

    // 2) 액션 검증
    const validation = validateActions(actions, footage);
    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, error: "action validation failed", validation },
        { status: 422 },
      );
    }

    // 2.5) P2-2 멀티클립 합성 — project.json에 clips[]가 2개 이상이면 멀티클립 경로.
    //      clips.length===1(또는 미존재) 시 기존 단일클립 경로 유지(회귀 금지).
    const project = loadProject(id);
    const clipMetas: ClipMeta[] =
      bodyClips && bodyClips.length > 0 ? bodyClips : (project?.clips ?? []);
    const isMulti = clipMetas.length > 1;
    let renderSource: string;
    let appliedActionIds: string[] = [];
    let failedActionIds: string[] = [];
    let warnings: { actionId: string; reason: string }[] = [];

    if (isMulti) {
      const multi = await runMultiClipRender(id, clipMetas, actions);
      if (!multi.ok || !multi.finalPath) {
        return NextResponse.json(
          { ok: false, error: multi.error ?? "multi-clip render failed", warnings: multi.warnings },
          { status: 500 },
        );
      }
      renderSource = multi.finalPath;
      appliedActionIds = multi.appliedActionIds;
      failedActionIds = multi.failedActionIds;
      warnings = multi.warnings;
    } else if (actions.length === 0) {
      renderSource = inputPath;
      warnings = [
        { actionId: "", reason: "injectActions empty — passthrough (no edits applied)" },
      ];
    } else {
      const exec = await executeMany(actions, footage);
      if (!exec.ok || !exec.lastOutput || !existsSync(exec.lastOutput)) {
        return NextResponse.json(
          { ok: false, error: "render failed", exec },
          { status: 500 },
        );
      }
      renderSource = exec.lastOutput;
      appliedActionIds = exec.appliedActionIds;
      failedActionIds = exec.failedActionIds;
      warnings = exec.warnings ?? [];
    }

    // 4) finals/{id}.mp4 복사
    const finalsDir = resolvePath(rendersDir(), "finals");
    if (!existsSync(finalsDir)) mkdirSync(finalsDir, { recursive: true });
    const finalPath = resolvePath(finalsDir, `${id}.mp4`);
    copyFileSync(renderSource, finalPath);
    const sizeBytes = statSync(finalPath).size;

    return NextResponse.json({
      ok: true,
      jobId: id,
      finalPath,
      sizeBytes,
      appliedActionIds,
      failedActionIds,
      warnings,
      llmProvider: null,
      llmAttempts: [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// P2-2 — clips[0..N]을 transition(xfade)으로 연결한 후 BGM을 최상위 레이어로 합성한다.
// 클립별 액션(cut/trim/reframe/caption/imageOverlay/speed/opacity/transform)은 각 클립에
// scope하여 executeMany 처리하고, transition·bgm은 글로벌로 분리하여 concat 단계에서 적용.
async function runMultiClipRender(
  primaryJobId: string,
  clipMetas: { jobId: string; title: string }[],
  actions: Action[],
): Promise<{
  ok: boolean;
  finalPath?: string;
  appliedActionIds: string[];
  failedActionIds: string[];
  warnings: { actionId: string; reason: string }[];
  error?: string;
}> {
  const warnings: { actionId: string; reason: string }[] = [];
  const appliedActionIds: string[] = [];
  const failedActionIds: string[] = [];

  // 클립별 input/footage 해석.
  const perClipFootage = new Map<string, Footage>();
  for (const meta of clipMetas) {
    const job = getJob(meta.jobId);
    const cInput = job?.proxyPath ?? job?.outputPath;
    if (!cInput || !existsSync(cInput)) {
      return {
        ok: false,
        appliedActionIds,
        failedActionIds,
        warnings,
        error: `clip ${meta.jobId} has no usable inputPath`,
      };
    }
    const m = await probe(cInput);
    perClipFootage.set(meta.jobId, {
      id: meta.jobId,
      path: cInput,
      durationMs: m?.durationMs ?? 0,
      width: m?.width ?? 0,
      height: m?.height ?? 0,
    });
  }

  // 글로벌 vs 클립-스코프 액션 분할.
  const transitions = actions.filter((a): a is TransitionAction => a.type === "transition");
  const bgms = actions.filter((a): a is BgmAction => a.type === "bgm");
  const clipScoped = actions.filter((a) => a.type !== "transition" && a.type !== "bgm");

  // 각 클립별 액션 실행 → 클립별 lastOutput 산출.
  const segments: ClipSegmentInput[] = [];
  for (const meta of clipMetas) {
    const footage = perClipFootage.get(meta.jobId)!;
    const scoped = clipScoped.filter((a) => {
      // bgm/transition은 위에서 제외. 나머지 액션은 모두 clipId 필드를 가진다.
      const anyA = a as { clipId?: string };
      return anyA.clipId === meta.jobId;
    });
    if (scoped.length === 0) {
      segments.push({ clipId: meta.jobId, path: footage.path });
      continue;
    }
    const exec = await executeMany(scoped, footage);
    appliedActionIds.push(...exec.appliedActionIds);
    failedActionIds.push(...exec.failedActionIds);
    if (exec.warnings) warnings.push(...exec.warnings);
    if (!exec.ok || !exec.lastOutput) {
      return {
        ok: false,
        appliedActionIds,
        failedActionIds,
        warnings,
        error: `clip ${meta.jobId} per-clip render failed`,
      };
    }
    segments.push({ clipId: meta.jobId, path: exec.lastOutput });
  }

  // 연결 (transition 또는 hard cut).
  const concatOutDir = resolvePath(rendersDir(), `multi_${primaryJobId.slice(0, 8)}`);
  const concat = await concatClipsWithTransitions(segments, transitions, concatOutDir);
  warnings.push(...concat.warnings);
  if (concat.errors.length > 0) {
    return {
      ok: false,
      appliedActionIds,
      failedActionIds,
      warnings,
      error: `concat failed: ${concat.errors.map((e) => e.reason).join("; ")}`,
    };
  }
  appliedActionIds.push(...concat.appliedTransitionIds);
  if (!concat.lastOutput) {
    return {
      ok: false,
      appliedActionIds,
      failedActionIds,
      warnings,
      error: "concat produced no output",
    };
  }

  let finalPath = concat.lastOutput;

  // BGM은 합성본 위에 별도 layer로 적용 (transition·trim/cut 등 클립 스코프 액션 이후).
  if (bgms.length > 0) {
    const bgmMeta = await probe(finalPath);
    const bgmFootage: Footage = {
      id: primaryJobId,
      path: finalPath,
      durationMs: bgmMeta?.durationMs ?? 0,
      width: bgmMeta?.width ?? 0,
      height: bgmMeta?.height ?? 0,
    };
    const bgmExec = await executeMany(bgms, bgmFootage);
    appliedActionIds.push(...bgmExec.appliedActionIds);
    failedActionIds.push(...bgmExec.failedActionIds);
    if (bgmExec.warnings) warnings.push(...bgmExec.warnings);
    if (bgmExec.ok && bgmExec.lastOutput) finalPath = bgmExec.lastOutput;
  }

  return {
    ok: true,
    finalPath,
    appliedActionIds,
    failedActionIds,
    warnings,
  };
}

// GET /api/render/[id]
// 최종 렌더된 mp4를 스트리밍 응답한다.
// ?download=1 → Content-Disposition: attachment.
// 보안: id 외 경로 입력 없음 — finals/{id}.mp4 만 lookup.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || typeof id !== "string" || /[/\\]/.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  const finalPath = resolvePath(rendersDir(), "finals", `${id}.mp4`);
  if (!existsSync(finalPath)) {
    return NextResponse.json({ error: "not found", jobId: id }, { status: 404 });
  }
  const size = statSync(finalPath).size;
  const url = new URL(req.url);
  const isDownload = url.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Content-Length": String(size),
    "Accept-Ranges": "none",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
  if (isDownload) {
    headers["Content-Disposition"] = `attachment; filename="mymovie-${id}.mp4"`;
  }
  const nodeStream: ReadStream = createReadStream(finalPath);
  // Node ReadStream → Web ReadableStream 변환 (Next.js 15+ runtime).
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        const buf =
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        controller.enqueue(buf);
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
  return new Response(webStream, { status: 200, headers });
}

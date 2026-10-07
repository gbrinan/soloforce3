import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
// CLAUDE_PATH가 있으면 그것을, 없으면 homebrew 기본 경로(현행 앱 동작과 동일).
const CLAUDE_BIN = process.env.CLAUDE_PATH || "/opt/homebrew/bin/claude";
// 앱 AI 호출 usage/cost를 집계할 호스트 엔드포인트. 미설정 시 로컬 코어 기본 포트.
const AI_USAGE_URL = process.env.MYCREW_AI_USAGE_URL ||
    `${process.env.MYCREW_API_URL || "http://localhost:3457"}/api/ai-usage`;
export const DEFAULT_TIMEOUT_MS = 60_000;
// ── 레이트리밋 일원화 ────────────────────────────────────────────────────────
// 모든 앱 AI 호출이 이 공유 클라이언트를 거치므로, 여기서 동시성·호출간격을 제한하면
// 각 앱 프로세스의 Claude 구독 남용(폭주 스폰)을 중앙에서 막는다.
// (앱 간 합산 한도는 호스트 게이트웨이 몫 — 프로세스별 상한은 여기서 강제.)
const MAX_CONCURRENT = Math.max(1, Number(process.env.MYCREW_AI_MAX_CONCURRENT) || 4);
const MIN_INTERVAL_MS = Math.max(0, Number(process.env.MYCREW_AI_MIN_INTERVAL_MS) || 0);
let active = 0;
let lastStart = 0;
const waiters = [];
async function acquireSlot() {
    if (active >= MAX_CONCURRENT) {
        await new Promise((resolve) => waiters.push(resolve));
    }
    active++;
    if (MIN_INTERVAL_MS > 0) {
        const wait = lastStart + MIN_INTERVAL_MS - Date.now();
        if (wait > 0)
            await new Promise((r) => setTimeout(r, wait));
        lastStart = Date.now();
    }
}
function releaseSlot() {
    active--;
    const next = waiters.shift();
    if (next)
        next();
}
/** usage/cost를 호스트로 fire-and-forget 보고 (실패는 무시 — AI 호출 자체를 막지 않음). */
function reportUsage(appId, feature, r) {
    if (r.costUsd == null && !r.usage)
        return;
    try {
        void fetch(AI_USAGE_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                appId: appId ?? "unknown",
                feature: feature ?? null,
                model: r.model ?? null,
                costUsd: r.costUsd ?? null,
                usage: r.usage ?? null,
                durationMs: r.durationMs ?? null,
                at: new Date().toISOString(),
            }),
        }).catch(() => { });
    }
    catch {
        /* 집계 실패는 무시 */
    }
}
/**
 * Claude CLI를 --output-format json으로 실행하고 텍스트+usage+cost를 반환한다.
 * execFile은 argv를 직접 전달하므로 셸 인젝션 위험이 없다.
 */
export async function runClaudeDetailed(prompt, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // 게이트웨이 모드: MYCREW_AI_GATEWAY_URL이 설정되면 로컬 claude 스폰 대신 호스트로 위임한다.
    // 인증·합산 레이트리밋·비용집계가 호스트 한 곳에서 강제된다(비용은 호스트가 기록하므로 여기선 미보고).
    const gatewayUrl = process.env.MYCREW_AI_GATEWAY_URL;
    if (gatewayUrl) {
        const appId = options.appId ?? process.env.MYCREW_APP_ID;
        const token = process.env.MYCREW_AI_GATEWAY_TOKEN;
        const res = await fetch(gatewayUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(token ? { "x-mycrew-ai-token": token } : {}),
            },
            body: JSON.stringify({
                prompt, model: options.model, systemPrompt: options.systemPrompt,
                appId, feature: options.feature, timeoutMs,
                allowedTools: options.allowedTools, disallowedTools: options.disallowedTools,
                maxTurns: options.maxTurns, permissionMode: options.permissionMode,
                provider: options.provider,
            }),
            signal: AbortSignal.timeout(timeoutMs + 5_000),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(`AI gateway ${res.status}: ${t.slice(0, 200)}`);
        }
        const data = (await res.json());
        return {
            text: data.text ?? "",
            costUsd: data.costUsd,
            usage: data.usage,
            model: data.model,
            durationMs: data.durationMs,
        };
    }
    const args = ["-p", prompt, "--output-format", "json"];
    if (options.model)
        args.push("--model", options.model);
    if (options.systemPrompt)
        args.push("--append-system-prompt", options.systemPrompt);
    if (options.maxTurns)
        args.push("--max-turns", String(options.maxTurns));
    if (options.permissionMode)
        args.push("--permission-mode", options.permissionMode);
    if (options.disallowedTools?.length)
        args.push("--disallowedTools", options.disallowedTools.join(","));
    if (options.allowedTools?.length)
        args.push("--allowedTools", options.allowedTools.join(","));
    await acquireSlot();
    let stdout, stderr;
    try {
        ({ stdout, stderr } = await execFileAsync(CLAUDE_BIN, args, {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
        }));
    }
    finally {
        releaseSlot();
    }
    if (stderr?.trim()) {
        console.warn("[ai-client] stderr:", stderr.trim());
    }
    const raw = stdout.trim();
    let result;
    try {
        const env = JSON.parse(raw);
        result = {
            text: (env.result ?? "").trim(),
            costUsd: env.total_cost_usd,
            durationMs: env.duration_ms,
            sessionId: env.session_id,
            model: env.model,
            usage: env.usage
                ? {
                    inputTokens: env.usage.input_tokens,
                    outputTokens: env.usage.output_tokens,
                    cacheReadTokens: env.usage.cache_read_input_tokens,
                    cacheCreateTokens: env.usage.cache_creation_input_tokens,
                }
                : undefined,
        };
    }
    catch {
        // --output-format json이 아닌 출력(구버전 등)일 경우 원문을 텍스트로 취급.
        result = { text: raw };
    }
    // appId 미지정 시 앱 프로세스 환경변수(MYCREW_APP_ID)로 폴백 → 호출부 수정 없이 앱별 귀속.
    const appId = options.appId ?? process.env.MYCREW_APP_ID;
    if (options.reportCost !== false)
        reportUsage(appId, options.feature, result);
    return result;
}
/**
 * 하위 호환 래퍼: 기존 호출부(`runClaude(prompt, timeoutMs)`)가 그대로 동작하도록
 * 최종 텍스트(string)만 반환한다. 내부적으로는 json 실행이라 usage/cost가 집계된다.
 * 두 번째 인자로 옵션 객체도 허용한다(모델/appId/feature 지정용).
 */
export async function runClaude(prompt, timeoutMsOrOptions = DEFAULT_TIMEOUT_MS) {
    const options = typeof timeoutMsOrOptions === "number"
        ? { timeoutMs: timeoutMsOrOptions }
        : timeoutMsOrOptions;
    const r = await runClaudeDetailed(prompt, options);
    return r.text;
}
/**
 * 스트리밍 생성 — 게이트웨이 전용(SSE). onText로 텍스트 델타를 실시간 수신하고
 * 완료 시 전체 결과를 반환한다. 게이트웨이 미설정 환경에서는 runClaudeDetailed로 폴백(스트리밍 없음).
 */
export async function runClaudeStream(prompt, onText, options = {}) {
    const gatewayUrl = process.env.MYCREW_AI_GATEWAY_URL;
    if (!gatewayUrl)
        return runClaudeDetailed(prompt, options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const token = process.env.MYCREW_AI_GATEWAY_TOKEN;
    const res = await fetch(`${gatewayUrl.replace(/\/$/, "")}/stream`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(token ? { "x-mycrew-ai-token": token } : {}),
        },
        body: JSON.stringify({
            prompt, model: options.model, systemPrompt: options.systemPrompt,
            appId: options.appId ?? process.env.MYCREW_APP_ID, timeoutMs,
            provider: options.provider,
        }),
        signal: AbortSignal.timeout(timeoutMs + 10_000),
    });
    if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error(`AI gateway stream ${res.status}: ${t.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let final = { text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine)
                continue;
            let ev;
            try {
                ev = JSON.parse(dataLine.slice(5).trim());
            }
            catch {
                continue;
            }
            if (ev.error)
                throw new Error(ev.error);
            if (ev.delta)
                onText(ev.delta);
            if (ev.done)
                final = { text: ev.text ?? "", costUsd: ev.costUsd, usage: ev.usage, model: ev.model, durationMs: ev.durationMs };
        }
    }
    return final;
}
/** Claude 응답에서 JSON 추출 (코드펜스/전후 설명 텍스트 허용). */
export function extractJson(raw) {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence)
        text = fence[1].trim();
    try {
        return JSON.parse(text);
    }
    catch {
        // fall through
    }
    const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
    if (starts.length === 0)
        return null;
    const start = Math.min(...starts);
    const endChar = text[start] === "{" ? "}" : "]";
    const end = text.lastIndexOf(endChar);
    if (end <= start)
        return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    }
    catch {
        return null;
    }
}
/** exec 에러를 사람이 읽을 메시지로 변환 (타임아웃 구분). */
export function claudeErrorDetail(err, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const e = err;
    const isTimeout = e.killed || e.code === "ETIMEDOUT";
    return isTimeout
        ? `Claude timed out after ${timeoutMs / 1000}s`
        : (e.message ?? String(e));
}
/** HTML 본문에서 태그를 제거해 프롬프트용 텍스트로 변환. */
export function stripHtml(input) {
    return input
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s{2,}/g, " ")
        .trim();
}

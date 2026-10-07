// OpenTelemetry GenAI 시맨틱 컨벤션 스팬 발행기 — 경량 자체 구현 (외부 의존성 0)
// https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
// OTLP/HTTP JSON 형식으로 직렬화해:
//   (1) 항상 ${HISTORY_DIR}/otel-spans.jsonl에 스팬당 1줄 append (각 줄이 완전한 OTLP envelope)
//   (2) OTEL_EXPORTER_OTLP_ENDPOINT 설정 시 ${endpoint}/v1/traces로 fire-and-forget POST
// 호출 경로에 절대 throw하지 않는다 — 모든 공개 API는 try/catch로 감쌈 (에이전트 실행 무영향).
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

// ─── OTLP JSON 타입 (필요 최소한만) ───

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean };
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // 1 = SPAN_KIND_INTERNAL (CLI 서브프로세스 호출이라 INTERNAL로 통일)
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code?: number; message?: string }; // 1=OK, 2=ERROR
}

export interface AgentSpanEndResult {
  success: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  errorMessage?: string;
}

export interface AgentSpanHandle {
  traceId: string;
  spanId: string;
  addToolSpan(toolName: string, detail?: string): void;
  end(result: AgentSpanEndResult): void;
}

// ─── 헬퍼 ───

function attr(key: string, value: string | number | boolean): OtlpAttribute {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  // OTLP JSON에서 int64는 문자열로 직렬화 (protobuf JSON 매핑 규칙)
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  return { key, value: { doubleValue: value } };
}

function nowNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

function envelope(spans: OtlpSpan[]): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "mycrew")] },
        scopeSpans: [{ scope: { name: "mycrew.otel-trace", version: "1.0.0" }, spans }],
      },
    ],
  };
}

// ─── 버퍼링 + 플러시 (5초 주기 또는 20스팬 도달 시) ───

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB 초과 시 .1로 로테이션
const SPANS_FILE = join(HISTORY_DIR, "otel-spans.jsonl");

const buffer: OtlpSpan[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushOtelSpans();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref(); // 프로세스 종료를 막지 않음
}

function enqueue(span: OtlpSpan): void {
  buffer.push(span);
  ensureFlushTimer();
  if (buffer.length >= FLUSH_THRESHOLD) void flushOtelSpans();
}

// 50MB 초과 시 otel-spans.jsonl → otel-spans.jsonl.1 (기존 .1은 덮어씀)
function rotateIfNeeded(): void {
  try {
    const st = statSync(SPANS_FILE);
    if (st.size > MAX_FILE_BYTES) renameSync(SPANS_FILE, `${SPANS_FILE}.1`);
  } catch {
    /* 파일 없음 등 — 무시 */
  }
}

/** 버퍼된 스팬을 즉시 내보냄 (테스트용으로도 export). 절대 throw하지 않음. */
export async function flushOtelSpans(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);

  // (1) JSONL append — 스팬당 1줄, 각 줄이 완전한 OTLP envelope
  try {
    mkdirSync(HISTORY_DIR, { recursive: true });
    rotateIfNeeded();
    const lines = batch.map((s) => JSON.stringify(envelope([s]))).join("\n") + "\n";
    appendFileSync(SPANS_FILE, lines, "utf-8");
  } catch (err) {
    console.warn(`[otel] 스팬 파일 기록 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  // (2) OTLP/HTTP POST — fire-and-forget (실패해도 호출자에 영향 없음)
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint) {
    try {
      fetch(`${endpoint.replace(/\/+$/, "")}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope(batch)),
        signal: AbortSignal.timeout(5_000),
      }).catch((err) => {
        console.warn(`[otel] OTLP export 실패: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (err) {
      console.warn(`[otel] OTLP export 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── 공개 API ───

/**
 * 에이전트 호출(invoke_agent) 스팬 시작.
 * 반환된 핸들의 모든 메서드는 내부 try/catch로 절대 throw하지 않음 — 호출 경로 안전.
 */
export function startAgentSpan(opts: {
  agentName: string;
  agentRole: string;
  taskId: string;
  model?: string;
}): AgentSpanHandle {
  const traceId = newTraceId();
  const spanId = newSpanId();
  const startNano = nowNano();
  let ended = false;

  return {
    traceId,
    spanId,
    addToolSpan(toolName: string, detail?: string): void {
      try {
        // 스트림에서 tool 종료 시각은 관측 불가(tool_result와의 매칭 없음)
        // — start=end=now인 0-duration 스팬으로 "도구가 호출됐다"는 사실만 기록.
        const now = nowNano();
        const attrs: OtlpAttribute[] = [
          attr("gen_ai.operation.name", "execute_tool"),
          attr("gen_ai.tool.name", toolName),
        ];
        if (detail) attrs.push(attr("mycrew.tool.detail", detail.slice(0, 200)));
        enqueue({
          traceId,
          spanId: newSpanId(),
          parentSpanId: spanId,
          name: `execute_tool ${toolName}`,
          kind: 1,
          startTimeUnixNano: now,
          endTimeUnixNano: now,
          attributes: attrs,
          status: {},
        });
      } catch {
        /* 스팬 실패 무시 — 호출 경로 보호 */
      }
    },
    end(result: AgentSpanEndResult): void {
      try {
        if (ended) return; // 이중 종료 방지 (재시도 루프 안전장치)
        ended = true;
        const attrs: OtlpAttribute[] = [
          attr("gen_ai.operation.name", "invoke_agent"),
          attr("gen_ai.agent.name", opts.agentName),
          attr("gen_ai.agent.description", opts.agentRole),
          attr("mycrew.task.id", opts.taskId),
        ];
        if (opts.model) attrs.push(attr("gen_ai.request.model", opts.model));
        if (typeof result.inputTokens === "number") attrs.push(attr("gen_ai.usage.input_tokens", result.inputTokens));
        if (typeof result.outputTokens === "number") attrs.push(attr("gen_ai.usage.output_tokens", result.outputTokens));
        if (typeof result.cacheReadTokens === "number") attrs.push(attr("gen_ai.usage.cached_input_tokens", result.cacheReadTokens));
        if (typeof result.costUsd === "number") attrs.push(attr("mycrew.cost.usd", result.costUsd));
        if (!result.success && result.errorMessage) attrs.push(attr("error.type", result.errorMessage.slice(0, 200)));
        enqueue({
          traceId,
          spanId,
          name: `invoke_agent ${opts.agentName}`,
          kind: 1,
          startTimeUnixNano: startNano,
          endTimeUnixNano: nowNano(),
          attributes: attrs,
          status: result.success
            ? { code: 1 }
            : { code: 2, message: result.errorMessage?.slice(0, 500) ?? "unknown error" },
        });
      } catch {
        /* 스팬 실패 무시 — 호출 경로 보호 */
      }
    },
  };
}

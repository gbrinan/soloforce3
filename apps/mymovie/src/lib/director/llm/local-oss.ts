// Local OSS LLM Provider — Ollama HTTP API.
// 100% 로컬, 외부 전송 0, 완전 무료. 기본 모델 llama3.1, env로 오버라이드 가능.

import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

const DEFAULT_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.1";
const REQUEST_TIMEOUT_MS = 120_000; // 로컬 추론 — CPU 환경 고려해 넉넉히.

export class LocalOSSLLMProvider implements LLMProvider {
  private readonly host: string;
  private readonly model: string;

  constructor(opts?: { host?: string; model?: string }) {
    this.host = opts?.host || DEFAULT_HOST;
    this.model = opts?.model || DEFAULT_MODEL;
  }

  name(): "local-oss" {
    return "local-oss";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const res = await fetch(`${this.host}/api/tags`, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      if (!Array.isArray(data.models) || data.models.length === 0) return false;
      // 모델 강제 매칭은 하지 않음 — 사용자가 다른 모델 받았을 수 있음.
      return true;
    } catch {
      return false;
    }
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          options: {
            temperature: 0.2,
            // JSON 구조 따르도록 낮은 온도.
          },
        }),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const text = data.message?.content ?? "";
      if (!text) throw new Error("Ollama returned empty content");
      return {
        text,
        provider: "local-oss",
        durationMs: Date.now() - started,
      };
    } catch (e) {
      clearTimeout(t);
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(`Ollama request timed out (${REQUEST_TIMEOUT_MS}ms)`);
      }
      throw e;
    }
  }
}

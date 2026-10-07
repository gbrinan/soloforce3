// LLM Router — primary(Claude CLI) 실패 시 fallback(Local OSS) 자동 전환.

import { ClaudeCodeCLIProvider } from "./claude-cli";
import { LocalOSSLLMProvider } from "./local-oss";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMRouterOptions,
  ProviderPreference,
} from "./types";

export interface RouterCallResult extends LLMResponse {
  /** 어떤 provider가 시도되었는지 순서대로 */
  attempts: Array<{ provider: "claude-cli" | "local-oss"; ok: boolean; error?: string }>;
}

export class LLMRouter {
  private readonly claude: LLMProvider;
  private readonly local: LLMProvider;

  constructor(opts?: { claude?: LLMProvider; local?: LLMProvider }) {
    this.claude = opts?.claude ?? new ClaudeCodeCLIProvider();
    this.local = opts?.local ?? new LocalOSSLLMProvider();
  }

  async generate(req: LLMRequest, opts?: LLMRouterOptions): Promise<RouterCallResult> {
    const prefer: ProviderPreference = opts?.prefer ?? "auto";
    const order = this.resolveOrder(prefer);
    const attempts: RouterCallResult["attempts"] = [];

    for (const provider of order) {
      const available = await provider.isAvailable();
      if (!available) {
        attempts.push({
          provider: provider.name(),
          ok: false,
          error: "provider not available",
        });
        continue;
      }
      try {
        const res = await provider.generate(req);
        attempts.push({ provider: provider.name(), ok: true });
        return { ...res, attempts };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        attempts.push({ provider: provider.name(), ok: false, error: msg });
        // 강제 선택 모드면 다음 provider로 fallback 하지 않음.
        if (prefer !== "auto") {
          throw new Error(
            `LLMRouter[${provider.name()}] generate failed and fallback disabled: ${msg}`,
          );
        }
      }
    }
    throw new Error(
      `LLMRouter: all providers failed. attempts=${JSON.stringify(attempts)}`,
    );
  }

  private resolveOrder(prefer: ProviderPreference): LLMProvider[] {
    if (prefer === "claude-cli") return [this.claude];
    if (prefer === "local-oss") return [this.local];
    return [this.claude, this.local];
  }
}

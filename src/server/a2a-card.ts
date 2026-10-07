// A2A(Agent-to-Agent) 프로토콜 Agent Card 빌더
// GET /.well-known/agent.json 응답 생성 — 공개 엔드포인트이므로 시크릿(토큰·경로·권한) 절대 미포함.
// 스펙: https://a2a-protocol.org/latest/specification/ — 0.3.0 필드 형태 사용 (최신 1.0.0과 필드 호환).

export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  preferredTransport: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  securitySchemes: Record<string, { type: string; in: string; name: string; description: string }>;
}

/** 로스터 공개 항목 — id/name/role만. writePaths·토큰·권한 필드는 여기에 절대 넣지 않는다. */
export interface A2ARosterEntry {
  id: string;
  name: string;
  role?: string;
}

/**
 * Agent Card 생성 (순수 함수 — env 주입 가능해 테스트 용이).
 * 공개 URL 결정은 기존 파트너 요청 로직(routes.ts partner-request/send)과 동일:
 * TUNNEL_URL > https://NGROK_URL > http://localhost:PORT 폴백.
 */
export function buildAgentCard(opts: {
  name: string;
  agents: A2ARosterEntry[];
  env?: Record<string, string | undefined>;
  version?: string;
}): A2AAgentCard {
  const env = opts.env ?? process.env;
  const ngrokFixed = env.NGROK_URL ? `https://${env.NGROK_URL}` : "";
  const url = env.TUNNEL_URL || ngrokFixed || `http://localhost:${env.PORT ?? 3456}`;
  return {
    protocolVersion: "0.3.0",
    name: opts.name,
    description: "MyCrew orchestrator instance",
    url,
    version: opts.version ?? "0.0.0",
    preferredTransport: "JSONRPC",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: opts.agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.role ?? "",
      tags: [],
    })),
    securitySchemes: {
      partnerToken: {
        type: "apiKey",
        in: "header",
        name: "x-partner-token",
        description: "MyCrew partner token (파트너 등록 필요)",
      },
    },
  };
}

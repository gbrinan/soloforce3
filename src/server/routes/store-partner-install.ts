import { Hono } from "hono";
import { findPartnerByInboundToken } from "../partners.js";
import { createApproval } from "../approvals.js";

// NOTE: 이 라우터는 index.ts에서 "/api/external"에 마운트되며 실제 경로는 POST /api/external/store-install이다.
// routes.ts의 "/api/external/*" 사장님 인증 게이트(X-Approval-Token/Authorization Bearer 요구)를 그대로 통과하면
// partnerToken 요청이 401로 막히므로, 이 라우트는 partner.inboundToken 전용 인증 경로로 게이트 예외 목록에 추가해야 한다
// (routes.ts의 excluded path 목록에 "/api/external/store-install" 추가, /inbound와 동일한 패턴).
export const storePartnerInstallRoutes = new Hono();

storePartnerInstallRoutes.post("/store-install", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { partnerToken?: string; itemId?: string; kind?: string; source?: string }
    | null;
  if (!body?.partnerToken || !body.itemId || !body.kind) {
    return c.json({ error: "partnerToken, itemId, kind required" }, 400);
  }
  if (body.kind !== "skill" && body.kind !== "plugin" && body.kind !== "app") {
    return c.json({ error: "kind must be skill|plugin|app" }, 400);
  }
  const partner = findPartnerByInboundToken(body.partnerToken);
  if (!partner) return c.json({ error: "unauthorized: invalid partnerToken" }, 401);

  const approval = createApproval({
    agentRole: `partner:${partner.id}`,
    tool: "store-install",
    path: `store-install://${body.kind}/${body.itemId}`,
    reason: `파트너(${partner.companyName ?? partner.id})가 ${body.source ?? "external"}에서 ${body.kind}:${body.itemId} 설치를 요청함`,
  });

  return c.json({ ok: true, approvalId: approval.id, status: approval.status }, 202);
});

// 외부 발송 집행 — 모델은 발송을 "요청"만 하고, 서버가 보관한 내용을 사람 승인 뒤 그대로 보낸다.
// 판정 규칙은 side-effect-gate.ts(순수 함수). 여기서는 보관·승인 연결·실행만 한다.
//
// 흐름: requestExternalAction → createApproval(external) → 사람 승인(텔레그램/디스코드/대시보드)
//      → onApprovalResolved → checkExternalApproval → consumeExternalApproval → 실행
// 서버가 재시작되면 보관 내용이 사라진다. 그 뒤 승인이 와도 아무것도 나가지 않는다(안전한 쪽).
import { consumeExternalApproval, createApproval, onApprovalResolved, type ApprovalRequest } from "./approvals.js";
import { sendExternal } from "./external-client.js";
import { checkExternalApproval, previewHash, formatPreview, type ExternalAction } from "./side-effect-gate.js";

const pending = new Map<string, ExternalAction>();

export interface ExternalRequestResult {
  status: "pending_approval";
  approvalId: string;
}

// @MX:ANCHOR: [AUTO] 외부 발송의 유일한 진입점 — SendToPartner 라우트·회신 마커가 모두 여기로 온다.
// @MX:REASON: 이 함수를 우회하는 발송 경로가 생기면 사람 승인 계약이 깨진다.
export function requestExternalAction(
  action: ExternalAction,
  ctx: { agentRole: string; jobId?: string },
): ExternalRequestResult {
  const hash = previewHash(action);
  const req = createApproval({
    agentRole: ctx.agentRole,
    tool: `External:${action.kind}`,
    path: `${action.kind}:${action.target}`,
    jobId: ctx.jobId,
    reason: formatPreview(action),
    external: true,
    previewHash: hash,
  });
  if (!pending.has(req.id)) pending.set(req.id, action);
  console.log(`[External] 승인 대기: ${req.id.slice(0, 8)} ${action.kind} → ${action.target}`);
  return { status: "pending_approval", approvalId: req.id };
}

async function execute(action: ExternalAction): Promise<{ ok: boolean; detail: string }> {
  const attachments = action.attachments.length ? { attachments: action.attachments } : {};
  const ourLabel = action.meta.ourLabel;
  const r = action.kind === "partner-reply"
    ? await sendExternal(action.target, action.body, {
      inReplyToMessageId: action.meta.inReplyTo, messageType: "reply", ourLabel, ...attachments,
    })
    : await sendExternal(action.target, action.body, {
      messageType: (action.meta.messageType as "request" | "notification" | "token_update" | undefined) ?? "request",
      ourLabel, ...attachments,
    });
  return r.ok ? { ok: true, detail: `messageId=${r.messageId}` } : { ok: false, detail: r.errorReason ?? "unknown" };
}

async function onResolved(req: ApprovalRequest): Promise<void> {
  if (!req.external) return;
  const action = pending.get(req.id);
  if (!action) return;
  pending.delete(req.id);
  if (req.status !== "allowed") {
    console.log(`[External] 미발송(${req.status}): ${req.id.slice(0, 8)} ${action.kind} → ${action.target}`);
    return;
  }
  const verdict = checkExternalApproval(req, previewHash(action), Date.now());
  if (!verdict.ok) {
    console.warn(`[External] 발송 거부(${verdict.reason}): ${req.id.slice(0, 8)}`);
    return;
  }
  if (!consumeExternalApproval(req.id)) return;
  const out = await execute(action);
  console.log(`[External] ${out.ok ? "발송 완료" : "발송 실패"}: ${req.id.slice(0, 8)} ${action.kind} → ${action.target} (${out.detail})`);
}

onApprovalResolved(onResolved);

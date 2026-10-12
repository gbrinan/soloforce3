// 외부 발송 집행 — 모델은 발송을 "요청"만 하고, 서버가 보관한 내용을 사람 승인 뒤 그대로 보낸다.
// 판정 규칙은 side-effect-gate.ts(순수 함수). 여기서는 보관·승인 연결·실행만 한다.
//
// 흐름: requestExternalAction → createApproval(external) → 사람 승인(텔레그램/디스코드/대시보드)
//      → onApprovalResolved → checkExternalApproval → consumeExternalApproval → 실행
// 서버가 재시작되면 보관 내용이 사라진다. 그 뒤 승인이 와도 아무것도 나가지 않는다(안전한 쪽).
import { randomUUID } from "node:crypto";
import { consumeExternalApproval, createApproval, onApprovalResolved, type ApprovalRequest } from "./approvals.js";
import { sendExternal } from "./external-client.js";
import { checkExternalApproval, previewHash, formatPreview, type ExternalAction } from "./side-effect-gate.js";

const pending = new Map<string, ExternalAction>();

/** 무인 실행(루프·루틴)에서 들어온 발송 요청 — 승인 카드를 만들지 않고 결과 요약에 보류로만 보인다. */
export interface HeldExternal {
  id: string;
  jobId?: string;
  kind: ExternalAction["kind"];
  target: string;
  /** 본문 첫 줄 — 결과 요약에 한 줄로 보인다. */
  excerpt: string;
  preview: string;
  heldAt: string;
}
const held: HeldExternal[] = [];
const HELD_MAX = 200;

export type ExternalRequestResult =
  | { status: "pending_approval"; approvalId: string }
  | { status: "held"; heldId: string };

// @MX:ANCHOR: [AUTO] 외부 발송의 유일한 진입점 — SendToPartner 라우트·회신 마커가 모두 여기로 온다.
// @MX:REASON: 이 함수를 우회하는 발송 경로가 생기면 사람 승인 계약이 깨진다.
export function requestExternalAction(
  action: ExternalAction,
  ctx: { agentRole: string; jobId?: string; unattended?: boolean; origin?: string },
): ExternalRequestResult {
  const origin = ctx.origin ?? `${ctx.agentRole}${ctx.jobId ? ` (잡 ${ctx.jobId.slice(0, 8)})` : ""}`;
  // 사람이 지켜보지 않는 실행에서 나온 발송은 실행도 승인 요청도 하지 않는다 — 결과 요약에 보류로 남긴다.
  if (ctx.unattended) {
    const item: HeldExternal = {
      id: randomUUID(), jobId: ctx.jobId, kind: action.kind, target: action.target,
      excerpt: (action.body.split("\n").find((l) => l.trim()) ?? "").slice(0, 120),
      preview: formatPreview(action, origin), heldAt: new Date().toISOString(),
    };
    held.push(item);
    if (held.length > HELD_MAX) held.splice(0, held.length - HELD_MAX);
    console.log(`[External] 무인 실행 발송 보류: ${item.id.slice(0, 8)} ${action.kind} → ${action.target} (${origin})`);
    return { status: "held", heldId: item.id };
  }
  const hash = previewHash(action);
  const req = createApproval({
    agentRole: ctx.agentRole,
    tool: `External:${action.kind}`,
    path: `${action.kind}:${action.target}`,
    jobId: ctx.jobId,
    reason: formatPreview(action, origin),
    external: true,
    previewHash: hash,
  });
  if (!pending.has(req.id)) pending.set(req.id, action);
  console.log(`[External] 승인 대기: ${req.id.slice(0, 8)} ${action.kind} → ${action.target}`);
  return { status: "pending_approval", approvalId: req.id };
}

/** 주어진 잡들에서 보류된 외부 발송 — 루프 결과 요약(runner.ts)에 싣는다. */
export function heldForJobs(jobIds: string[]): HeldExternal[] {
  const ids = new Set(jobIds);
  return held.filter((h) => h.jobId && ids.has(h.jobId));
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

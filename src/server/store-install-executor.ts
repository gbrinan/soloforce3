// v1.13 Phase4: 파트너 원격 설치 승인 확정 → 실제 설치 반영 + 파트너 콜백.
// approvals.ts의 tool-agnostic 승인 시스템에 onApprovalResolved 훅으로 연결
// (circular import 회피 — chat.ts의 notifier 바인딩과 동일한 의존성 주입 패턴).
import { onApprovalResolved, type ApprovalRequest } from "./approvals.js";
import { installFromPartner } from "./routes/store-installed.js";
import { getPartner, notifyPartnerInstallResult } from "./partners.js";

function parseStoreInstallPath(path: string): { kind: "skill" | "plugin" | "app"; itemId: string } | null {
  const m = /^store-install:\/\/(skill|plugin|app)\/(.+)$/.exec(path);
  if (!m) return null;
  return { kind: m[1] as "skill" | "plugin" | "app", itemId: m[2] };
}

async function handleStoreInstallResolution(req: ApprovalRequest): Promise<void> {
  if (req.tool !== "store-install") return;
  if (req.status !== "allowed" && req.status !== "denied" && req.status !== "timeout") return;
  const parsed = parseStoreInstallPath(req.path);
  if (!parsed) return;
  const partnerId = req.agentRole.startsWith("partner:") ? req.agentRole.slice("partner:".length) : null;
  if (!partnerId) return;

  const partner = getPartner(partnerId);
  const partnerName = partner?.companyName ?? partnerId;

  if (req.status === "allowed") {
    installFromPartner(parsed.kind, parsed.itemId, partnerId, partnerName);
  }

  notifyPartnerInstallResult(partnerId, {
    approvalId: req.id,
    itemId: parsed.itemId,
    kind: parsed.kind,
    decision: req.status === "allowed" ? "approved" : "rejected",
    reason: req.status === "timeout" ? "approval timed out (20min)" : req.reason,
  });
}

onApprovalResolved(handleStoreInstallResolution);

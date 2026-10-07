// 승인 요청 발생 시 마이크루 비동기 의견 spawn — 5단계 의도 중 3단계 구현
// 사장님 응답 우선(resolveApproval 내부 status 체크가 자동 보장).
// 사장님 무응답 시 55초 후 autoDecideAttempt가 req.genieOpinion 1순위로 적용.

import { runAgent } from "../agent.js";
import { getGenieAgent } from "../agents/genie.js";
import { autoResolveApproval, resolveApproval, type ApprovalRequest } from "./approvals.js";
import { getMyProfile } from "./partners.js";

// 무비용 알림 자동 승인 판정 (approval-policy 위키, 2026-07-16 사장님 지시)
// 3가지 모두 충족해야 자동 allow — 하나라도 미충족이면 null 반환 → 기존 승인 플로우 유지.
//  (1) 순수 알림/뉴스레터/무료 구독 신청 성격
//  (2) 결제·과금·결제수단 등록 없음 (현재도, 향후 전환 유도도 없음)
//  (3) 민감정보 미송신 (.env, 인증서, .ssh, 개인식별정보 등)
export function isFreeNotificationApproval(req: ApprovalRequest): { allow: true; reason: string } | null {
  const reason = (req.reason ?? "").toLowerCase();
  const path = req.path.toLowerCase();

  // (3) 민감 경로/키워드가 요청에 조금이라도 걸리면 즉시 실격 — 경로/사유 모두 검사
  const sensitivePattern = /(\.env|\.ssh|\.aws|\.gnupg|\.kube|\.docker|id_rsa|id_ed25519|id_ecdsa|\.pem|\.p12|\.pfx|주민번호|여권번호|계좌번호|카드번호|password|passwd|secret|api[_-]?key|access[_-]?token|bearer|인증서|개인정보|주민등록)/i;
  if (sensitivePattern.test(path) || sensitivePattern.test(reason)) return null;

  // (2) 결제/과금/결제수단 키워드가 하나라도 있으면 실격
  const paymentPattern = /(결제|과금|유료|월정액|카드\s*등록|결제수단|청구|정기결제|구독료|paid|payment|billing|charge|checkout|credit\s*card|invoice|subscription\s*fee|premium|pro\s*plan)/i;
  if (paymentPattern.test(reason)) return null;

  // (1) 무료 알림/뉴스레터/구독 성격 키워드 — 사유가 명시적으로 알림 신청임을 밝혀야 함
  const notifyPattern = /(무료\s*알림|알림\s*신청|알림\s*설정|알림\s*구독|뉴스레터|newsletter|공지\s*구독|알람\s*신청|소식\s*받기|subscribe(?!\s*fee)|notification\s*sign[- ]?up|free\s*(?:alert|newsletter|notification|subscription))/i;
  if (!notifyPattern.test(reason)) return null;

  return { allow: true, reason: "무비용 알림 자동승인" };
}

export function buildOpinionPrompt(req: ApprovalRequest): string {
  const contextLines = [
    req.jobId ? `작업(Job) ID: ${req.jobId}` : "",
    req.reason ? `워커가 밝힌 사유: ${req.reason}` : "워커가 사유를 적지 않음 (맥락 부족 — 도구·경로만으로 판단)",
  ].filter(Boolean).join("\n");
  return `[승인 의견 요청]

다음 요청이 합당한지 판단하세요.

에이전트: ${req.agentRole}
도구: ${req.tool}
경로: ${req.path}
${contextLines}

판단 기준 (종합적으로 고려):
1. 해당 에이전트가 현재 수행 중인 작업에 이 경로 접근이 필요한가?
2. 작업 수행에 필요한 정당한 요청이면 경로가 민감해도 ALLOW
3. 작업과 무관하거나 권한 변경/시스템 설정 파일은 DENY
4. 읽기(SafeRead/Glob/Grep)는 작업 관련이면 대체로 ALLOW
5. 쓰기(SafeWrite/Edit)는 작업 범위 내인지 확인

형식:
- 승인: 첫 줄에 "ALLOW: <50자 이내 이유>"
- 거부: 첫 줄에 "DENY: <50자 이내 이유>"
- 이유는 짧게 한 줄. 추가 설명 금지. 도구 호출 없이 텍스트로만.`;
}

export function parseOpinion(output: string): { allow: boolean; reason: string } | null {
  const m = output.match(/^\s*(ALLOW|DENY)\s*:\s*(.+?)(?:\n|$)/im);
  if (!m) return null;
  return { allow: m[1].toUpperCase() === "ALLOW", reason: m[2].trim().slice(0, 50) };
}

export async function spawnGenieOpinion(req: ApprovalRequest): Promise<void> {
  try {
    // A안 안전장치: 마이크루(orchestrator) 본인 요청에는 자동 의견 spawn 금지.
    // IS_GENIE 분기로 mcp가 모든 쓰기에 모달 강제하는데, 여기서 자동 ALLOW로 우회되면 무력화.
    if (req.agentRole === "orchestrator") {
      const ownerName = getMyProfile()?.contactName ?? '사용자';
      console.log(`[Approval] orchestrator 요청 — 마이크루 의견 skip (${ownerName} 직접 결정): ${req.path}`);
      return;
    }
    // 무비용 알림 자동승인 — approval-policy 3조건 충족 시 55초 대기 없이 즉시 allow.
    // 미충족(null)이면 아래 지니 에이전트 spawn으로 위임.
    const freeNotify = isFreeNotificationApproval(req);
    if (freeNotify) {
      autoResolveApproval(req.id, true, "auto_rule_free_notify", freeNotify.reason);
      return;
    }
    const taskId = `approval-${req.id.slice(0, 8)}`;
    const result = await runAgent(getGenieAgent(), taskId, buildOpinionPrompt(req), {});
    if (result.cost) {
      const { logCost } = await import("./jobs.js");
      logCost("genie", undefined, result.cost, "genie:approval-opinion");
    }
    if (!result.success) {
      console.warn(`[Approval] 마이크루 의견 spawn 실패: ${result.error}`);
      return;
    }
    const parsed = parseOpinion(result.output ?? "");
    if (!parsed) {
      console.warn(`[Approval] 마이크루 의견 파싱 실패: "${(result.output ?? "").slice(0, 80)}"`);
      return;
    }
    // resolveApproval 내부 status 체크가 사장님 우선 보장 (status !== "pending_chat" 시 무시)
    resolveApproval(req.id, parsed.allow, "genie", parsed.reason);
  } catch (err) {
    console.error(`[Approval] 마이크루 의견 예외:`, err instanceof Error ? err.message : err);
  }
}

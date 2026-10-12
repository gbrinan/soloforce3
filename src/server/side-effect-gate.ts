// 외부 부작용(external 등급) 승인 계약 — 순수 함수만 둔다(테스트 가능, 부작용 없음).
// 규칙(CLAUDE.md «요구사항을 코드로 쓰는 규칙»): external 등급 동작은 사람이 발급한 승인 없이 실행되지 않는다.
//
// 계약:
// - 승인은 미리보기 해시 하나에 묶인다. 내용·대상·첨부가 한 글자라도 바뀌면 다른 해시 → 거부.
// - 사람(decisionSource="user")만 승인할 수 있다. 지니 의견·자동 규칙·반복 이력은 승인으로 치지 않는다.
// - 승인은 한 번만 쓴다. 승인은 만료된다.
// 집행 흐름(서버가 보관한 내용을 그대로 실행)은 external-actions.ts.
import { createHash } from "node:crypto";

export type ExternalKind = "partner-send" | "partner-reply";

export interface ExternalAttachment {
  filename: string;
  mimeType: string;
  size: number;
  /** base64 — 승인 요청 시점에 읽어 고정한다(승인 뒤 파일이 바뀌어도 승인된 내용만 나간다). */
  data: string;
}

export interface ExternalAction {
  kind: ExternalKind;
  /** 받는 쪽 — 파트너 ID 등. */
  target: string;
  body: string;
  attachments: ExternalAttachment[];
  /** 해시에 들어가는 부가 값(messageType, inReplyTo 등). */
  meta: Record<string, string>;
}

/** 승인 대기 → 사람 승인 뒤 실행까지 허용하는 최대 시간. approvals.ts pending TTL과 같다. */
export const EXTERNAL_APPROVAL_TTL_MS = 20 * 60 * 1000;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** 키 순서와 무관한 정규 JSON — 같은 동작이면 같은 해시. */
export function previewHash(a: ExternalAction): string {
  const meta = Object.keys(a.meta).sort().map((k) => [k, a.meta[k]]);
  const atts = a.attachments.map((x) => [x.filename, x.mimeType, x.size, sha256(x.data)]);
  return sha256(JSON.stringify([a.kind, a.target, a.body, atts, meta]));
}

/** 사람이 승인 버튼을 누르기 전에 보는 미리보기. 건수·대상·되돌릴 수 없음을 고정 형식으로 보인다. */
export function formatPreview(a: ExternalAction): string {
  const label = a.kind === "partner-reply" ? "파트너 회신" : "파트너 발송";
  const excerpt = a.body.length > 300 ? `${a.body.slice(0, 300)}…(${a.body.length}자)` : a.body;
  const atts = a.attachments.length
    ? a.attachments.map((x) => `${x.filename}(${x.size}B)`).join(", ")
    : "없음";
  return [
    `[외부 발송 승인] ${label} 1건 → ${a.target}`,
    `첨부: ${atts}`,
    `되돌릴 수 없음: 승인하면 이 내용 그대로 즉시 발송됩니다.`,
    `---`,
    excerpt,
  ].join("\n");
}

export type GateReason = "no_approval" | "not_allowed" | "not_human" | "hash_mismatch" | "expired" | "already_used";
export type GateVerdict = { ok: true } | { ok: false; reason: GateReason };

/** 판정에 필요한 승인 기록의 최소 형태(approvals.ts ApprovalRequest와 호환). */
export interface ApprovalLike {
  status: string;
  decisionSource?: string;
  createdAt: number;
  external?: boolean;
  previewHash?: string;
  consumedAt?: number;
}

export function checkExternalApproval(rec: ApprovalLike | null | undefined, hash: string, now: number): GateVerdict {
  if (!rec || !rec.external) return { ok: false, reason: "no_approval" };
  if (rec.status !== "allowed") return { ok: false, reason: "not_allowed" };
  if (rec.decisionSource !== "user") return { ok: false, reason: "not_human" };
  if (rec.previewHash !== hash) return { ok: false, reason: "hash_mismatch" };
  if (rec.consumedAt) return { ok: false, reason: "already_used" };
  if (now - rec.createdAt > EXTERNAL_APPROVAL_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * 승인 결정 출처가 이 요청에 적용될 수 있는가.
 * external 요청은 사람(user)만 결정한다 — 지니 의견(부재중 즉시 적용 포함)·자동 규칙·재시도 소진은 적용하지 않는다.
 * 거부(deny)는 누가 해도 안전하므로 허용한다.
 */
export function canApplyDecision(external: boolean | undefined, source: string, allow: boolean): boolean {
  if (!external) return true;
  if (!allow) return true;
  return source === "user";
}

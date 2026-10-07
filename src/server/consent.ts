// Consent backend — PIPA-compliant consent recording.
// Records user consent with IP, timestamp, and per-item granularity (필수/선택 분리).
// Access log retention: 1 year per PIPA §29.
// API contract: see history/outputs/linus/b2b-api-contract_linus_2026-06-26.md

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_DIR } from "../config.js";
import { TERMS_DOC, PRIVACY_DOC, MARKETING_PRIVACY_DOC, MARKETING_ADS_DOC } from "./consent-docs.js";

const CONSENT_DIR = join(HISTORY_DIR, "consent");

function ensureDir(): void {
  if (!existsSync(CONSENT_DIR)) mkdirSync(CONSENT_DIR, { recursive: true });
}

// ── Policy Versions (static — update version string on policy change) ──────────
// "marketing" is the legacy pre-2026-07-07 type kept for stored-record compatibility.

export type PolicyType =
  | "age"
  | "terms"
  | "privacy"
  | "marketing_privacy"
  | "marketing_ads"
  | "marketing_ads_sms"
  | "marketing_ads_push"
  | "marketing_ads_email"
  | "marketing";

export interface PolicyVersion {
  type: PolicyType;
  version: string;
  required: boolean;
  title: string;
  summary: string;
  effectiveAt: string;
  content?: string;
}

const POLICY_VERSION = "2026-07-07";
const POLICY_EFFECTIVE_AT = "2026-07-07T00:00:00.000Z";

const CURRENT_POLICIES: PolicyVersion[] = [
  {
    type: "age",
    version: POLICY_VERSION,
    required: true,
    title: "만 14세 이상 확인",
    summary: "만 14세 이상의 회원입니다. (개인정보 보호법 제22조의2)",
    effectiveAt: POLICY_EFFECTIVE_AT,
  },
  {
    type: "terms",
    version: POLICY_VERSION,
    required: true,
    title: "서비스 이용약관",
    summary: "마이크루(MyCrew) 서비스 이용약관에 동의합니다.",
    effectiveAt: POLICY_EFFECTIVE_AT,
    content: TERMS_DOC,
  },
  {
    type: "privacy",
    version: POLICY_VERSION,
    required: true,
    title: "개인정보 수집 및 이용 동의",
    summary: "서비스 제공에 필요한 개인정보 수집·이용에 동의합니다.",
    effectiveAt: POLICY_EFFECTIVE_AT,
    content: PRIVACY_DOC,
  },
  {
    type: "marketing_privacy",
    version: POLICY_VERSION,
    required: false,
    title: "마케팅 목적 개인정보 수집 및 이용 동의",
    summary: "마케팅 목적의 개인정보 수집·이용에 동의합니다. (선택)",
    effectiveAt: POLICY_EFFECTIVE_AT,
    content: MARKETING_PRIVACY_DOC,
  },
  {
    type: "marketing_ads",
    version: POLICY_VERSION,
    required: false,
    title: "마케팅 및 광고성 정보 수신 동의",
    summary: "광고성 정보 수신에 동의합니다. (선택, 정보통신망법 제50조)",
    effectiveAt: POLICY_EFFECTIVE_AT,
    content: MARKETING_ADS_DOC,
  },
  {
    type: "marketing_ads_sms",
    version: POLICY_VERSION,
    required: false,
    title: "광고성 정보 수신 — 문자 또는 카카오 알림톡",
    summary: "문자(SMS)/카카오 알림톡 매체의 광고성 정보 수신에 동의합니다. (선택)",
    effectiveAt: POLICY_EFFECTIVE_AT,
  },
  {
    type: "marketing_ads_push",
    version: POLICY_VERSION,
    required: false,
    title: "광고성 정보 수신 — 앱 푸시",
    summary: "앱 푸시 매체의 광고성 정보 수신에 동의합니다. (선택)",
    effectiveAt: POLICY_EFFECTIVE_AT,
  },
  {
    type: "marketing_ads_email",
    version: POLICY_VERSION,
    required: false,
    title: "광고성 정보 수신 — 이메일",
    summary: "이메일 매체의 광고성 정보 수신에 동의합니다. (선택)",
    effectiveAt: POLICY_EFFECTIVE_AT,
  },
];

// content is large — list endpoint returns metadata only; fetch a single policy for the full text.
export function listPolicies(): PolicyVersion[] {
  return CURRENT_POLICIES.map(({ content: _content, ...meta }) => meta);
}

export function getPolicy(type: PolicyType): PolicyVersion | null {
  return CURRENT_POLICIES.find((p) => p.type === type) ?? null;
}

// ── Consent Records ────────────────────────────────────────────────────────────

export interface ConsentItem {
  type: PolicyType;
  version: string;
  agreed: boolean;
}

export interface ConsentRecord {
  id: string;
  userKey: string;
  ip: string;
  userAgent?: string;
  items: ConsentItem[];
  recordedAt: string;
  allRequiredAgreed: boolean;
}

function monthFile(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return join(CONSENT_DIR, `consent-${y}-${m}.jsonl`);
}

export function recordConsent(
  userKey: string,
  ip: string,
  items: ConsentItem[],
  userAgent?: string,
): ConsentRecord {
  ensureDir();
  const now = new Date();
  const record: ConsentRecord = {
    id: randomUUID(),
    userKey,
    ip,
    ...(userAgent ? { userAgent } : {}),
    items,
    recordedAt: now.toISOString(),
    allRequiredAgreed: CURRENT_POLICIES
      .filter((p) => p.required)
      .every((p) => items.find((i) => i.type === p.type)?.agreed === true),
  };
  try {
    appendFileSync(monthFile(now), JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    console.error("[Consent] append 실패:", err);
  }
  return record;
}

export function getUserConsentHistory(userKey: string): ConsentRecord[] {
  ensureDir();
  const records: ConsentRecord[] = [];
  let files: string[] = [];
  try { files = readdirSync(CONSENT_DIR).filter((f) => f.endsWith(".jsonl")).sort().reverse(); } catch { /* empty */ }
  for (const f of files) {
    try {
      const content = readFileSync(join(CONSENT_DIR, f), "utf-8");
      for (const raw of content.split("\n")) {
        if (!raw.trim()) continue;
        try {
          const r = JSON.parse(raw) as ConsentRecord;
          if (r.userKey === userKey) records.push(r);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return records.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export function getLatestConsent(userKey: string): ConsentRecord | null {
  return getUserConsentHistory(userKey)[0] ?? null;
}

export function hasRequiredConsent(userKey: string): boolean {
  const latest = getLatestConsent(userKey);
  return latest?.allRequiredAgreed === true;
}

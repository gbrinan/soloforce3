// 외부 메시지 rate limit + 길이 제한.
// 메모리 sliding window — partner당 30/min, 전체 300/min.
// 길이 제한: 본문 8000자.
// 초과 시 recordRateBreach 트리거 → 30분 5회 초과 시 자동 비활성.

const PARTNER_RATE_LIMIT = 30;          // requests per minute per partner
const GLOBAL_RATE_LIMIT = 300;          // requests per minute total
const WINDOW_MS = 60 * 1000;
export const MAX_BODY_LENGTH = 8000;

// partner-request 공개 라우트는 별도 IP 단위 + 별도 글로벌 bucket
// envvar로 운영 환경별 조정 가능 (기본: 5/IP/min — 재시도 여유, 30/global/min)
const PARTNER_REQUEST_IP_LIMIT = parseInt(process.env.MYCREW_PARTNER_REQUEST_RATE_IP_PER_MIN ?? "5", 10);
const PARTNER_REQUEST_GLOBAL_LIMIT = parseInt(process.env.MYCREW_PARTNER_REQUEST_RATE_GLOBAL_PER_MIN ?? "30", 10);

interface Bucket {
  timestamps: number[];
}

const partnerBuckets = new Map<string, Bucket>();
const globalBucket: Bucket = { timestamps: [] };

// IP / partner-request 글로벌 별도 bucket
const ipBuckets = new Map<string, Bucket>();
const partnerRequestGlobalBucket: Bucket = { timestamps: [] };

function pruneBucket(b: Bucket, now: number): void {
  const cutoff = now - WINDOW_MS;
  while (b.timestamps.length > 0 && b.timestamps[0] < cutoff) {
    b.timestamps.shift();
  }
}

export type RateCheckReason = "ok" | "partner_rate" | "global_rate" | "body_too_long";

export function checkRateAndLength(partnerId: string, bodyLength: number): { ok: boolean; reason: RateCheckReason } {
  if (bodyLength > MAX_BODY_LENGTH) {
    return { ok: false, reason: "body_too_long" };
  }
  const now = Date.now();
  pruneBucket(globalBucket, now);
  if (globalBucket.timestamps.length >= GLOBAL_RATE_LIMIT) {
    return { ok: false, reason: "global_rate" };
  }
  let pb = partnerBuckets.get(partnerId);
  if (!pb) { pb = { timestamps: [] }; partnerBuckets.set(partnerId, pb); }
  pruneBucket(pb, now);
  if (pb.timestamps.length >= PARTNER_RATE_LIMIT) {
    return { ok: false, reason: "partner_rate" };
  }
  // 통과 → 카운터 증가
  pb.timestamps.push(now);
  globalBucket.timestamps.push(now);
  return { ok: true, reason: "ok" };
}

export type PartnerRequestRateReason = "ok" | "ip_rate" | "global_rate";

export function checkPartnerRequestRate(ip: string): { ok: boolean; reason: PartnerRequestRateReason } {
  const now = Date.now();
  pruneBucket(partnerRequestGlobalBucket, now);
  if (partnerRequestGlobalBucket.timestamps.length >= PARTNER_REQUEST_GLOBAL_LIMIT) {
    return { ok: false, reason: "global_rate" };
  }
  let ib = ipBuckets.get(ip);
  if (!ib) { ib = { timestamps: [] }; ipBuckets.set(ip, ib); }
  pruneBucket(ib, now);
  if (ib.timestamps.length >= PARTNER_REQUEST_IP_LIMIT) {
    return { ok: false, reason: "ip_rate" };
  }
  ib.timestamps.push(now);
  partnerRequestGlobalBucket.timestamps.push(now);
  return { ok: true, reason: "ok" };
}

export function getRateStats(partnerId?: string): { partner?: number; global: number } {
  const now = Date.now();
  pruneBucket(globalBucket, now);
  const stats: { partner?: number; global: number } = { global: globalBucket.timestamps.length };
  if (partnerId) {
    const pb = partnerBuckets.get(partnerId);
    if (pb) { pruneBucket(pb, now); stats.partner = pb.timestamps.length; }
    else stats.partner = 0;
  }
  return stats;
}

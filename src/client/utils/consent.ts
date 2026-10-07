// Consent helpers — 회원가입 플로우(약관 동의 → SSO → 마이크루 설정) 공용.
// /onboarding(서버 렌더 동의 페이지)이 sessionStorage에 보관한 동의 선택을
// SSO 완료 후 /api/consent/record로 기록한다.

import type { ConsentState } from '../components/Consent/ConsentSection';

export const CONSENT_VERSION = '2026-07-07';

export const PENDING_CONSENT_KEY = 'mycrew.pendingConsent';

interface ConsentItem { type: string; version: string; agreed: boolean }

/** 동의 선택을 SSO 이동 전 sessionStorage에 보관한다 (/onboarding 서버 페이지와 동일 포맷). */
export function stashPendingConsent(v: ConsentState): void {
  const picked = {
    version: CONSENT_VERSION,
    age: v.age,
    terms: v.terms,
    privacy: v.privacy,
    marketing_privacy: v.marketingPrivacy,
    marketing_ads: v.marketingAds,
    marketing_ads_sms: v.adsSms,
    marketing_ads_push: v.adsPush,
    marketing_ads_email: v.adsEmail,
  };
  try { sessionStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify(picked)); } catch { /* 기록은 로그인 후 단계에서 재시도 */ }
}

/** SSO 전 동의 페이지가 남긴 pendingConsent를 기록하고 비운다. 없으면 no-op. */
export async function flushPendingConsent(): Promise<void> {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(PENDING_CONSENT_KEY); } catch { return; }
  if (!raw) return;
  let picked: Record<string, unknown> = {};
  try { picked = JSON.parse(raw) as Record<string, unknown>; } catch {
    try { sessionStorage.removeItem(PENDING_CONSENT_KEY); } catch { /* */ }
    return;
  }
  const version = typeof picked.version === 'string' ? picked.version : CONSENT_VERSION;
  const types = ['age', 'terms', 'privacy', 'marketing_privacy', 'marketing_ads', 'marketing_ads_sms', 'marketing_ads_push', 'marketing_ads_email'];
  const items: ConsentItem[] = types.map((type) => ({ type, version, agreed: picked[type] === true }));
  try {
    const res = await fetch('/api/consent/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    // 기록 성공 시에만 비운다 — 실패하면 다음 로드에서 재시도.
    if (res.ok) sessionStorage.removeItem(PENDING_CONSENT_KEY);
  } catch { /* 다음 로드에서 재시도 */ }
}

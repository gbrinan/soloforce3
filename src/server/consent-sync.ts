// 약관 동의 중앙 동기화 — /api/consent/record 성공 시 스토어 Supabase user_consents로
// (email, type)당 최신 상태 스냅샷을 upsert한다 (fire-and-forget, 실패해도 로컬 기록은 유효).
// 목적: 스토어 관리자 화면의 사용자별 선택 동의 표시 + 정보통신망법 §50-8·시행령 §62-3
// 2년 주기 수신동의 확인 의무의 기산점(agreed_at)·동의 항목 정보(title/version) 중앙 보관.
//
// agreed_at 규칙: false→true 전이 시각만 기록/갱신 — 동의 유지 상태의 재기록(다른 항목 변경 시
// 전 항목 스냅샷 전송)으로 2년 기산점이 밀리지 않게 한다. true→false 전이는 withdrawn_at 기록.
// STORE_SUPABASE_* 미구성이거나 userKey가 이메일이 아니면(__local__) no-op.

import { hostname } from "node:os";
import { getPolicy, type ConsentItem } from "./consent.js";

interface RemoteConsentRow {
  consent_type: string;
  agreed: boolean;
  agreed_at: string | null;
  withdrawn_at: string | null;
}

function storeConfig(): { url: string; key: string } | null {
  const url = process.env.STORE_SUPABASE_URL;
  const key = process.env.STORE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export async function syncConsentToStore(userKey: string, items: ConsentItem[]): Promise<void> {
  const cfg = storeConfig();
  if (!cfg || !userKey.includes("@") || items.length === 0) return;
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
  };
  try {
    const email = userKey.trim().toLowerCase();
    const res = await fetch(
      `${cfg.url}/rest/v1/user_consents?user_email=eq.${encodeURIComponent(email)}&select=consent_type,agreed,agreed_at,withdrawn_at`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`user_consents 조회 실패 (${res.status})`);
    const existing = new Map(
      ((await res.json()) as RemoteConsentRow[]).map((r) => [r.consent_type, r]),
    );

    const now = new Date().toISOString();
    const rows = items.map((it) => {
      const prev = existing.get(it.type);
      const agreedAt = it.agreed ? (prev?.agreed ? prev.agreed_at ?? now : now) : null;
      const withdrawnAt = it.agreed ? null : prev?.agreed ? now : prev?.withdrawn_at ?? null;
      return {
        user_email: email,
        consent_type: it.type,
        agreed: it.agreed,
        version: it.version,
        title: getPolicy(it.type)?.title ?? it.type,
        agreed_at: agreedAt,
        withdrawn_at: withdrawnAt,
        recorded_at: now,
        source_instance: hostname(),
      };
    });

    const up = await fetch(`${cfg.url}/rest/v1/user_consents?on_conflict=user_email,consent_type`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(10_000),
    });
    if (!up.ok) throw new Error(`user_consents upsert 실패 (${up.status}): ${await up.text()}`);
    console.log(`[ConsentSync] ${email} 동의 ${rows.length}건 스토어 동기화 완료`);
  } catch (err) {
    // 네트워크/미구성 오류는 서비스 흐름을 막지 않는다 — 로컬 JSONL이 원본 기록.
    console.warn("[ConsentSync] 동기화 실패 (로컬 기록은 유효):", err instanceof Error ? err.message : err);
  }
}

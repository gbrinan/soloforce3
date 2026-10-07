// 설치 온보딩 퍼널 텔레메트리 (1-4) — 서버 렌더 온보딩 페이지의 funnelPingScript와 동일 규약.
// install_id는 localStorage UUID(PII 아님, 서버 페이지와 공유), 스토어로 fire-and-forget.
// text/plain sendBeacon으로 크로스오리진(localhost→store) CORS 프리플라이트를 피한다.
const INSTALL_ID_KEY = 'mycrew:installId';
const STORE_URL = (import.meta.env.VITE_MYCREW_STORE_URL || 'https://store.dooitspace.com').replace(/\/+$/, '');

type FunnelStep = 'sso_done' | 'setup_done';

function installId(): string {
  try {
    let v = localStorage.getItem(INSTALL_ID_KEY);
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`)
        .replace(/-/g, '').slice(0, 32);
      localStorage.setItem(INSTALL_ID_KEY, v);
    }
    return v;
  } catch { return 'anon'; }
}

function detectPlatform(): 'mac' | 'windows' | 'linux' | undefined {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return undefined;
}

// 세션 내 중복 전송 방지 — 같은 단계는 한 번만.
const sent = new Set<string>();

export function funnelPing(step: FunnelStep): void {
  if (sent.has(step)) return;
  sent.add(step);
  try {
    const payload = JSON.stringify({ installId: installId(), step, platform: detectPlatform() });
    const url = `${STORE_URL}/api/telemetry/funnel`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
    } else {
      void fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch { /* 텔레메트리 실패는 무시 */ }
}

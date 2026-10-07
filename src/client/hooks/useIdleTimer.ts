import { useEffect } from 'react';

// 자동 잠금 idle 타이머. "단순 N분 타이머"가 아니라:
//  - capture phase 이벤트 + 500ms throttle (자식 stopPropagation 회피 + CPU 절약)
//  - BroadcastChannel로 멀티탭 활동 동기화 (다른 탭에서 입력 중이면 잠기지 않음)
//  - localStorage(jarvis:lastActivityAt) + visibilitychange로 system sleep wake 보정
//    (절전모드/탭 백그라운드 동안 setTimeout이 정지/지연되어도 깨어날 때 잠금)
//  - cleanup에서 BroadcastChannel.close(), capture 옵션 동일 명시
//
// 호환:
//  - BroadcastChannel 미지원 환경(구형 Safari/firefox legacy) → 멀티탭 동기화만 graceful 비활성, 나머지 동작.
//  - localStorage 접근 차단(privacy mode 일부) → sleep wake 판정 폴백(기존 동작).
const STORAGE_KEY = 'jarvis:lastActivityAt';
const CHANNEL_NAME = 'jarvis-idle';
const THROTTLE_MS = 500;

export function useIdleTimer(timeoutMs: number, onIdle: () => void): void {
  useEffect(() => {
    if (!timeoutMs) return;

    // (3) mount 시점 sleep wake 검사 — 이미 timeout 초과면 즉시 onIdle.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const last = raw ? Number(raw) : Date.now();
      if (Number.isFinite(last) && Date.now() - last >= timeoutMs) {
        onIdle();
        return;
      }
    } catch { /* storage 차단 — 폴백: 기존 동작 */ }

    let timer: ReturnType<typeof setTimeout>;
    let lastReset = 0;

    // (2) 멀티탭 동기화. 미지원 환경에서는 null로 graceful fallback.
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

    const armTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, timeoutMs);
    };

    // (1) throttle + lastActivityAt 기록 + peer broadcast
    const reset = () => {
      const now = Date.now();
      if (now - lastReset < THROTTLE_MS) return;
      lastReset = now;
      armTimer();
      try { localStorage.setItem(STORAGE_KEY, String(now)); } catch { /* */ }
      try { bc?.postMessage('activity'); } catch { /* */ }
    };

    // 다른 탭 활동 수신 → timer만 재무장. lastReset은 갱신하지 않아 무한 echo 방지.
    const onPeerActivity = (e: MessageEvent) => {
      if (e.data === 'activity') armTimer();
    };

    // (3) visibility 전환 — visible 복귀 시 sleep wake 재검사
    const onVisibility = () => {
      if (document.hidden) {
        // 가려질 때는 기존 동작 보존(타이머 재무장).
        reset();
        return;
      }
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const last = raw ? Number(raw) : Date.now();
        if (Number.isFinite(last) && Date.now() - last >= timeoutMs) {
          onIdle();
          return;
        }
      } catch { /* 폴백: 그냥 reset */ }
      reset();
    };

    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    // (1) capture phase + passive — 자식의 stopPropagation에도 idle reset 보장.
    //     removeEventListener는 동일 옵션 객체로 호출해야 정확히 제거됨.
    const listenerOpts: AddEventListenerOptions = { capture: true, passive: true };
    events.forEach(e => document.addEventListener(e, reset, listenerOpts));
    document.addEventListener('visibilitychange', onVisibility);
    bc?.addEventListener('message', onPeerActivity);

    reset();

    // (5) cleanup 보강 — bc.close(), capture 옵션 동일 명시.
    //     lastActivityAt은 보존 → 다음 mount 시 sleep wake 판정 데이터로 재사용.
    return () => {
      clearTimeout(timer);
      events.forEach(e => document.removeEventListener(e, reset, listenerOpts));
      document.removeEventListener('visibilitychange', onVisibility);
      if (bc) {
        bc.removeEventListener('message', onPeerActivity);
        bc.close();
      }
    };
  }, [timeoutMs, onIdle]);
}

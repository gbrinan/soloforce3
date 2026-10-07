// 스토어 통합 Phase 4 — 3rd-party(optional) 앱 최초 실행 시 1회성 부트스트랩 마킹.
// core 앱(내장, category:"core")은 설치 개념이 없으므로 대상 아님 — 호출부(App.tsx)에서 optional만 걸러 호출.
// 서버 계약: src/server/routes/store-installed.ts — installed.jsonl에 action:"bootstrap" 레코드를 append하고,
// currentInstalled()가 install 상태 위에 bootstrapped:true를 얹어 GET /api/store/installed 응답에 포함시킨다.
const STORE_USER_ID = 'local-owner';

// 세션 내 캐시 — 같은 앱을 반복 진입해도 매번 GET을 쏘지 않도록.
const bootstrappedCache = new Set<string>();

async function fetchBootstrapped(kind: string, itemId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/store/installed?userId=${STORE_USER_ID}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { items?: { itemId: string; kind: string; bootstrapped?: boolean }[] };
    return !!data.items?.find((it) => it.kind === kind && it.itemId === itemId)?.bootstrapped;
  } catch {
    return false; // 서버 미기동/오프라인 — 부트스트랩 없이 진행, 다음 진입 때 재시도
  }
}

// 부트스트랩 완료 여부 조회 (세션 캐시 우선). setupGuide 온보딩 모달 표시 판단용 —
// 미완료여도 여기서는 캐시에 넣지 않는다(마킹은 markAppBootstrapped 몫).
export async function isAppBootstrapped(kind: 'app' | 'plugin', itemId: string): Promise<boolean> {
  const key = `${kind}:${itemId}`;
  if (bootstrappedCache.has(key)) return true;
  if (await fetchBootstrapped(kind, itemId)) {
    bootstrappedCache.add(key);
    return true;
  }
  return false;
}

// 앱 최초 진입(런처 클릭) 시 호출. 이미 부트스트랩됐거나 설치 기록이 없으면(core 앱 등) no-op.
export async function ensureAppBootstrapped(kind: 'app' | 'plugin', itemId: string): Promise<void> {
  if (await isAppBootstrapped(kind, itemId)) return;
  await markAppBootstrapped(kind, itemId);
}

// 부트스트랩 완료 마킹 — setupGuide 온보딩 모달을 닫는 시점에 호출해 "1회만 표시"를 보장한다.
export async function markAppBootstrapped(kind: 'app' | 'plugin', itemId: string): Promise<void> {
  const key = `${kind}:${itemId}`;
  if (bootstrappedCache.has(key)) return;
  bootstrappedCache.add(key); // 낙관적 마킹 — 응답 대기 중 중복 클릭/레이스 방지
  try {
    const res = await fetch('/api/store/installed/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: STORE_USER_ID, itemId, kind }),
    });
    if (!res.ok) bootstrappedCache.delete(key);
  } catch (err) {
    bootstrappedCache.delete(key); // 실패 시 다음 진입에 재시도 허용
    console.warn('[appBootstrap] 부트스트랩 기록 실패:', err);
  }
}

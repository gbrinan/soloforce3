// 앱/패키지 업데이트 상태 조회·실행 공용 헬퍼.
// 서버 update-check.ts가 6시간 주기로 갱신하는 /api/update-status를 읽는다.

export interface AppUpdateStatus {
  id: string;
  name: string;
  currentVersion: string;
  latestVersion: string;
  updatable: boolean;
}

/** 앱 id → 업데이트 상태 맵. 스토어 미구성/오프라인이면 빈 맵. */
export async function fetchAppUpdateMap(): Promise<Map<string, AppUpdateStatus>> {
  const res = await fetch('/api/update-status');
  if (!res.ok) return new Map();
  const body = (await res.json()) as { apps?: AppUpdateStatus[] };
  return new Map((body.apps ?? []).map((a) => [a.id, a]));
}

/** 설치형 앱 업데이트 실행 — 다운로드·검증·교체 후 재기동. 실패 시 서버 error 메시지로 throw. */
export async function updateApp(id: string): Promise<{ version: string }> {
  const res = await fetch(`/api/apps/${encodeURIComponent(id)}/update`, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { version?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `업데이트 실패 (${res.status})`);
  return { version: body.version ?? '' };
}

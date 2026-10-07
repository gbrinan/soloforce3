// 스토어 통합 Phase 2 — navSettings(localStorage) ↔ installed.jsonl(서버) 양방향 동기화.
// Phase 1(커밋 17b0004)에서 22건 초기 시딩된 history/store/installed.jsonl을 정본으로 삼아
// 부팅 시 로컬 hidden 상태를 맞추고(inbound), 사용자가 설정에서 토글하면 서버에도 반영한다(outbound).
// 계약: src/server/routes/store-installed.ts (userId sentinel "local-owner", kind:"plugin", itemId=PanelId).
// 참조: history/outputs/planner-researcher/2026-07-03-store-integration-plan.md
import { loadNavSettings, saveNavSettings, FIXED_PANELS, NAV_ITEMS, type PanelId } from './navSettings';

const STORE_USER_ID = 'local-owner';

interface InstalledItem {
  itemId: string;
  kind: string;
}

async function fetchInstalledPluginIds(): Promise<Set<PanelId> | null> {
  try {
    const res = await fetch(`/api/store/installed?userId=${STORE_USER_ID}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: InstalledItem[] };
    const ids = new Set<PanelId>();
    for (const it of data.items ?? []) {
      if (it.kind === 'plugin' && NAV_ITEMS.some((n) => n.id === it.itemId)) {
        ids.add(it.itemId as PanelId);
      }
    }
    return ids;
  } catch {
    return null; // 서버 미기동/오프라인 — 로컬 상태 유지 (no-op)
  }
}

// 부팅 시 1회 호출 — 서버(installed.jsonl)를 정본으로 로컬 hidden 상태를 재조정한다.
// 조회 실패 시 로컬 상태를 그대로 둔다.
export async function reconcileNavSettingsFromServer(): Promise<void> {
  const installedIds = await fetchInstalledPluginIds();
  if (!installedIds) return;
  const current = loadNavSettings();
  const hidden = new Set(current.hidden);
  let changed = false;
  for (const item of NAV_ITEMS) {
    if (FIXED_PANELS.includes(item.id)) continue; // 고정 패널은 상태 무관 항상 표시
    const shouldBeVisible = installedIds.has(item.id);
    const isHidden = hidden.has(item.id);
    if (shouldBeVisible && isHidden) {
      hidden.delete(item.id);
      changed = true;
    } else if (!shouldBeVisible && !isHidden) {
      hidden.add(item.id);
      changed = true;
    }
  }
  if (changed) saveNavSettings({ ...current, hidden: [...hidden] });
}

// 설정 화면에서 메뉴 토글 변경 시 서버에 반영 (fire-and-forget — 실패해도 UI 흐름을 막지 않음).
export function notifyPluginToggle(id: PanelId, visible: boolean): void {
  if (FIXED_PANELS.includes(id)) return; // 고정 패널은 uninstall 호출 금지
  const action = visible ? 'install' : 'uninstall';
  fetch(`/api/store/installed/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: STORE_USER_ID, itemId: id, kind: 'plugin' }),
  }).catch((err) => console.warn('[storeSync] plugin toggle 동기화 실패:', err));
}

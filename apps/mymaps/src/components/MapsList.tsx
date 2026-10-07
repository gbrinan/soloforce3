import { useState, useEffect, useCallback } from 'react';
import { supabase, type MapRow, type LayerRow, type FeatureRow } from '../lib/supabase';
import { getUserId } from '../lib/auth';
import { idb } from '../lib/offline';
import { Map, Plus, Trash2, Edit2, Check, X, Globe2 } from 'lucide-react';
import { confirmDialog } from './ConfirmDialog';
import { useI18n, INTL_LOCALE } from '../i18n';
import { btn, iconBtn } from '../ui/controls';

type Props = {
  offline: boolean;
  onOpenMap: (id: string, name: string) => void;
  onOpenAtlas: () => void;
};

const genId = () => crypto.randomUUID();

// One-time local→cloud backfill. Earlier the cloud schema didn't exist, so the
// app ran offline and stored maps only in this device's IndexedDB — they never
// synced. When the cloud is empty for this user but local maps exist, push them
// up (rewriting user_id to the current cloud user so RLS accepts them).
// Guarded by a localStorage flag so intentionally-deleted maps aren't resurrected.
const BACKFILL_FLAG = 'mymaps_backfilled_v1';

async function backfillLocalMaps(userId: string): Promise<boolean> {
  if (!supabase) return false;
  if (localStorage.getItem(BACKFILL_FLAG)) return false;
  try {
    const localMaps = await idb.maps.getAll<MapRow>();
    if (localMaps.length === 0) { localStorage.setItem(BACKFILL_FLAG, '1'); return false; }

    const { error: mErr } = await supabase.from('mymaps_maps').insert(
      localMaps.map((m) => ({
        id: m.id, user_id: userId, name: m.name,
        created_at: m.created_at, updated_at: m.updated_at,
      })),
    );
    if (mErr) throw mErr;
    // Maps are in the cloud now — mark done immediately so a later reload can
    // never double-insert them, even if layer/feature copy below fails.
    localStorage.setItem(BACKFILL_FLAG, '1');

    for (const m of localMaps) {
      const layers = await idb.layers.getByMap<LayerRow>(m.id);
      if (layers.length === 0) continue;
      const { error: lErr } = await supabase.from('mymaps_layers').insert(
        layers.map((l) => ({ id: l.id, map_id: m.id, name: l.name, visible: l.visible, order: l.order })),
      );
      if (lErr) throw lErr;
      for (const l of layers) {
        const feats = await idb.features.getByLayer<FeatureRow>(l.id);
        if (feats.length === 0) continue;
        const { error: fErr } = await supabase.from('mymaps_features').insert(
          feats.map((f) => ({ id: f.id, layer_id: l.id, type: f.type, geometry: f.geometry, properties: f.properties })),
        );
        if (fErr) throw fErr;
      }
    }
    return true;
  } catch (e) {
    console.warn('[mymaps] local→cloud backfill failed:', e);
    return false;
  }
}

export default function MapsList({ offline, onOpenMap, onOpenAtlas }: Props) {
  const { t, locale } = useI18n();
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (supabase && !offline) {
        const userId = getUserId();
        const fetchMaps = () => supabase!
          .from('mymaps_maps')
          .select('*')
          .eq('user_id', userId!)
          .order('updated_at', { ascending: false });
        let { data } = await fetchMaps();
        if (!data || data.length === 0) {
          const migrated = await backfillLocalMaps(userId!);
          if (migrated) ({ data } = await fetchMaps());
        }
        setMaps((data as MapRow[]) ?? []);
      } else {
        const data = await idb.maps.getAll<MapRow>();
        setMaps(data.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      }
    } catch {
      setMaps([]);
    }
    setLoading(false);
  }, [offline]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    const id = genId();
    const now = new Date().toISOString();
    const userId = getUserId() ?? 'offline';
    const map: MapRow = { id, user_id: userId, name: t('maps.new'), created_at: now, updated_at: now };

    if (supabase && !offline) {
      await supabase.from('mymaps_maps').insert(map);
      await supabase.from('mymaps_layers').insert({
        id: genId(), map_id: id, name: t('layers.defaultName', { n: 1 }), visible: true, order: 0,
      });
    } else {
      await idb.maps.put(map);
      await idb.layers.put({ id: genId(), map_id: id, name: t('layers.defaultName', { n: 1 }), visible: true, order: 0 });
    }
    onOpenMap(id, t('maps.new'));
  }

  async function remove(mapId: string) {
    const ok = await confirmDialog({
      message: t('maps.deleteConfirm'),
      confirmLabel: t('common.delete'), danger: true,
    });
    if (!ok) return;
    if (supabase && !offline) {
      await supabase.from('mymaps_maps').delete().eq('id', mapId);
    } else {
      await idb.maps.delete(mapId);
    }
    await load();
  }

  async function rename(mapId: string, name: string) {
    const now = new Date().toISOString();
    if (supabase && !offline) {
      await supabase.from('mymaps_maps').update({ name, updated_at: now }).eq('id', mapId);
    } else {
      const all = await idb.maps.getAll<MapRow>();
      const m = all.find((m) => m.id === mapId);
      if (m) await idb.maps.put({ ...m, name, updated_at: now });
    }
    setRenaming(null);
    await load();
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={create}
            style={btn('md', 'primary', { gap: 6 })}
          >
            <Plus size={13} /> {t('maps.new')}
          </button>
          <button
            onClick={onOpenAtlas}
            style={btn('md', 'neutral', { gap: 6 })}
          >
            <Globe2 size={13} /> {t('maps.atlas')}
          </button>
        </div>
        {offline ? (
          <span style={{ fontSize: 12, padding: '2px 8px', background: 'rgba(251,191,36,0.15)', color: '#FBBF24', borderRadius: 999 }}>
            {t('common.offline')}
          </span>
        ) : (
          <div />
        )}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div style={{ width: 24, height: 24, border: '2px solid #6366F1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : maps.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, paddingTop: 60 }}>
            <Map size={40} color="var(--text-secondary)" />
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 14 }}>
              {t('maps.empty')}
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 14,
          }}>
            {maps.map((map) => (
              <MapCard
                key={map.id}
                map={map}
                isRenaming={renaming === map.id}
                renameVal={renameVal}
                onOpen={() => onOpenMap(map.id, map.name)}
                onDelete={() => remove(map.id)}
                onStartRename={() => { setRenaming(map.id); setRenameVal(map.name); }}
                onCancelRename={() => setRenaming(null)}
                onCommitRename={() => rename(map.id, renameVal)}
                onRenameChange={setRenameVal}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type CardProps = {
  map: MapRow;
  isRenaming: boolean;
  renameVal: string;
  onOpen: () => void;
  onDelete: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onRenameChange: (v: string) => void;
};

function MapCard({
  map, isRenaming, renameVal,
  onOpen, onDelete, onStartRename, onCancelRename, onCommitRename, onRenameChange,
}: CardProps) {
  const { t, locale } = useI18n();
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={isRenaming ? undefined : onOpen}
      style={{
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 14,
        overflow: 'hidden',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        cursor: 'pointer',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 8px 20px rgba(0,0,0,0.25)' : '0 1px 2px rgba(0,0,0,0.1)',
        borderColor: hover ? 'rgba(99,102,241,0.4)' : 'var(--border)',
        position: 'relative',
      }}
    >
      {/* Thumbnail area (4:3 ratio) */}
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.12) 50%, rgba(129,140,248,0.10) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Map size={48} color="rgba(129,140,248,0.55)" strokeWidth={1.5} />

        {!isRenaming && hover && (
          <div
            style={{
              position: 'absolute', top: 8, right: 8,
              display: 'flex', gap: 4,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ActionBtn onClick={(e) => { e.stopPropagation(); onStartRename(); }} title={t('common.rename')}>
              <Edit2 size={14} />
            </ActionBtn>
            <ActionBtn onClick={(e) => { e.stopPropagation(); onDelete(); }} title={t('common.delete')} danger>
              <Trash2 size={14} />
            </ActionBtn>
          </div>
        )}
      </div>

      {/* Text area */}
      <div style={{ padding: '10px 12px 12px', minHeight: 56 }}>
        {isRenaming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename();
                if (e.key === 'Escape') onCancelRename();
              }}
              style={{
                flex: 1, minWidth: 0, padding: '4px 8px', background: 'var(--bg-elevated)',
                border: '1px solid #6366F1', borderRadius: 6, color: 'var(--text-primary)',
                fontSize: 14, outline: 'none',
              }}
            />
            <button onClick={onCommitRename} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
              <Check size={14} color="#34D399" />
            </button>
            <button onClick={onCancelRename} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
              <X size={14} color="#F87171" />
            </button>
          </div>
        ) : (
          <>
            <div style={{
              fontWeight: 600, fontSize: 14, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {map.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {new Date(map.updated_at).toLocaleDateString(INTL_LOCALE[locale])}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  onClick, children, title, danger,
}: {
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  title?: string;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={iconBtn('sm', danger ? 'dangerSubtle' : 'subtle', {
        border: 'none', transition: 'all 0.15s',
        background: hover ? (danger ? 'rgba(248,113,113,0.15)' : 'var(--bg-base)') : 'transparent',
        color: hover ? (danger ? 'var(--danger)' : 'var(--text-primary)') : 'var(--text-secondary)',
      })}
    >
      {children}
    </button>
  );
}

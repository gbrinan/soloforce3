import { useMemo } from 'react';
import { X, Route } from 'lucide-react';
import { optimizeRoute, haversineKm, type RoutePoint } from '../lib/route';
import { useI18n } from '../i18n';
import { iconBtn } from '../ui/controls';

type Props = {
  layerName: string;
  points: RoutePoint[];
  onClose: () => void;
};

export default function RouteOptimizeModal({ layerName, points, onClose }: Props) {
  const { t } = useI18n();
  const result = useMemo(() => optimizeRoute(points), [points]);
  const distStr = result.totalKm < 1
    ? `${(result.totalKm * 1000).toFixed(0)} m`
    : `${result.totalKm.toFixed(2)} km`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 14, padding: 24,
        width: 380, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Route size={16} /> {t('route.title')}
          </span>
          <button onClick={onClose} aria-label={t('common.close')} style={iconBtn('sm', 'subtle', { border: 'none' })}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('route.desc', { layer: layerName, n: points.length })}
        </div>

        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {result.order.map((p, i) => (
            <li
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px', borderRadius: 6,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: '#6366F1', color: '#fff', fontSize: 12, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              {i > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {(() => {
                    const km = haversineKm(result.order[i - 1], p);
                    return km < 1 ? `+${(km * 1000).toFixed(0)} m` : `+${km.toFixed(1)} km`;
                  })()}
                </span>
              )}
            </li>
          ))}
        </ol>

        <div style={{
          fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
          padding: '10px 12px', borderRadius: 8,
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.4)',
        }}>
          {t('route.total', { dist: distStr })}
        </div>
      </div>
    </div>
  );
}

import type { FeatureRow } from '../lib/supabase';
import { useI18n } from '../i18n';
import { btn, iconBtn } from '../ui/controls';

type Props = {
  feature: FeatureRow;
  position: { x: number; y: number };
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function FeaturePopup({ feature, position, onEdit, onDelete, onClose }: Props) {
  const { t } = useI18n();
  const color = (feature.properties.color as string | undefined) ?? '#6366F1';
  const name = (feature.properties.name as string | undefined) || t('feature.marker');
  const address = feature.properties.address as string | undefined;
  const description = feature.properties.description as string | undefined;
  const photoUrl = feature.properties.photo_url as string | undefined;

  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y - 48,
        transform: 'translate(-50%, -100%)',
        zIndex: 50,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        minWidth: 200,
        maxWidth: 260,
        boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: photoUrl || address || description ? 8 : 8 }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{
          fontWeight: 600, fontSize: 14, color: 'var(--text-primary)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </span>
        <button
          onClick={onClose}
          style={iconBtn('sm', 'subtle', { border: 'none', fontSize: 16, flexShrink: 0 })}
        >
          ×
        </button>
      </div>
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          style={{
            width: '100%', height: 90, objectFit: 'cover',
            borderRadius: 6, marginBottom: 8, display: 'block',
          }}
        />
      )}
      {address && (
        <div style={{
          fontSize: 12, color: 'var(--text-secondary)',
          marginBottom: 6, lineHeight: 1.35,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          📍 {address}
        </div>
      )}
      {description && (
        <div style={{
          fontSize: 12, color: 'var(--text-primary)',
          marginBottom: 8, lineHeight: 1.4,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
        }}>
          {description}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={onEdit}
          style={btn('sm', 'primary', { flex: 1 })}
        >
          {t('common.edit')}
        </button>
        <button
          onClick={onDelete}
          style={btn('sm', 'danger', { flex: 1 })}
        >
          {t('common.delete')}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { useI18n } from '../i18n';
import { btn, iconBtn } from '../ui/controls';

export type MenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
};

export default function MoreMenu({ items, title }: { items: MenuItem[]; title?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <button
        draggable={false}
        onClick={() => setOpen((v) => !v)}
        title={title ?? t('common.more')}
        style={iconBtn('sm', 'subtle', { border: 'none' })}
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 2, zIndex: 50,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15))', minWidth: 140, overflow: 'hidden', padding: 4,
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); item.onClick(); }}
              style={btn('sm', item.danger ? 'dangerSubtle' : 'subtle', {
                gap: 6, width: '100%', justifyContent: 'flex-start', textAlign: 'left',
                border: 'none', color: item.danger ? 'var(--danger)' : 'var(--text-primary)',
              })}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

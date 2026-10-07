import React from 'react';
import { ActionIcon } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { Partner } from '../../utils/api';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  partners: Partner[];
  selectedId: string | null;  // null = 전체
  unreadByPartner: Record<string, number>;
  onSelect: (id: string | null) => void;
  onAddClick: () => void;
  onPing?: (id: string) => void;
  pingingIds?: Set<string>;
  onDelete?: (partner: Partner) => void;
}

// lastSeenAt이 15분 이내면 재석(녹색). 그 외 또는 active=false면 부재(회색/빨강).
// 친구 sync는 10분 주기 → 15분 윈도우는 한 사이클 놓쳐도 회색 안 되게 5분 여유.
const PRESENCE_FRESH_MS = 15 * 60 * 1000;
function isPresent(p: Partner): boolean {
  if (!p.active) return false;
  if (!p.lastSeenAt) return false;
  const t = new Date(p.lastSeenAt).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t < PRESENCE_FRESH_MS;
}

export default function PartnerList({ partners, selectedId, unreadByPartner, onSelect, onAddClick, onPing, pingingIds, onDelete }: Props) {
  const t = useT();
  const totalUnread = Object.values(unreadByPartner).reduce((a, b) => a + b, 0);
  return (
    <div className="partner-list">
      <div
        className={`partner-row${selectedId === null ? ' selected' : ''}`}
        onClick={() => onSelect(null)}
      >
        <span className="partner-name">{t('friend.viewAll')}</span>
        {totalUnread > 0 && <span className="partner-badge">{totalUnread}</span>}
      </div>
      {partners.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 16, fontSize: 'var(--font-s)' }}>
          {t('friend.noPartners')}
        </div>
      ) : (
        partners.map((p) => {
          const count = unreadByPartner[p.id] ?? 0;
          const present = isPresent(p);
          const lastSeenLabel = p.lastSeenAt
            ? t('friend.lastSeen', { date: new Date(p.lastSeenAt).toLocaleString('ko-KR') })
            : t('friend.noResponse');
          const statusTitle = !p.active
            ? t('friend.blocked')
            : present
              ? t('friend.present', { label: lastSeenLabel })
              : t('friend.away', { label: lastSeenLabel });
          return (
            <div
              key={p.id}
              className={`partner-row${selectedId === p.id ? ' selected' : ''}${!p.active ? ' inactive' : ''}`}
              onClick={() => onSelect(p.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="partner-name">
                  {!p.active && <span title={t('friend.blocked')} style={{ color: 'var(--accent-danger)' }}>⊘ </span>}
                  {p.contactName}{p.secretaryName ? ` (${p.secretaryName})` : ''}
                </div>
                <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{p.companyName}{p.department ? ` · ${p.department}` : ''}</div>
              </div>
              {count > 0 && <span className="partner-badge">{count}</span>}
              {onDelete && (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="red"
                  onClick={(e) => { e.stopPropagation(); onDelete(p); }}
                  title={t('partner.delete')}
                  aria-label={t('partner.deleteConfirm', { name: p.companyName })}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              )}
              {onPing && (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  disabled={!p.active || pingingIds?.has(p.id)}
                  loading={pingingIds?.has(p.id)}
                  onClick={(e) => { e.stopPropagation(); onPing(p.id); }}
                  title={t('friend.pingNow')}
                  aria-label={t('friend.pingImmediate', { name: p.contactName })}
                >
                  ↻
                </ActionIcon>
              )}
              <span
                className={`partner-status ${present ? 'active' : 'away'}`}
                title={statusTitle}
                aria-label={statusTitle}
              />
            </div>
          );
        })
      )}
    </div>
  );
}

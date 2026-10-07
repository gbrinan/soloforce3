import React from 'react';
import { btn } from '../../ui/controls';
import { useT } from '../../i18n/I18nProvider';

export interface PlaceData {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  color?: string;
  featureId?: string;
}

interface Props {
  data: PlaceData;
}

export default function PlaceCard({ data }: Props) {
  const t = useT();
  function addToMap() {
    const fn = (window as unknown as { __mycrewSendToMymaps?: (p: PlaceData) => void }).__mycrewSendToMymaps;
    if (fn) {
      fn(data);
    } else {
      alert(t('chat.placeCardOpenMapFirst'));
    }
  }

  function sendEmail() {
    const parts = [data.name];
    if (data.address) parts.push(t('chat.addressLabel', { address: data.address }));
    if (data.lat != null && data.lng != null) parts.push(t('chat.coordsLabel', { lat: data.lat.toFixed(6), lng: data.lng.toFixed(6) }));
    const subject = encodeURIComponent(t('chat.placeShareSubject', { name: data.name }));
    const body = encodeURIComponent(parts.join('\n'));
    window.open(`mailto:?subject=${subject}&body=${body}`);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px',
      border: '1px solid var(--border)', marginTop: 6, maxWidth: 280,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }}>📍</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--font-m)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.name}
          </div>
          {data.address && (
            <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
              {data.address}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={addToMap}
          style={btn('sm', 'neutral', { flex: 1 })}
        >
          {t('chat.placeCardAddToMap')}
        </button>
        <button
          onClick={sendEmail}
          style={btn('sm', 'neutral', { flex: 1 })}
        >
          {t('chat.placeCardSendEmail')}
        </button>
      </div>
    </div>
  );
}

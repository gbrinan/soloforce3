import { useState, useRef } from 'react';
import type { FeatureRow } from '../lib/supabase';
import { uploadPhoto } from '../lib/photo';
import { completeNote } from '../lib/ai';
import { X, Trash2, Camera, MapPin, Minus, Square, Sparkles } from 'lucide-react';
import { confirmDialog, alertDialog } from './ConfirmDialog';
import { useI18n, type MessageKey } from '../i18n';
import { btn, iconBtn } from '../ui/controls';

const COLORS = [
  '#6366F1', '#ef4444', '#f59e0b', '#22c55e',
  '#14b8a6', '#a855f7', '#ec4899', '#f97316',
  '#06b6d4', '#84cc16', '#6366f1', '#64748b',
];

const MARKER_ICONS: { id: string; emoji: string; labelKey: MessageKey }[] = [
  { id: 'restaurant', emoji: '🍽️', labelKey: 'icon.restaurant' },
  { id: 'cafe', emoji: '☕', labelKey: 'icon.cafe' },
  { id: 'bar', emoji: '🍺', labelKey: 'icon.bar' },
  { id: 'camera', emoji: '📷', labelKey: 'icon.photo' },
  { id: 'museum', emoji: '🏛️', labelKey: 'icon.museum' },
  { id: 'star', emoji: '⭐', labelKey: 'icon.star' },
  { id: 'tree', emoji: '🌳', labelKey: 'icon.tree' },
  { id: 'mountain', emoji: '⛰️', labelKey: 'icon.mountain' },
  { id: 'ocean', emoji: '🌊', labelKey: 'icon.ocean' },
  { id: 'parking', emoji: '🅿️', labelKey: 'icon.parking' },
  { id: 'airplane', emoji: '✈️', labelKey: 'icon.airplane' },
  { id: 'train', emoji: '🚆', labelKey: 'icon.train' },
  { id: 'hotel', emoji: '🛏️', labelKey: 'icon.hotel' },
  { id: 'home', emoji: '🏠', labelKey: 'icon.home' },
  { id: 'market', emoji: '🛒', labelKey: 'icon.market' },
  { id: 'pharmacy', emoji: '💊', labelKey: 'icon.pharmacy' },
  { id: 'pin', emoji: '📍', labelKey: 'icon.pin' },
  { id: 'flag', emoji: '🚩', labelKey: 'icon.flag' },
];

const LINE_WEIGHTS: { labelKey: MessageKey; value: number }[] = [
  { labelKey: 'sheet.weightThin', value: 2 },
  { labelKey: 'sheet.weightNormal', value: 4 },
  { labelKey: 'sheet.weightThick', value: 7 },
];

const FILL_OPACITIES: { labelKey?: MessageKey; label?: string; value: number }[] = [
  { labelKey: 'sheet.fillNone', value: 0 },
  { label: '15%', value: 0.15 },
  { label: '30%', value: 0.30 },
  { label: '50%', value: 0.50 },
];

function haversineDist(coords: [number, number][]): number {
  let total = 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  for (let i = 1; i < coords.length; i++) {
    const lat1 = toRad(coords[i - 1][1]);
    const lat2 = toRad(coords[i][1]);
    const dLat = lat2 - lat1;
    const dLon = toRad(coords[i][0] - coords[i - 1][0]);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    total += 2 * 6371 * Math.asin(Math.sqrt(a));
  }
  return total;
}

function shoelaceArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const cosLat = Math.cos(toRad(latMid));
  const R = 6371;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const x1 = coords[i][0] * toRad(1) * R * cosLat;
    const y1 = coords[i][1] * toRad(1) * R;
    const x2 = coords[j][0] * toRad(1) * R * cosLat;
    const y2 = coords[j][1] * toRad(1) * R;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

type Props = {
  feature: FeatureRow;
  offline: boolean;
  onUpdate: (f: FeatureRow) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  marker: <MapPin size={14} />,
  line: <Minus size={14} />,
  polygon: <Square size={14} />,
};
const TYPE_LABEL: Record<string, MessageKey> = {
  marker: 'feature.marker', line: 'feature.line', polygon: 'feature.polygon',
};

function SectionTitle({ label }: { label: string }) {
  return <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>;
}

function ColorGrid({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            width: 24, height: 24, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
            boxShadow: value === c
              ? `0 0 0 2px var(--bg-surface), 0 0 0 4px ${c}`
              : '0 0 0 1px rgba(255,255,255,0.15)',
            transition: 'box-shadow 0.15s',
          }}
        />
      ))}
    </div>
  );
}

export default function FeatureSheet({ feature, offline, onUpdate, onDelete, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(feature.properties.name ?? '');
  const [address, setAddress] = useState(feature.properties.address ?? '');
  const [desc, setDesc] = useState(feature.properties.description ?? '');
  const [color, setColor] = useState<string>(feature.properties.color ?? '#6366F1');
  const [icon, setIcon] = useState<string>(feature.properties.icon ?? '');
  const [photoUrl, setPhotoUrl] = useState<string>(feature.properties.photo_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [weight, setWeight] = useState<number>(feature.properties.weight ?? 4);
  const [dash, setDash] = useState<boolean>(feature.properties.dash ?? false);
  const [fillOpacity, setFillOpacity] = useState<number>(feature.properties.fill_opacity ?? 0.25);
  const [strokeColor, setStrokeColor] = useState<string>(
    feature.properties.stroke_color ?? (feature.properties.color ?? '#6366F1'),
  );
  const fileRef = useRef<HTMLInputElement>(null);

  let lineCoords: [number, number][] = [];
  let polyCoords: [number, number][] = [];
  if (feature.type === 'line' && feature.geometry.type === 'LineString') {
    lineCoords = feature.geometry.coordinates;
  } else if (feature.type === 'polygon' && feature.geometry.type === 'Polygon') {
    polyCoords = feature.geometry.coordinates[0].slice(0, -1);
  }
  const distKm = lineCoords.length >= 2 ? haversineDist(lineCoords) : null;
  const areaKm2 = polyCoords.length >= 3 ? shoelaceArea(polyCoords) : null;

  async function save() {
    setSaveStatus('saving');
    try {
      const props = {
        ...feature.properties,
        name,
        address: address || undefined,
        description: desc,
        color,
        icon: icon || undefined,
        photo_url: photoUrl || undefined,
        weight: feature.type === 'line' ? weight : undefined,
        dash: feature.type === 'line' ? dash : undefined,
        fill_opacity: feature.type === 'polygon' ? fillOpacity : undefined,
        stroke_color: feature.type === 'polygon' ? strokeColor : undefined,
      };
      await onUpdate({ ...feature, properties: props });
      setSaveStatus('ok');
      setTimeout(() => onClose(), 800);
    } catch (e) {
      console.error('[FeatureSheet] save error:', e);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }

  // Feature 3: fill the memo field from local Claude CLI knowledge (via /ai/note)
  async function autoNote() {
    if (noteLoading) return;
    if (offline) { await alertDialog(t('sheet.noteOnlineOnly')); return; }
    const placeName = name.trim() || feature.properties.name?.trim() || '';
    if (!placeName) { await alertDialog(t('sheet.enterNameFirst')); return; }
    setNoteLoading(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      if (feature.geometry.type === 'Point') {
        [lng, lat] = feature.geometry.coordinates;
      }
      const note = await completeNote({ name: placeName, address: address.trim() || undefined, lat, lng });
      setDesc(note);
    } catch (e) {
      await alertDialog(e instanceof Error ? e.message : t('sheet.noteFail'));
    } finally {
      setNoteLoading(false);
    }
  }

  async function handlePhoto(file: File) {
    if (offline) { await alertDialog(t('sheet.photoOnlineOnly')); return; }
    setUploading(true);
    const url = await uploadPhoto(file, feature.id);
    if (url) setPhotoUrl(url);
    setUploading(false);
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
      maxHeight: '55vh', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{TYPE_ICON[feature.type]}</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t(TYPE_LABEL[feature.type])}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={async () => {
            const ok = await confirmDialog({ message: t('common.deleteItemConfirm'), confirmLabel: t('common.delete'), danger: true });
            if (ok) void onDelete(feature.id);
          }}
          style={iconBtn('sm', 'dangerSubtle', { border: 'none' })}
          title={t('common.delete')}
        >
          <Trash2 size={15} />
        </button>
        <button
          onClick={onClose}
          style={iconBtn('sm', 'subtle', { border: 'none' })}
        >
          <X size={15} />
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('sheet.namePlaceholder')}
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '8px 12px', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600,
          outline: 'none', width: '100%', boxSizing: 'border-box',
        }}
      />

      {feature.type === 'marker' && (
        <div>
          <SectionTitle label={t('sheet.address')} />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t('sheet.addressPlaceholder')}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 12px', color: 'var(--text-primary)', fontSize: 14,
              outline: 'none', width: '100%', boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('sheet.description')}</span>
          {feature.type === 'marker' && (
            <button
              onClick={() => void autoNote()}
              disabled={noteLoading}
              title={t('sheet.autoNoteTitle')}
              style={btn('sm', 'neutral', { gap: 4, opacity: noteLoading ? 0.6 : 1 })}
            >
              <Sparkles size={12} />
              {noteLoading ? t('common.generating') : t('sheet.autoNote')}
            </button>
          )}
        </div>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t('sheet.descPlaceholder')}
          rows={2}
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '8px 12px', color: 'var(--text-primary)', fontSize: 14, outline: 'none',
            width: '100%', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <SectionTitle label={feature.type === 'polygon' ? t('sheet.fillColor') : t('sheet.color')} />
        <ColorGrid value={color} onChange={setColor} />
      </div>

      {feature.type === 'polygon' && (
        <>
          <div>
            <SectionTitle label={t('sheet.strokeColor')} />
            <ColorGrid value={strokeColor} onChange={setStrokeColor} />
          </div>
          <div>
            <SectionTitle label={t('sheet.fillOpacity')} />
            <div style={{ display: 'flex', gap: 6 }}>
              {FILL_OPACITIES.map((op) => (
                <button
                  key={op.value}
                  onClick={() => setFillOpacity(op.value)}
                  style={btn('sm', fillOpacity === op.value ? 'primary' : 'neutral', {
                    ...(fillOpacity === op.value ? null : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }),
                  })}
                >
                  {op.labelKey ? t(op.labelKey) : op.label}
                </button>
              ))}
            </div>
          </div>
          {areaKm2 !== null && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('sheet.area', { v: areaKm2 < 1 ? `${(areaKm2 * 1_000_000).toFixed(0)} m²` : `${areaKm2.toFixed(3)} km²` })}
            </div>
          )}
        </>
      )}

      {feature.type === 'line' && (
        <>
          <div>
            <SectionTitle label={t('sheet.weightLabel')} />
            <div style={{ display: 'flex', gap: 6 }}>
              {LINE_WEIGHTS.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setWeight(w.value)}
                  style={btn('sm', weight === w.value ? 'primary' : 'neutral', {
                    ...(weight === w.value ? null : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }),
                  })}
                >
                  {t(w.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle label={t('sheet.styleLabel')} />
            <div style={{ display: 'flex', gap: 6 }}>
              {([{ key: 'sheet.solid', d: false }, { key: 'sheet.dashed', d: true }] as const).map(({ key, d }) => (
                <button
                  key={key}
                  onClick={() => setDash(d)}
                  style={btn('sm', dash === d ? 'primary' : 'neutral', {
                    ...(dash === d ? null : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }),
                  })}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
          {distKm !== null && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('sheet.distance', { v: distKm < 1 ? `${(distKm * 1000).toFixed(0)} m` : `${distKm.toFixed(2)} km` })}
            </div>
          )}
        </>
      )}

      {feature.type === 'marker' && (
        <div>
          <SectionTitle label={t('sheet.iconLabel')} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {MARKER_ICONS.map((ic) => (
              <button
                key={ic.id}
                onClick={() => setIcon(icon === ic.id ? '' : ic.id)}
                title={t(ic.labelKey)}
                style={{
                  width: 32, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer',
                  fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: icon === ic.id ? 'rgba(99,102,241,0.2)' : 'var(--bg-elevated)',
                  outline: icon === ic.id ? '2px solid #6366F1' : 'none',
                }}
              >
                {ic.emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {feature.type === 'marker' && (
        <div>
          <SectionTitle label={t('sheet.photoLabel')} />
          {photoUrl ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img src={photoUrl} alt="feature" style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 6 }} />
              <button
                onClick={() => setPhotoUrl('')}
                style={{
                  position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)',
                  border: 'none', borderRadius: '50%', width: 18, height: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                <X size={10} color="#fff" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={btn('sm', 'subtle', {
                gap: 6, background: 'var(--bg-elevated)', border: '1px dashed var(--border)',
              })}
            >
              <Camera size={13} />
              {uploading ? t('sheet.uploading') : t('sheet.addPhoto')}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhoto(f); }}
          />
        </div>
      )}

      <button
        onClick={() => void save()}
        disabled={saveStatus === 'saving'}
        style={btn('md', saveStatus === 'error' ? 'danger' : 'primary', {
          width: '100%', fontWeight: 600,
          opacity: saveStatus === 'saving' ? 0.7 : 1,
          transition: 'background 0.2s',
          ...(saveStatus === 'ok' ? { background: '#34D399', border: '1px solid #34D399' } : null),
        })}
      >
        {saveStatus === 'saving' ? t('sheet.saving') : saveStatus === 'ok' ? t('sheet.saved') : saveStatus === 'error' ? t('sheet.saveFail') : t('sheet.save')}
      </button>
    </div>
  );
}

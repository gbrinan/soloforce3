import { useState } from 'react';
import type { LayerRow, FeatureRow } from '../lib/supabase';
import { toKML, downloadKML } from '../lib/kml';
import { X, Download } from 'lucide-react';
import { useI18n } from '../i18n';
import { btn, iconBtn } from '../ui/controls';

type Props = {
  mapName: string;
  layers: LayerRow[];
  features: FeatureRow[];
  onClose: () => void;
};

export default function KmlExportModal({ mapName, layers, features, onClose }: Props) {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(layers.map((l) => l.id)),
  );
  const [includePhotos, setIncludePhotos] = useState(true);
  const today = new Date().toISOString().slice(0, 10);
  const [filename, setFilename] = useState(`${mapName}_${today}`);

  function toggleLayer(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDownload() {
    const filteredFeatures = features.filter((f) => selectedIds.has(f.layer_id));
    const filteredLayers = layers.filter((l) => selectedIds.has(l.id));
    const kml = toKML(filename || mapName, filteredLayers, filteredFeatures);
    downloadKML(filename || mapName, kml);
    onClose();
  }

  const featureCount = (layerId: string) => features.filter((f) => f.layer_id === layerId).length;

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
        width: 380, maxWidth: '90vw', boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{t('kml.title')}</span>
          <button onClick={onClose} style={iconBtn('sm', 'subtle', { border: 'none' })}>
            <X size={18} />
          </button>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('kml.selectLayers')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {layers.map((layer) => (
              <label
                key={layer.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  background: selectedIds.has(layer.id) ? 'rgba(99,102,241,0.1)' : 'var(--bg-elevated)',
                  border: `1px solid ${selectedIds.has(layer.id) ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(layer.id)}
                  onChange={() => toggleLayer(layer.id)}
                  style={{ accentColor: '#6366F1' }}
                />
                <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}>{layer.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('kml.itemCount', { n: featureCount(layer.id) })}</span>
              </label>
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includePhotos}
            onChange={(e) => setIncludePhotos(e.target.checked)}
            style={{ accentColor: '#6366F1' }}
          />
          <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{t('kml.includePhotos')}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('kml.photosAsUrl')}</span>
        </label>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('kml.filename')}</div>
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-primary)', fontSize: 14, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={btn('md', 'neutral', { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' })}
          >{t('common.cancel')}</button>
          <button
            onClick={handleDownload}
            disabled={selectedIds.size === 0}
            style={btn('md', 'primary', {
              gap: 6,
              ...(selectedIds.size === 0
                ? { background: 'var(--bg-elevated)', border: '1px solid var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'default' }
                : null),
            })}
          >
            <Download size={14} />
            {t('kml.download')}
          </button>
        </div>
      </div>
    </div>
  );
}

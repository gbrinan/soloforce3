import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { suggestPlaces, type AiPlace } from '../lib/ai';
import { useI18n } from '../i18n';
import { btn, iconBtn } from '../ui/controls';

type Props = {
  layerName: string;
  onAdd: (places: AiPlace[]) => void;
  onClose: () => void;
};

export default function AiPlacesModal({ layerName, onAdd, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AiPlace[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  async function run() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const places = await suggestPlaces(q);
      if (!places.length) {
        setError(t('ai.noSuggestions'));
        return;
      }
      setResults(places);
      setChecked(new Set(places.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ai.requestFail'));
    } finally {
      setLoading(false);
    }
  }

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const selectedCount = checked.size;

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
        width: 420, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={16} /> {t('ai.placesTitle')}
          </span>
          <button onClick={onClose} aria-label={t('common.close')} style={iconBtn('sm', 'subtle', { border: 'none' })}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
            placeholder={t('ai.placesPlaceholder')}
            autoFocus
            style={{
              flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 12px', color: 'var(--text-primary)', fontSize: 14,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => void run()}
            disabled={loading || !query.trim()}
            style={btn('md', 'primary', { opacity: loading || !query.trim() ? 0.6 : 1 })}
          >
            {loading ? t('common.generating') : t('ai.suggest')}
          </button>
        </div>

        {loading && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('ai.placesLoading')}
          </div>
        )}
        {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}

        {results && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {results.map((p, i) => (
                <label
                  key={`${p.name}-${i}`}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                    background: checked.has(i) ? 'rgba(99,102,241,0.1)' : 'var(--bg-elevated)',
                    border: `1px solid ${checked.has(i) ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    onChange={() => toggle(i)}
                    style={{ accentColor: '#6366F1', marginTop: 2 }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                    {p.note && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.35 }}>{p.note}</span>}
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', opacity: 0.7 }}>
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <button
              onClick={() => {
                const selected = results.filter((_, i) => checked.has(i));
                if (selected.length) onAdd(selected);
                onClose();
              }}
              disabled={selectedCount === 0}
              style={btn('md', 'primary', { width: '100%', fontWeight: 600, opacity: selectedCount === 0 ? 0.6 : 1 })}
            >
              {t('ai.addSelected', { count: selectedCount, layer: layerName })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

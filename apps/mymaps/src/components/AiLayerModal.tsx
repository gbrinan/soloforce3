import { useState } from 'react';
import { X, Wand2 } from 'lucide-react';
import { parseLayerRequest } from '../lib/ai';
import { search, type SearchResult } from '../lib/search';
import { useI18n } from '../i18n';
import { btn, iconBtn } from '../ui/controls';

export type AiLayerResult = { name: string; color: string; places: SearchResult[]; missed: string[] };

type Props = {
  onCreate: (result: AiLayerResult) => Promise<void>;
  onClose: () => void;
};

type Stage = 'idle' | 'parsing' | 'searching' | 'creating';

export default function AiLayerModal({ onCreate, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [layerName, setLayerName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const busy = stage !== 'idle';

  async function run() {
    const q = query.trim();
    if (!q || busy) return;
    setError(null);
    try {
      setStage('parsing');
      const plan = await parseLayerRequest(q);
      setLayerName(plan.layerName);

      setStage('searching');
      setProgress({ done: 0, total: plan.queries.length });
      const places: SearchResult[] = [];
      const missed: string[] = [];
      // Single category query (e.g. "서울 5성급 호텔") → take multiple results;
      // individual place queries → top hit each. Sequential to respect Nominatim 1 req/s.
      const single = plan.queries.length === 1;
      for (let i = 0; i < plan.queries.length; i++) {
        try {
          const results = await search(plan.queries[i]);
          if (single) places.push(...results.slice(0, 10));
          else if (results[0]) places.push(results[0]);
          else missed.push(plan.queries[i]);
        } catch {
          missed.push(plan.queries[i]);
        }
        setProgress({ done: i + 1, total: plan.queries.length });
      }
      const seen = new Set<string>();
      const deduped = places.filter((p) => {
        const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!deduped.length) {
        setError(t('ai.layerNoResults'));
        setStage('idle');
        return;
      }

      setStage('creating');
      await onCreate({ name: plan.layerName, color: plan.color, places: deduped, missed });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ai.layerFail'));
      setStage('idle');
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 14, padding: 24,
        width: 420, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Wand2 size={16} /> {t('ai.layerTitle')}
          </span>
          <button onClick={onClose} disabled={busy} aria-label={t('common.close')} style={iconBtn('sm', 'subtle', { border: 'none', opacity: busy ? 0.4 : 1 })}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
            placeholder={t('ai.layerPlaceholder')}
            autoFocus
            disabled={busy}
            style={{
              flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 12px', color: 'var(--text-primary)', fontSize: 14,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => void run()}
            disabled={busy || !query.trim()}
            style={btn('md', 'primary', { opacity: busy || !query.trim() ? 0.6 : 1 })}
          >
            {busy ? t('common.generating') : t('ai.createLayer')}
          </button>
        </div>

        {stage === 'parsing' && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('ai.parsing')}
          </div>
        )}
        {stage === 'searching' && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {layerName ? `"${layerName}" — ` : ''}{t('ai.searching', { done: progress.done, total: progress.total })}
          </div>
        )}
        {stage === 'creating' && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('ai.creating')}
          </div>
        )}
        {error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</div>}

        {stage === 'idle' && !error && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {t('ai.layerHint')}
          </div>
        )}
      </div>
    </div>
  );
}

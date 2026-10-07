import { useState, useRef } from 'react';
import { search, type SearchResult } from '../lib/search';
import { useI18n } from '../i18n';
import { Search, X, Loader2, MapPin } from 'lucide-react';

type Props = {
  onResult: (lng: number, lat: number, name: string, address: string) => void;
  onClose: () => void;
};

export default function SearchBar({ onResult, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(q: string) {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await search(q);
        setResults(res);
        if (res.length === 0) setError(t('search.noResults'));
      } catch {
        setError(t('search.fail'));
      }
      setLoading(false);
    }, 600);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: results.length ? '10px 10px 0 0' : 10, padding: '8px 12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}>
        {loading
          ? <Loader2 size={15} color="var(--text-secondary)" style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          : <Search size={15} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
        }
        <input
          autoFocus
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={t('search.placeholder')}
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: 14,
          }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 2 }}>
            <X size={14} color="var(--text-secondary)" />
          </button>
        )}
      </div>

      {/* Results */}
      {(results.length > 0 || error) && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderTop: 'none', borderRadius: '0 0 10px 10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {error && !results.length ? (
            <div style={{ padding: '10px 14px', fontSize: 14, color: 'var(--text-secondary)' }}>{error}</div>
          ) : (
            results.map((r, i) => (
              <button
                key={i}
                onClick={() => onResult(r.lng, r.lat, r.name, r.address)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', padding: '10px 14px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <MapPin size={14} color="var(--text-secondary)" style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 14, fontWeight: r.name ? 600 : 400, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {r.name || r.address}
                  </div>
                  {r.name && r.address && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.3, marginTop: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {r.address}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

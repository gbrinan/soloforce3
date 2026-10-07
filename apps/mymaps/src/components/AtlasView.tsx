import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Search, Globe2, X, Cloud, CloudOff } from 'lucide-react';
import { Map as MapCN, MapGeoJSON, MapMarker, MarkerContent, type MapRef } from './ui/map';
import { useI18n } from '../i18n';
import { iconBtn } from '../ui/controls';
import { supabase } from '../lib/supabase';
import { onAuthReady, getUserId } from '../lib/auth';

// TREK Atlas 참고 — 세계지도에서 방문한 국가를 토글·검색·통계로 관리하는 뷰.
// 지도는 mapcn(MapLibre) blank 캔버스 + 국가 GeoJSON choropleth로 구성.

type CountryProps = { iso: string; name: string; continent: string };
type CountryMeta = CountryProps & { bounds: [[number, number], [number, number]] };

const STORAGE_KEY = 'mymaps:atlas:visited:v1';
const DATA_URL = `${import.meta.env.BASE_URL}data/countries.geojson`;

// 앱 네이비 팔레트에 맞춘 지도 색
const COLOR = {
  visited: '#6366F1',
  visitedHover: '#818CF8',
  base: '#243050',
  baseHover: '#2F3D63',
  line: '#0A0F1E',
};

// TREK 통계 바와 동일한 대륙 순서 (Antarctica·공해는 통계 제외)
const CONTINENTS: { key: string; label: string }[] = [
  { key: 'Europe', label: 'EUROPE' },
  { key: 'Asia', label: 'ASIA' },
  { key: 'North America', label: 'N. AMERICA' },
  { key: 'South America', label: 'S. AMERICA' },
  { key: 'Africa', label: 'AFRICA' },
  { key: 'Oceania', label: 'OCEANIA' },
];

// 로컬 저장 형식: { list, at } — at(마지막 수정 시각)으로 기기 간 last-write-wins 병합.
// 구버전(순수 배열) 저장분은 at=epoch 0으로 읽어 원격이 항상 이긴다.
type VisitedSnapshot = { list: string[]; at: string };

function loadVisitedSnapshot(): VisitedSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { list: [], at: new Date(0).toISOString() };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { list: parsed.filter((v) => typeof v === 'string'), at: new Date(0).toISOString() };
    if (parsed && Array.isArray(parsed.list)) {
      return { list: parsed.list.filter((v: unknown) => typeof v === 'string'), at: typeof parsed.at === 'string' ? parsed.at : new Date(0).toISOString() };
    }
    return { list: [], at: new Date(0).toISOString() };
  } catch {
    return { list: [], at: new Date(0).toISOString() };
  }
}

function saveVisited(visited: Set<string>, at: string = new Date().toISOString()) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: [...visited], at }));
}

// Supabase Auth user_metadata에 방문국 저장 (기기 간 동기화).
// 별도 테이블 대신 metadata를 쓰는 이유: 프로젝트 DDL 권한이 이 환경에 없고,
// 데이터가 ISO 코드 배열(수 KB)로 초소형이라 metadata로 충분.
async function pushRemote(visited: Set<string>, at: string): Promise<boolean> {
  if (!supabase || !getUserId()) return false;
  const { error } = await supabase.auth.updateUser({
    data: { atlas_visited: [...visited], atlas_visited_at: at },
  });
  return !error;
}

async function pullRemote(): Promise<VisitedSnapshot | null> {
  if (!supabase || !getUserId()) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const meta = data.user.user_metadata ?? {};
  if (!Array.isArray(meta.atlas_visited)) return null;
  return {
    list: meta.atlas_visited.filter((v: unknown) => typeof v === 'string'),
    at: typeof meta.atlas_visited_at === 'string' ? meta.atlas_visited_at : new Date(0).toISOString(),
  };
}

// Polygon/MultiPolygon 좌표를 훑어 [[west,south],[east,north]] bbox 계산 (fitBounds용)
function geometryBounds(geom: GeoJSON.Geometry): [[number, number], [number, number]] {
  let w = 180, s = 90, e = -180, n = -90;
  const visit = (coords: unknown) => {
    if (typeof (coords as number[])[0] === 'number') {
      const [lng, lat] = coords as [number, number];
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    } else {
      for (const c of coords as unknown[]) visit(c);
    }
  };
  if ('coordinates' in geom) visit(geom.coordinates);
  return [[w, s], [e, n]];
}

export default function AtlasView({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const mapRef = useRef<MapRef>(null);
  const [countries, setCountries] = useState<CountryMeta[]>([]);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(loadVisitedSnapshot().list));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [hovered, setHovered] = useState<CountryProps | null>(null);
  const [syncState, setSyncState] = useState<'offline' | 'synced' | 'syncing'>('offline');
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Supabase 동기화 (auth 준비 후): 원격 vs 로컬 타임스탬프 비교 → 최신 쪽 채택(last-write-wins).
  // 로컬이 최신이면 원격에 밀어올리고, 원격이 최신이면 로컬을 덮어쓴다.
  useEffect(() => {
    let alive = true;
    onAuthReady(() => {
      if (!alive || !supabase || !getUserId()) return;
      setSyncState('syncing');
      pullRemote().then(async (remote) => {
        if (!alive) return;
        const local = loadVisitedSnapshot();
        if (remote && remote.at > local.at) {
          const next = new Set(remote.list);
          saveVisited(next, remote.at);
          setVisited(next);
          setSyncState('synced');
        } else {
          const ok = await pushRemote(new Set(local.list), local.at);
          if (alive) setSyncState(ok ? 'synced' : 'offline');
        }
      });
    });
    return () => { alive = false; };
  }, []);

  // 토글 직후 원격 push (800ms 디바운스 — 연속 클릭 병합)
  const schedulePush = (next: Set<string>, at: string) => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      if (!supabase || !getUserId()) return;
      setSyncState('syncing');
      const ok = await pushRemote(next, at);
      setSyncState(ok ? 'synced' : 'offline');
    }, 800);
  };

  useEffect(() => {
    let alive = true;
    fetch(DATA_URL)
      .then((r) => r.json())
      .then((fc: GeoJSON.FeatureCollection) => {
        if (!alive) return;
        setGeojson(fc);
        const meta = fc.features
          .map((f) => ({
            ...(f.properties as CountryProps),
            bounds: geometryBounds(f.geometry),
          }))
          .filter((c) => c.continent !== 'Antarctica' && c.continent !== 'Seven seas (open ocean)')
          .sort((a, b) => a.name.localeCompare(b.name));
        setCountries(meta);
      })
      .catch(() => { /* 데이터 로드 실패 시 빈 지도 유지 */ });
    return () => { alive = false; };
  }, []);

  const byIso = useMemo(() => new globalThis.Map(countries.map((c) => [c.iso, c])), [countries]);

  const toggle = (iso: string) => {
    if (!byIso.has(iso)) return; // Antarctica 등 통계 제외 지역은 토글 안 함
    setVisited((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      const at = new Date().toISOString();
      saveVisited(next, at);
      schedulePush(next, at);
      return next;
    });
  };

  const visitedList = useMemo(() => [...visited], [visited]);

  // 방문국은 accent, 나머지는 어두운 면 색 — visited 변경 시 표현식 재계산 → 즉시 반영
  const fillPaint = useMemo(() => ({
    'fill-color': [
      'case',
      ['in', ['get', 'iso'], ['literal', visitedList]],
      COLOR.visited,
      COLOR.base,
    ],
    'fill-opacity': 1,
  } as never), [visitedList]);

  const fillHoverPaint = useMemo(() => ({
    'fill-color': [
      'case',
      ['in', ['get', 'iso'], ['literal', visitedList]],
      COLOR.visitedHover,
      COLOR.baseHover,
    ],
  } as never), [visitedList]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return countries.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, countries]);

  const selectCountry = (c: CountryMeta) => {
    setQuery('');
    setSearchOpen(false);
    if (!visited.has(c.iso)) toggle(c.iso);
    mapRef.current?.fitBounds(c.bounds, { padding: 120, maxZoom: 6, duration: 900 });
  };

  // 초소형 국가(싱가포르 등)는 세계지도 줌에서 폴리곤이 1px 미만이라 클릭 불가 →
  // 점 마커를 항상 표시. 방문국은 발광 점, 미방문국은 흐린 점(클릭하면 방문 토글).
  // 기준: bbox 최장 변 1.5° 미만 (싱가포르 0.4°, 몰타 0.25° 등 도시국가·군소국 해당)
  const smallCountries = useMemo(
    () => countries.filter((c) => {
      const [[w, s], [e, n]] = c.bounds;
      return Math.max(e - w, n - s) < 1.5;
    }),
    [countries],
  );

  const continentStats = CONTINENTS.map(({ key, label }) => {
    const total = countries.filter((c) => c.continent === key).length;
    const count = countries.filter((c) => c.continent === key && visited.has(c.iso)).length;
    return { label, count, total };
  });

  return (
    <div style={{ position: 'relative', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>
      <MapCN
        ref={mapRef}
        blank
        theme="dark"
        center={[15, 25]}
        zoom={1.4}
        minZoom={0.8}
        maxZoom={7}
        attributionControl={false}
      >
        {geojson && (
          <MapGeoJSON
            data={geojson}
            promoteId="iso"
            interactive
            fillPaint={fillPaint}
            fillHoverPaint={fillHoverPaint}
            linePaint={{ 'line-color': COLOR.line, 'line-width': 0.6 }}
            onClick={(e) => toggle((e.feature.properties as CountryProps).iso)}
            onHover={(e) => setHovered(e ? (e.feature.properties as CountryProps) : null)}
          />
        )}
        {smallCountries.map((c) => {
          const isVisited = visited.has(c.iso);
          return (
            <MapMarker
              key={c.iso}
              longitude={(c.bounds[0][0] + c.bounds[1][0]) / 2}
              latitude={(c.bounds[0][1] + c.bounds[1][1]) / 2}
              onClick={(e) => { e.stopPropagation(); toggle(c.iso); }} // 캔버스 버블링 차단 — 점 밑 폴리곤 동시 토글 방지
              onMouseEnter={() => setHovered(c)}
              onMouseLeave={() => setHovered(null)}
            >
              <MarkerContent>
                <div
                  title={c.name}
                  style={isVisited ? {
                    width: 9, height: 9, borderRadius: '50%',
                    background: COLOR.visited,
                    boxShadow: `0 0 0 2px rgba(99,102,241,0.35), 0 0 6px ${COLOR.visited}`,
                  } : {
                    width: 7, height: 7, borderRadius: '50%',
                    background: 'rgba(157,183,235,0.28)',
                    border: '1px solid rgba(157,183,235,0.45)',
                  }}
                />
              </MarkerContent>
            </MapMarker>
          );
        })}
      </MapCN>

      {/* 상단 바: 뒤로가기 + 검색 */}
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
        <button onClick={onBack} style={{ ...iconBtn('md'), pointerEvents: 'auto', background: 'var(--bg-elevated)' }} title={t('atlas.backToMaps')}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ position: 'relative', width: 'min(420px, 60%)', margin: '0 auto', pointerEvents: 'auto' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 999,
          }}>
            <Search size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) selectCountry(results[0]); }}
              placeholder={t('atlas.searchCountry')}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }}
            />
            {query && (
              <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                <X size={13} style={{ color: 'var(--text-secondary)' }} />
              </button>
            )}
          </div>
          {searchOpen && results.length > 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12,
              overflow: 'hidden', zIndex: 10,
            }}>
              {results.map((c) => (
                <button
                  key={c.iso}
                  onClick={() => selectCountry(c)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-primary)', fontSize: 13, textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <span>{c.name}</span>
                  {visited.has(c.iso) && <span style={{ color: COLOR.visited, fontSize: 11 }}>{t('atlas.visited')}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ width: 36, flexShrink: 0 }} />
      </div>

      {/* 호버 중인 국가 이름 */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)',
          padding: '4px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 999, fontSize: 12, color: 'var(--text-primary)', pointerEvents: 'none',
        }}>
          {hovered.name}{visited.has(hovered.iso) ? t('atlas.visitedSuffix') : ''}
        </div>
      )}

      {/* 하단 통계 바 (TREK Stats 참고) */}
      <div style={{
        position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'stretch', gap: 20, padding: '14px 22px',
        background: 'rgba(15,23,38,0.88)', border: '1px solid var(--border)', borderRadius: 16,
        backdropFilter: 'blur(8px)', maxWidth: 'calc(100% - 32px)', overflowX: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 20, borderRight: '1px solid var(--border)' }}>
          <Globe2 size={18} style={{ color: COLOR.visited }} />
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{visited.size}</div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: 0.5 }}>COUNTRIES / {countries.length}</div>
          </div>
          <div
            title={syncState === 'synced' ? t('atlas.syncSynced') : syncState === 'syncing' ? t('atlas.syncing') : t('atlas.syncOffline')}
            style={{ display: 'flex', alignItems: 'center', marginLeft: 4 }}
          >
            {syncState === 'offline'
              ? <CloudOff size={13} style={{ color: 'var(--text-secondary)', opacity: 0.6 }} />
              : <Cloud size={13} style={{ color: syncState === 'synced' ? 'var(--success)' : 'var(--text-secondary)' }} />}
          </div>
        </div>
        {continentStats.map((s) => (
          <div key={s.label} style={{ textAlign: 'center', minWidth: 56 }}>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, color: s.count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)', opacity: s.count > 0 ? 1 : 0.45 }}>
              {s.count}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', letterSpacing: 0.5, opacity: s.count > 0 ? 1 : 0.45 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

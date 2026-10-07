import { useState, useEffect } from 'react';
import { useI18n } from './i18n';
import { onAuthReady, isOfflineMode, getUserId } from './lib/auth';
import MapsList from './components/MapsList';
import MapEditor from './components/MapEditor';
import AtlasView from './components/AtlasView';
import ConfirmDialog from './components/ConfirmDialog';

type View = { kind: 'list' } | { kind: 'editor'; mapId: string; mapName: string } | { kind: 'atlas' };

export default function App() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });

  useEffect(() => {
    onAuthReady(() => {
      setOffline(isOfflineMode() || !getUserId());
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--bg-base)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            border: '2px solid rgba(255,255,255,0.1)',
            borderTopColor: '#6366F1',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{t('common.loading')}</span>
      </div>
    );
  }

  if (view.kind === 'atlas') {
    return <AtlasView onBack={() => setView({ kind: 'list' })} />;
  }

  if (view.kind === 'editor') {
    return (
      <>
        <MapEditor
          mapId={view.mapId}
          mapName={view.mapName}
          offline={offline}
          onBack={() => setView({ kind: 'list' })}
        />
        <ConfirmDialog />
      </>
    );
  }

  return (
    <>
      <MapsList
        offline={offline}
        onOpenMap={(mapId, mapName) => setView({ kind: 'editor', mapId, mapName })}
        onOpenAtlas={() => setView({ kind: 'atlas' })}
      />
      <ConfirmDialog />
    </>
  );
}

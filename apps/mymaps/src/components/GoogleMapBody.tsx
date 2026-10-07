import { useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { incrementLoadCount } from '../lib/mapEngine';
import { pinIconUrl, PIN_W, PIN_H, PIN_SEL_W, PIN_SEL_H } from './PrettyMarker';
import { confirmDialog } from './ConfirmDialog';
import { t } from '../i18n';
import type { FeatureRow, FeatureType, FeatureGeometry, LayerRow } from '../lib/supabase';

type DrawMode = 'select' | 'marker' | 'line' | 'polygon' | 'measure';
type Basemap = 'streets' | 'satellite' | 'terrain';

export type SearchResultProp = {
  lng: number; lat: number; name: string; address: string; layerLabel: string;
};

type Props = {
  features: FeatureRow[];
  layers: LayerRow[];
  mode: DrawMode;
  basemap: Basemap;
  selected: FeatureRow | null;
  highlightedFeatureId?: string | null;
  searchResult: SearchResultProp | null;
  onFeatureSelect: (feat: FeatureRow | null) => void;
  onFeatureAdd: (type: FeatureType, geometry: FeatureGeometry, name?: string, address?: string) => Promise<void>;
  onFeatureDelete: (id: string) => Promise<void>;
  onCursorMove: (lng: number, lat: number) => void;
  onZoomChange: (zoom: number) => void;
  onMeasureCoords: (coords: [number, number][]) => void;
  onModeReset: () => void;
  onSearchResultClear: () => void;
  onFeatureHighlight?: (id: string | null) => void;
  flyToRef: React.MutableRefObject<((lng: number, lat: number, zoom?: number) => void) | null>;
  onLoadError?: (reason: string) => void;
};

const BASEMAP_TYPES: Record<Basemap, string> = {
  streets: 'roadmap',
  satellite: 'satellite',
  terrain: 'terrain',
};

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

export default function GoogleMapBody(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [googleMapReady, setGoogleMapReady] = useState(false);
  const onLoadErrorRef = useRef(props.onLoadError);
  onLoadErrorRef.current = props.onLoadError;
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const polylinesRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const polygonsRef = useRef<Map<string, google.maps.Polygon>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const measureLineRef = useRef<google.maps.Polyline | null>(null);
  const measureCoordsRef = useRef<[number, number][]>([]);
  const drawLineRef = useRef<google.maps.Polyline | null>(null);
  const drawCoordsRef = useRef<[number, number][]>([]);
  const searchMarkerRef = useRef<google.maps.Marker | null>(null);
  const searchInfoRef = useRef<google.maps.InfoWindow | null>(null);

  // Stable refs to avoid stale closures in event listeners
  const featuresRef = useRef(props.features);
  const layersRef = useRef(props.layers);
  const modeRef = useRef(props.mode);
  const onFeatureSelectRef = useRef(props.onFeatureSelect);
  const onFeatureAddRef = useRef(props.onFeatureAdd);
  const onFeatureDeleteRef = useRef(props.onFeatureDelete);
  const onModeResetRef = useRef(props.onModeReset);
  const onMeasureCoordsRef = useRef(props.onMeasureCoords);
  const onSearchResultClearRef = useRef(props.onSearchResultClear);
  const onFeatureHighlightRef = useRef(props.onFeatureHighlight);

  featuresRef.current = props.features;
  layersRef.current = props.layers;
  modeRef.current = props.mode;
  onFeatureSelectRef.current = props.onFeatureSelect;
  onFeatureAddRef.current = props.onFeatureAdd;
  onFeatureDeleteRef.current = props.onFeatureDelete;
  onModeResetRef.current = props.onModeReset;
  onMeasureCoordsRef.current = props.onMeasureCoords;
  onSearchResultClearRef.current = props.onSearchResultClear;
  onFeatureHighlightRef.current = props.onFeatureHighlight;

  // Map initialization
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    let destroyed = false;

    // Detect Google Maps auth failure (invalid key, referrer restriction, billing disabled)
    // → notify parent so it can fallback to MapLibre engine instead of showing Google's error UI.
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      console.error('[GoogleMaps] gm_authFailure — API key rejected (referrer restriction / invalid key / billing / API not enabled)');
      onLoadErrorRef.current?.(t('editor.googleAuthFail'));
    };

    new Loader({ apiKey: GOOGLE_KEY, version: '3.64' })
      .load()
      .then(() => {
        if (destroyed) return;
        incrementLoadCount();
        // Remove default top padding from Google Maps InfoWindow container
        if (!document.getElementById('mm-iw-override')) {
          const s = document.createElement('style');
          s.id = 'mm-iw-override';
          s.textContent = '.gm-style-iw-c{padding:0!important}.gm-style-iw-d{overflow:auto!important;padding:0!important}.gm-style-iw-chr{position:absolute;top:0;right:0;z-index:10}';
          document.head.appendChild(s);
        }

        const map = new google.maps.Map(cont, {
          center: { lat: 37.566, lng: 126.978 },
          zoom: 10,
          mapTypeId: BASEMAP_TYPES[props.basemap] as google.maps.MapTypeId,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.LEFT_TOP },
          rotateControl: true,
          rotateControlOptions: { position: google.maps.ControlPosition.LEFT_BOTTOM },
          // greedy: 마우스 휠 즉시 줌 + 모바일 한 손가락 팬 (기본 'auto'는 iframe에서
          // Ctrl+휠/두 손가락을 요구할 수 있음)
          gestureHandling: 'greedy',
        });

        mapRef.current = map;
        setGoogleMapReady(true);
        infoWindowRef.current = new google.maps.InfoWindow();

        props.flyToRef.current = (lng, lat, zoom) => {
          map.panTo({ lat, lng });
          if (zoom !== undefined) map.setZoom(zoom);
        };

        map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) props.onCursorMove(e.latLng.lng(), e.latLng.lat());
        });

        map.addListener('zoom_changed', () => {
          props.onZoomChange(map.getZoom() ?? 10);
        });

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          const lng = e.latLng.lng();
          const lat = e.latLng.lat();
          const m = modeRef.current;

          if (m === 'marker') {
            void onFeatureAddRef.current('marker', { type: 'Point', coordinates: [lng, lat] });
            onModeResetRef.current();
            return;
          }

          if (m === 'line' || m === 'polygon') {
            const next: [number, number][] = [...drawCoordsRef.current, [lng, lat]];
            drawCoordsRef.current = next;
            const pathLatLng = next.map(([lngC, latC]) => ({ lat: latC, lng: lngC }));
            if (drawLineRef.current) {
              drawLineRef.current.setPath(pathLatLng);
            } else {
              drawLineRef.current = new google.maps.Polyline({
                path: pathLatLng,
                strokeColor: '#6366F1',
                strokeOpacity: 1,
                strokeWeight: 3,
                map,
              });
            }
            return;
          }

          if (m === 'measure') {
            const next: [number, number][] = [...measureCoordsRef.current, [lng, lat]];
            measureCoordsRef.current = next;
            onMeasureCoordsRef.current(next);
            if (measureLineRef.current) {
              measureLineRef.current.setPath(next.map(([lngC, latC]) => ({ lat: latC, lng: lngC })));
            } else {
              measureLineRef.current = new google.maps.Polyline({
                path: next.map(([lngC, latC]) => ({ lat: latC, lng: lngC })),
                geodesic: true,
                strokeColor: '#818CF8',
                strokeOpacity: 1,
                strokeWeight: 2,
                map,
              });
            }
            return;
          }

          if (m === 'select') {
            infoWindowRef.current?.close();
            onFeatureHighlightRef.current?.(null);
            onFeatureSelectRef.current(null);
          }
        });

        map.addListener('dblclick', () => {
          const m = modeRef.current;
          if (m === 'measure') {
            measureCoordsRef.current = [];
            onMeasureCoordsRef.current([]);
            measureLineRef.current?.setMap(null);
            measureLineRef.current = null;
            onModeResetRef.current();
            return;
          }
          if (m === 'line') {
            const path = drawCoordsRef.current;
            if (path.length >= 2) void onFeatureAddRef.current('line', { type: 'LineString', coordinates: path });
            drawLineRef.current?.setMap(null);
            drawLineRef.current = null;
            drawCoordsRef.current = [];
            onModeResetRef.current();
            return;
          }
          if (m === 'polygon') {
            const path = drawCoordsRef.current;
            if (path.length >= 3) void onFeatureAddRef.current('polygon', { type: 'Polygon', coordinates: [[...path, path[0]]] });
            drawLineRef.current?.setMap(null);
            drawLineRef.current = null;
            drawCoordsRef.current = [];
            onModeResetRef.current();
            return;
          }
        });

      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GoogleMaps] Loader failed:', msg, err);
        onLoadErrorRef.current?.(`Loader failed: ${msg}`);
      });

    return () => {
      destroyed = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current.clear();
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current.clear();
      measureLineRef.current?.setMap(null);
      measureLineRef.current = null;
      drawLineRef.current?.setMap(null);
      drawLineRef.current = null;
      drawCoordsRef.current = [];
      searchMarkerRef.current?.setMap(null);
      searchMarkerRef.current = null;
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      mapRef.current = null;
      props.flyToRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mode change → reset in-progress drawing state
  useEffect(() => {
    if (props.mode !== 'line' && props.mode !== 'polygon') {
      drawLineRef.current?.setMap(null);
      drawLineRef.current = null;
      drawCoordsRef.current = [];
    }
    if (props.mode !== 'measure') {
      measureCoordsRef.current = [];
      measureLineRef.current?.setMap(null);
      measureLineRef.current = null;
    }
  }, [props.mode]);

  // Basemap
  useEffect(() => {
    mapRef.current?.setMapTypeId(BASEMAP_TYPES[props.basemap] as google.maps.MapTypeId);
  }, [props.basemap]);

  // Feature sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visible = new Set(props.layers.filter((l) => l.visible).map((l) => l.id));

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current.clear();
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current.clear();
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current.clear();

    for (const f of props.features) {
      if (!visible.has(f.layer_id)) continue;
      const color = (f.properties.color as string | undefined) ?? '#6366F1';
      const isSelected = props.selected?.id === f.id || props.highlightedFeatureId === f.id;

      if (f.type === 'marker' && f.geometry.type === 'Point') {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const fId = f.id;
        // 선택 시 확대된 캔버스(38x52)에 맞춰 size/anchor 조정 → 상/하단 잘림 방지.
        // anchor는 캔버스 바닥 중앙(tip 위치). 기본 x=14, 선택 x=PIN_SEL_W/2=19.
        const mW = isSelected ? PIN_SEL_W : PIN_W;
        const mH = isSelected ? PIN_SEL_H : PIN_H;
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map,
          icon: {
            url: pinIconUrl(color, isSelected),
            scaledSize: new google.maps.Size(mW, mH),
            anchor: new google.maps.Point(mW / 2, mH),
          },
          optimized: false,
          title: f.properties.name as string | undefined,
        });

        marker.addListener('click', () => {
          if (modeRef.current !== 'select') return;
          const feat = featuresRef.current.find((f2) => f2.id === fId) ?? null;
          if (!feat || !infoWindowRef.current) return;
          onFeatureHighlightRef.current?.(fId);
          const iw = infoWindowRef.current;
          const el = document.createElement('div');
          el.style.cssText = 'font-family:inherit;width:260px;overflow:hidden;';
          const featColor = (feat.properties.color as string | undefined) ?? '#4F46E5';
          const safe = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const name = safe(String(feat.properties.name || t('feature.marker')));
          const layer = layersRef.current.find((l) => l.id === feat.layer_id);
          const layerName = layer?.name ? safe(String(layer.name)) : '';
          const photoHtml = feat.properties.photo_url
            ? `<img src="${safe(String(feat.properties.photo_url))}" style="width:100%;height:100px;object-fit:cover;display:block;"/>`
            : '';
          const badgeHtml = layerName
            ? `<div style="display:inline-flex;align-items:center;gap:4px;background:${featColor}1a;border:1px solid ${featColor}40;border-radius:999px;padding:2px 8px;margin-bottom:8px;"><span style="width:7px;height:7px;border-radius:50%;background:${featColor};flex-shrink:0;"></span><span style="font-size:12px;color:${featColor};font-weight:600;white-space:nowrap;">${layerName}</span></div>`
            : '';
          const addressHtml = feat.properties.address
            ? `<div style="font-size:12px;color:#6E7278;margin-bottom:6px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">📍 ${safe(String(feat.properties.address))}</div>`
            : '';
          const descHtml = feat.properties.description
            ? `<div style="font-size:12px;color:#04070F;white-space:pre-wrap;word-break:break-word;max-height:80px;overflow-y:auto;margin-bottom:10px;line-height:1.5;">${safe(String(feat.properties.description))}</div>`
            : '';
          el.innerHTML = `${photoHtml}<div style="padding:12px;">${badgeHtml}<div style="font-weight:700;font-size:16px;color:#04070F;line-height:1.3;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</div>${addressHtml}${descHtml}<div style="display:flex;gap:8px;"><button id="gm-pop-edit" style="flex:1;min-height:28px;padding:4px 12px;background:#4F46E5;border:none;border-radius:6px;color:#fff;font-size:12px;cursor:pointer;font-weight:600;">${t('common.edit')}</button><button id="gm-pop-del" style="flex:1;min-height:28px;padding:4px 12px;background:#DC2626;border:none;border-radius:6px;color:#fff;font-size:12px;cursor:pointer;font-weight:600;">${t('common.delete')}</button></div></div>`;
          el.querySelector('#gm-pop-edit')?.addEventListener('click', () => {
            onFeatureSelectRef.current(feat);
            iw.close();
          });
          el.querySelector('#gm-pop-del')?.addEventListener('click', async () => {
            const ok = await confirmDialog({ message: t('common.deleteItemConfirm'), confirmLabel: t('common.delete'), danger: true });
            if (ok) { void onFeatureDeleteRef.current(fId); iw.close(); }
          });
          iw.setContent(el);
          iw.open(map, marker);
        });

        if (isSelected) {
          marker.setAnimation(google.maps.Animation.BOUNCE);
          // BOUNCE는 무한 반복이므로 3회(1 bounce ≈ 0.7s) 후 정지.
          window.setTimeout(() => {
            try { marker.setAnimation(null); } catch { /* marker already removed */ }
          }, 2100);
        }
        markersRef.current.set(fId, marker);
      } else if (f.type === 'line' && f.geometry.type === 'LineString') {
        const path = (f.geometry.coordinates as [number, number][]).map(([lng, lat]) => ({ lat, lng }));
        const pl = new google.maps.Polyline({
          path, map,
          strokeColor: color,
          strokeWeight: (f.properties.weight as number | undefined) ?? 3,
          strokeOpacity: f.properties.dash ? 0 : 1,
          ...(f.properties.dash ? { icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '20px' }] } : {}),
        });
        polylinesRef.current.set(f.id, pl);
      } else if (f.type === 'polygon' && f.geometry.type === 'Polygon') {
        const path = (f.geometry.coordinates[0] as [number, number][]).map(([lng, lat]) => ({ lat, lng }));
        const pg = new google.maps.Polygon({
          paths: path, map,
          strokeColor: (f.properties.stroke_color as string | undefined) ?? color,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: (f.properties.fill_opacity as number | undefined) ?? 0.25,
        });
        polygonsRef.current.set(f.id, pg);
      }
    }
  }, [props.features, props.layers, props.selected, props.highlightedFeatureId, googleMapReady]);

  // Search result
  useEffect(() => {
    const map = mapRef.current;
    searchMarkerRef.current?.setMap(null);
    searchMarkerRef.current = null;
    searchInfoRef.current?.close();
    searchInfoRef.current = null;

    if (!map || !props.searchResult) return;
    const { lng, lat, name, address, layerLabel } = props.searchResult;

    const sm = new google.maps.Marker({
      position: { lat, lng },
      map,
      icon: {
        url: pinIconUrl('#4F46E5'),
        scaledSize: new google.maps.Size(28, 38),
        anchor: new google.maps.Point(14, 38),
      },
      optimized: false,
    });
    searchMarkerRef.current = sm;

    const el = document.createElement('div');
    el.style.cssText = 'font-family:inherit;min-width:200px;max-width:260px;';
    const safeName = (name || address).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeAddress = address.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    el.innerHTML = `<div style="padding:12px;"><div style="display:inline-flex;align-items:center;gap:4px;background:#4F46E51a;border:1px solid #4F46E540;border-radius:999px;padding:2px 8px;margin-bottom:8px;"><span style="font-size:12px;color:#4F46E5;font-weight:600;">🔍 ${t('editor.searchResult')}</span></div><div style="font-weight:700;font-size:14px;color:#04070F;margin-bottom:${name && address ? 4 : 8}px;line-height:1.3;">${safeName}</div>${name && address ? `<div style="font-size:12px;color:#6E7278;margin-bottom:6px;line-height:1.35;">📍 ${safeAddress}</div>` : ''}<div style="font-size:12px;color:#6E7278;margin-bottom:10px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div><button id="gm-s-add" style="width:100%;min-height:28px;padding:4px 12px;background:#4F46E5;border:none;border-radius:6px;color:#fff;font-size:12px;cursor:pointer;font-weight:600;">${t('editor.addToLayer', { layer: layerLabel })}</button></div>`;
    el.querySelector('#gm-s-add')?.addEventListener('click', async () => {
      await onFeatureAddRef.current('marker', { type: 'Point', coordinates: [lng, lat] }, name, address);
      onSearchResultClearRef.current();
    });

    const iw = new google.maps.InfoWindow({ content: el });
    iw.open(map, sm);
    iw.addListener('closeclick', () => onSearchResultClearRef.current());
    searchInfoRef.current = iw;
  }, [props.searchResult]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}

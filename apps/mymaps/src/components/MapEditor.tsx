import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification, GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import { supabase, type LayerRow, type FeatureRow, type FeatureType, type FeatureGeometry } from '../lib/supabase';
import { onAddPlace } from '../lib/host-bridge';
import { idb } from '../lib/offline';
import { toKML, downloadKML } from '../lib/kml';
import LayersPanel from './LayersPanel';
import FeatureSheet from './FeatureSheet';
import SearchBar from './SearchBar';
import KmlExportModal from './KmlExportModal';
import AiPlacesModal from './AiPlacesModal';
import AiLayerModal, { type AiLayerResult } from './AiLayerModal';
import RouteOptimizeModal from './RouteOptimizeModal';
import { confirmDialog, alertDialog } from './ConfirmDialog';
import GoogleMapBody, { type SearchResultProp } from './GoogleMapBody';
import FeaturePopup from './FeaturePopup';
import { selectEngine, type MapEngine } from '../lib/mapEngine';
import { createPinElement, setPinSelected } from './PrettyMarker';
import {
  ArrowLeft, Layers, MapPin, Minus, Square, Download,
  Map as MapIcon, Satellite, Mountain, Undo2, Ruler, Trash2,
  Sparkles, Route, Wand2,
} from 'lucide-react';
import type { AiPlace } from '../lib/ai';
import type { RoutePoint } from '../lib/route';
import { useI18n } from '../i18n';
import { iconBtn } from '../ui/controls';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

type DrawMode = 'select' | 'marker' | 'line' | 'polygon' | 'measure';
type Basemap = 'streets' | 'satellite' | 'terrain';

function basemapTiles(bm: Basemap, key?: string): { tiles: string[]; attr: string } {
  if (!key) {
    return { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attr: '© OpenStreetMap contributors' };
  }
  if (bm === 'satellite') {
    return { tiles: [`https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${key}`], attr: '© MapTiler © Maxar' };
  }
  if (bm === 'terrain') {
    return { tiles: [`https://api.maptiler.com/maps/topo-v2/{z}/{x}/{y}.png?key=${key}`], attr: '© MapTiler © OSM contributors' };
  }
  return { tiles: [`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${key}`], attr: '© MapTiler © OSM contributors' };
}

function buildStyle(bm: Basemap, key?: string): StyleSpecification {
  const { tiles, attr } = basemapTiles(bm, key);
  return {
    version: 8,
    sources: {
      basemap: { type: 'raster', tiles, tileSize: 256, attribution: attr, maxzoom: 19 },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}

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

// MapLibre click detection layers — markers handled via HTML elements, not layers
const ML_CLICK_LAYERS = ['mm-lines', 'mm-lines-dash', 'mm-polygons-fill'] as const;

type FC = { type: 'FeatureCollection'; features: GeoJSON.Feature[] };
function emptyFC(): FC { return { type: 'FeatureCollection', features: [] }; }

function toGeoJSON(rows: FeatureRow[], type: FeatureType, visible: Set<string>): FC {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((r) => r.type === type && visible.has(r.layer_id))
      .map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: r.geometry as GeoJSON.Geometry,
        properties: { ...r.properties, _id: r.id },
      })),
  };
}

function previewGeoJSON(coords: [number, number][], mode: 'line' | 'polygon' | 'measure'): FC {
  if (coords.length < 2) return emptyFC();
  const cs = (mode === 'polygon') && coords.length >= 3 ? [...coords, coords[0]] : coords;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: cs }, properties: {} }],
  };
}

const genId = () => crypto.randomUUID();

type Props = {
  mapId: string;
  mapName: string;
  offline: boolean;
  onBack: () => void;
};

export default function MapEditor({ mapId, mapName, offline, onBack }: Props) {
  const { t } = useI18n();
  const [engine, setEngine] = useState<MapEngine>(() => selectEngine(offline));
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const mlMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const flyToRef = useRef<((lng: number, lat: number, zoom?: number) => void) | null>(null);

  const modeRef = useRef<DrawMode>('select');
  const drawRef = useRef<[number, number][]>([]);
  const featuresRef = useRef<FeatureRow[]>([]);
  const layersRef = useRef<LayerRow[]>([]);
  const activeLayerRef = useRef<string | null>(null);
  const selectedRef = useRef<FeatureRow | null>(null);
  const deleteFeatureRef = useRef<((id: string) => Promise<void>) | undefined>(undefined);
  const addFeatureRef = useRef<((type: FeatureType, geometry: FeatureGeometry, name?: string, address?: string, description?: string) => Promise<void>) | undefined>(undefined);
  const searchPopupRef = useRef<maplibregl.Popup | null>(null);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [mode, setMode] = useState<DrawMode>('select');
  const [basemap, setBasemap] = useState<Basemap>('streets');
  const [useOSM, setUseOSM] = useState(false);
  const [layers, setLayers] = useState<LayerRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [selected, setSelected] = useState<FeatureRow | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [drawCoords, setDrawCoords] = useState<[number, number][]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [showKmlModal, setShowKmlModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showAiLayerModal, setShowAiLayerModal] = useState(false);
  const [routePoints, setRoutePoints] = useState<RoutePoint[] | null>(null);
  const [tileWarning, setTileWarning] = useState(false);
  const [cursorLng, setCursorLng] = useState<number | null>(null);
  const [cursorLat, setCursorLat] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(10);
  const [measureDist, setMeasureDist] = useState(0);
  const [searchResult, setSearchResult] = useState<SearchResultProp | null>(null);
  const [popupFeature, setPopupFeature] = useState<FeatureRow | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const setPopupFeatureRef = useRef(setPopupFeature);
  const setPopupPosRef = useRef(setPopupPos);

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('mymaps:layerPanelWidth'));
    return Number.isFinite(saved) && saved >= 200 && saved <= 480 ? saved : 260;
  });
  const resizingRef = useRef(false);

  // Sync refs
  setPopupFeatureRef.current = setPopupFeature;
  setPopupPosRef.current = setPopupPos;
  modeRef.current = mode;
  drawRef.current = drawCoords;
  featuresRef.current = features;
  layersRef.current = layers;
  activeLayerRef.current = activeLayerId;
  selectedRef.current = selected;

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const w = Math.min(480, Math.max(200, ev.clientX));
      setPanelWidth(w);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setPanelWidth((w) => { localStorage.setItem('mymaps:layerPanelWidth', String(w)); return w; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    if (mode === 'measure' && drawCoords.length >= 2) {
      setMeasureDist(haversineDist(drawCoords));
    } else {
      setMeasureDist(0);
    }
  }, [mode, drawCoords]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      switch (e.key) {
        case 'Escape':
          setMode('select');
          setDrawCoords([]);
          break;
        case 'm': case 'M':
          setMode('marker');
          break;
        case 'l': case 'L':
          setMode('line');
          setDrawCoords([]);
          break;
        case 'p': case 'P':
          setMode('polygon');
          setDrawCoords([]);
          break;
        case 'r': case 'R':
          setMode('measure');
          setDrawCoords([]);
          break;
        case 'Delete': case 'Backspace':
          if (selectedRef.current) void deleteFeatureRef.current?.(selectedRef.current.id);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadData = useCallback(async () => {
    let ls: LayerRow[] = [];
    let fs: FeatureRow[] = [];
    try {
      // Always read IDB first — items written while offline/in-fallback survive across engine switches.
      const idbLayers = await idb.layers.getByMap<LayerRow>(mapId);
      const idbArrs = await Promise.all(idbLayers.map((l) => idb.features.getByLayer<FeatureRow>(l.id)));
      const idbFeatures = idbArrs.flat();
      ls = idbLayers;
      fs = idbFeatures;

      // Merge with Supabase when available; Supabase wins on id conflict, IDB fills gaps.
      if (supabase && !offline) {
        const { data: ld } = await supabase
          .from('mymaps_layers').select('*').eq('map_id', mapId).order('order');
        const supaLayers = (ld as LayerRow[]) ?? [];
        const layerMap = new Map<string, LayerRow>();
        for (const l of idbLayers) layerMap.set(l.id, l);
        for (const l of supaLayers) layerMap.set(l.id, l);
        ls = Array.from(layerMap.values()).sort((a, b) => a.order - b.order);

        if (ls.length) {
          const { data: fd } = await supabase
            .from('mymaps_features').select('*').in('layer_id', ls.map((l) => l.id)).order('order');
          const supaFeatures = (fd as FeatureRow[]) ?? [];
          const featureMap = new Map<string, FeatureRow>();
          for (const f of idbFeatures) featureMap.set(f.id, f);
          for (const f of supaFeatures) featureMap.set(f.id, f);
          fs = Array.from(featureMap.values());
        }
      }
    } catch { /* fall through with whatever we have */ }
    // Backfill order for legacy IDB rows that predate the order field, and sort per-layer.
    const layerCounters = new Map<string, number>();
    fs = fs
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((f) => {
        if (typeof f.order === 'number') return f;
        const n = layerCounters.get(f.layer_id) ?? 0;
        layerCounters.set(f.layer_id, n + 1);
        return { ...f, order: n };
      });
    setLayers(ls);
    setFeatures(fs);
    if (ls.length) setActiveLayerId(ls[0].id);
  }, [mapId, offline]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!supabase || !MAPTILER_KEY) { setUseOSM(true); return; }
    supabase.rpc('get_monthly_tile_usage').then(
      ({ data }) => {
        if (typeof data === 'number') {
          if (data > 75000) setUseOSM(true);
          else if (data > 60000) setTileWarning(true);
        }
      },
      () => {},
    );
  }, []);

  // MapLibre sources (no SDF markers — handled via HTML Marker elements)
  const initSources = useCallback((map: maplibregl.Map) => {
    map.addSource('mm-polygons', { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection });
    map.addLayer({
      id: 'mm-polygons-fill', type: 'fill', source: 'mm-polygons',
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#6366F1'],
        'fill-opacity': ['coalesce', ['get', 'fill_opacity'], 0.25],
      },
    });
    map.addLayer({
      id: 'mm-polygons-line', type: 'line', source: 'mm-polygons',
      paint: {
        'line-color': ['coalesce', ['get', 'stroke_color'], ['get', 'color'], '#6366F1'],
        'line-width': 2,
      },
    });
    map.addSource('mm-lines', { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection });
    map.addLayer({
      id: 'mm-lines', type: 'line', source: 'mm-lines',
      filter: ['!', ['boolean', ['get', 'dash'], false]],
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#6366F1'],
        'line-width': ['coalesce', ['get', 'weight'], 3],
      },
    });
    map.addLayer({
      id: 'mm-lines-dash', type: 'line', source: 'mm-lines',
      filter: ['boolean', ['get', 'dash'], false],
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#6366F1'],
        'line-width': ['coalesce', ['get', 'weight'], 3],
        'line-dasharray': [4, 3],
      },
    });
    map.addSource('mm-preview', { type: 'geojson', data: emptyFC() as GeoJSON.FeatureCollection });
    map.addLayer({
      id: 'mm-preview', type: 'line', source: 'mm-preview',
      paint: { 'line-color': '#818CF8', 'line-width': 2, 'line-dasharray': [4, 3] },
    });

  }, []);

  const updateSources = useCallback((map: maplibregl.Map) => {
    if (!mapReadyRef.current) return;
    const fs = featuresRef.current;
    const ls = layersRef.current;
    const visible = new Set(ls.filter((l) => l.visible).map((l) => l.id));
    (map.getSource('mm-lines') as GeoJSONSource)?.setData(toGeoJSON(fs, 'line', visible) as GeoJSON.FeatureCollection);
    (map.getSource('mm-polygons') as GeoJSONSource)?.setData(toGeoJSON(fs, 'polygon', visible) as GeoJSON.FeatureCollection);
  }, []);

  // Sync MapLibre HTML pin markers
  const syncMLMarkers = useCallback((map: maplibregl.Map) => {
    if (!mapReadyRef.current) return;
    const fs = featuresRef.current;
    const ls = layersRef.current;
    const sel = selectedRef.current;
    const visible = new Set(ls.filter((l) => l.visible).map((l) => l.id));

    mlMarkersRef.current.forEach((m) => m.remove());
    mlMarkersRef.current.clear();

    for (const f of fs) {
      if (f.type !== 'marker' || !visible.has(f.layer_id) || f.geometry.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const color = (f.properties.color as string | undefined) ?? '#6366F1';
      const fId = f.id;
      const el = createPinElement(color, f.properties.icon as string | undefined);
      setPinSelected(el, sel?.id === fId);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (modeRef.current !== 'select') return;
        const feat = featuresRef.current.find((f2) => f2.id === fId) ?? null;
        if (!feat || feat.geometry.type !== 'Point') return;
        const pt = map.project([lng, lat]);
        setPopupFeatureRef.current(feat);
        setPopupPosRef.current({ x: Math.round(pt.x), y: Math.round(pt.y) });
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
      mlMarkersRef.current.set(fId, marker);
    }
  }, []);

  // MapLibre map initialization
  useEffect(() => {
    if (engine !== 'maplibre') return;
    const cont = containerRef.current;
    if (!cont) return;

    const bm = useOSM ? 'streets' : basemap;
    const map = new maplibregl.Map({
      container: cont,
      style: buildStyle(bm, useOSM ? undefined : MAPTILER_KEY),
      center: [126.978, 37.566],
      zoom: 10,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    flyToRef.current = (lng, lat, zoom) => {
      map.flyTo({ center: [lng, lat], zoom: zoom ?? map.getZoom() });
    };

    map.on('style.load', () => {
      if (!mapReadyRef.current) mapReadyRef.current = true;
      initSources(map);
      updateSources(map);
      syncMLMarkers(map);
    });

    let lastMove = 0;
    map.on('mousemove', (e) => {
      const now = Date.now();
      if (now - lastMove < 100) return;
      lastMove = now;
      setCursorLng(e.lngLat.lng);
      setCursorLat(e.lngLat.lat);
    });

    map.on('zoom', () => setZoomLevel(map.getZoom()));

    map.on('click', (e: MapMouseEvent) => {
      const m = modeRef.current;

      if (m === 'select') {
        setPopupFeatureRef.current(null);
        setPopupPosRef.current(null);
        setHighlightedId(null);
        const hits = map.queryRenderedFeatures(e.point, { layers: [...ML_CLICK_LAYERS] });
        if (hits.length) {
          const id = hits[0].properties?._id as string | undefined;
          const feat = featuresRef.current.find((f) => f.id === id) ?? null;
          setSelected(feat);
        } else {
          setSelected(null);
        }
        return;
      }

      if (m === 'marker') {
        void addFeature('marker', { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] });
        setMode('select');
        return;
      }

      if (m === 'line' || m === 'polygon' || m === 'measure') {
        const next: [number, number][] = [...drawRef.current, [e.lngLat.lng, e.lngLat.lat]];
        drawRef.current = next;
        setDrawCoords(next);
        (map.getSource('mm-preview') as GeoJSONSource)?.setData(
          previewGeoJSON(next, m) as GeoJSON.FeatureCollection,
        );
      }
    });

    map.on('dblclick', (e) => {
      e.preventDefault();
      const m = modeRef.current;
      const coords = drawRef.current;
      if (m === 'line' && coords.length >= 2) {
        void addFeature('line', { type: 'LineString', coordinates: coords });
        resetDraw(map);
      } else if (m === 'polygon' && coords.length >= 3) {
        void addFeature('polygon', { type: 'Polygon', coordinates: [[...coords, coords[0]]] });
        resetDraw(map);
      } else if (m === 'measure') {
        resetDraw(map);
      }
    });

    map.on('contextmenu', () => resetDraw(map));

    mapRef.current = map;
    return () => {
      mapReadyRef.current = false;
      popupRef.current?.remove();
      searchPopupRef.current?.remove();
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      mlMarkersRef.current.forEach((m) => m.remove());
      mlMarkersRef.current.clear();
      flyToRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // MapLibre basemap switch
  useEffect(() => {
    if (engine !== 'maplibre') return;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const bm = useOSM ? 'streets' : basemap;
    const { tiles, attr } = basemapTiles(bm, useOSM ? undefined : MAPTILER_KEY);
    if (map.getLayer('basemap')) map.removeLayer('basemap');
    if (map.getSource('basemap')) map.removeSource('basemap');
    map.addSource('basemap', { type: 'raster', tiles, tileSize: 256, attribution: attr, maxzoom: 19 });
    map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' }, 'mm-polygons-fill');
  }, [basemap, useOSM, engine]);

  // MapLibre sources + HTML marker sync
  useEffect(() => {
    if (engine !== 'maplibre') return;
    const map = mapRef.current;
    if (map && mapReadyRef.current) {
      updateSources(map);
      syncMLMarkers(map);
    }
  }, [features, layers, engine, updateSources, syncMLMarkers]);

  // Update pin highlight: popup open takes precedence over panel highlight
  useEffect(() => {
    if (engine !== 'maplibre') return;
    const highlightId = popupFeature?.id ?? highlightedId;
    for (const [id, marker] of mlMarkersRef.current) {
      setPinSelected(marker.getElement(), id === highlightId);
    }
  }, [popupFeature, highlightedId, engine]);

  function resetDraw(map: maplibregl.Map) {
    drawRef.current = [];
    setDrawCoords([]);
    setMode('select');
    (map.getSource('mm-preview') as GeoJSONSource)?.setData(emptyFC() as GeoJSON.FeatureCollection);
  }

  async function addFeature(type: FeatureType, geometry: FeatureGeometry, name?: string, address?: string, description?: string) {
    const layerId = activeLayerRef.current;
    if (!layerId) return;
    const labels: Record<FeatureType, string> = { marker: t('editor.newMarker'), line: t('editor.newLine'), polygon: t('editor.newPolygon') };
    const maxOrder = featuresRef.current
      .filter((f) => f.layer_id === layerId)
      .reduce((m, f) => Math.max(m, f.order ?? 0), -1);
    const row: FeatureRow = {
      id: genId(), layer_id: layerId, order: maxOrder + 1, type, geometry,
      properties: { name: name ?? labels[type], address, description, color: '#6366F1' },
    };
    await idb.features.put(row);
    if (supabase && !offline) {
      await supabase.from('mymaps_features').insert(row);
    }
    setFeatures((prev) => [...prev, row]);
    setSelected(row);
  }

  async function updateFeature(updated: FeatureRow) {
    await idb.features.put(updated);
    if (supabase && !offline) {
      const { error } = await supabase.from('mymaps_features')
        .update({ properties: updated.properties })
        .eq('id', updated.id);
      if (error) throw new Error(error.message);
    }
    setFeatures((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    setSelected(updated);
  }

  async function deleteFeature(id: string) {
    await idb.features.delete(id);
    if (supabase && !offline) {
      await supabase.from('mymaps_features').delete().eq('id', id);
    }
    setFeatures((prev) => prev.filter((f) => f.id !== id));
    setSelected(null);
    popupRef.current?.remove();
  }

  deleteFeatureRef.current = deleteFeature;
  addFeatureRef.current = addFeature;

  // Feature 1: add AI-suggested places as pins on the active layer
  async function addAiPlaces(places: AiPlace[]) {
    for (const p of places) {
      await addFeatureRef.current?.('marker', { type: 'Point', coordinates: [p.lng, p.lat] }, p.name, undefined, p.note || undefined);
    }
    const first = places[0];
    if (first) flyToRef.current?.(first.lng, first.lat, 11);
  }

  // Natural language → new layer: reuse the existing LayerRow/FeatureRow model
  async function createAiLayer({ name, color, places, missed }: AiLayerResult) {
    const layerId = genId();
    const layer: LayerRow = {
      id: layerId, map_id: mapId, name, visible: true, order: layersRef.current.length,
    };
    const rows: FeatureRow[] = places.map((p, i) => ({
      id: genId(), layer_id: layerId, order: i, type: 'marker' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
      properties: { name: p.name || p.address, address: p.address, color },
    }));
    await idb.layers.put(layer);
    await Promise.all(rows.map((r) => idb.features.put(r)));
    if (supabase && !offline) {
      await supabase.from('mymaps_layers').insert(layer);
      await supabase.from('mymaps_features').insert(rows);
    }
    setLayers((prev) => [...prev, layer]);
    setFeatures((prev) => [...prev, ...rows]);
    setActiveLayerId(layerId);
    const first = places[0];
    if (first) flyToRef.current?.(first.lng, first.lat, 11);
    if (missed.length) {
      void alertDialog(t('editor.aiLayerAdded', { name, count: places.length, missed: missed.join(', ') }));
    }
  }

  // Feature 2: collect active-layer markers for route optimization
  function openRouteOptimize() {
    const layerId = activeLayerRef.current;
    const pts: RoutePoint[] = featuresRef.current
      .filter((f) => f.layer_id === layerId && f.type === 'marker' && f.geometry.type === 'Point')
      .map((f) => ({
        id: f.id,
        name: f.properties.name ?? t('common.unnamed'),
        lng: (f.geometry.coordinates as [number, number])[0],
        lat: (f.geometry.coordinates as [number, number])[1],
      }));
    if (pts.length < 2) {
      void alertDialog(t('editor.routeNeedMarkers'));
      return;
    }
    setRoutePoints(pts);
  }

  useEffect(() => {
    return onAddPlace((place) => {
      if (place.lat != null && place.lng != null) {
        void addFeatureRef.current?.('marker', { type: 'Point', coordinates: [place.lng, place.lat] }, place.name, place.address);
        flyToRef.current?.(place.lng, place.lat, Math.max(14, zoomLevel));
      }
    });
  }, [zoomLevel]);

  // Keep popup position in sync with map pan/zoom
  useEffect(() => {
    if (engine !== 'maplibre' || !popupFeature || popupFeature.geometry.type !== 'Point') return;
    const map = mapRef.current;
    if (!map) return;
    const [lng, lat] = popupFeature.geometry.coordinates as [number, number];
    const update = () => {
      const pt = map.project([lng, lat]);
      setPopupPos({ x: Math.round(pt.x), y: Math.round(pt.y) });
    };
    map.on('move', update);
    map.on('zoom', update);
    return () => { map.off('move', update); map.off('zoom', update); };
  }, [popupFeature, engine]);

  function clearSearchMarker() {
    if (engine === 'google') {
      setSearchResult(null);
      return;
    }
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    searchPopupRef.current?.remove();
    searchPopupRef.current = null;
  }

  function showSearchMarker(lng: number, lat: number, name: string, address: string) {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    searchPopupRef.current?.remove();
    searchPopupRef.current = null;

    const pinEl = createPinElement('#4F46E5');
    searchMarkerRef.current = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);

    const el = document.createElement('div');
    el.style.cssText = 'font-family: inherit; padding: 12px; min-width: 200px; max-width: 260px;';
    const layerLabel = layersRef.current.find((l) => l.id === activeLayerRef.current)?.name ?? t('common.activeLayer');
    const safeName = (name || address).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeAddress = address.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="display:inline-flex;align-items:center;gap:4px;background:#4F46E51a;border:1px solid #4F46E540;border-radius:999px;padding:2px 8px;">
          <span style="font-size:12px;color:#4F46E5;font-weight:600;">🔍 ${t('editor.searchResult')}</span>
        </div>
        <button id="mm-search-close-x" style="background:none;border:none;cursor:pointer;font-size:18px;color:#6E7278;padding:0 2px;line-height:1;margin-left:8px;flex-shrink:0;">×</button>
      </div>
      <div style="font-weight:700;font-size:14px;color:#04070F;margin-bottom:${name && address ? 4 : 8}px;line-height:1.3;">${safeName}</div>
      ${name && address ? `<div style="font-size:12px;color:#6E7278;margin-bottom:6px;line-height:1.35;">📍 ${safeAddress}</div>` : ''}
      <div style="font-size:12px;color:#6E7278;margin-bottom:10px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <button id="mm-search-add" style="width:100%;min-height:28px;padding:4px 12px;background:#4F46E5;border:none;border-radius:6px;color:#fff;font-size:12px;cursor:pointer;font-weight:600;">${t('editor.addToLayer', { layer: layerLabel })}</button>`;
    el.querySelector('#mm-search-add')?.addEventListener('click', async () => {
      await addFeatureRef.current?.('marker', { type: 'Point', coordinates: [lng, lat] }, name, address);
      clearSearchMarker();
    });
    el.querySelector('#mm-search-close-x')?.addEventListener('click', () => clearSearchMarker());

    searchPopupRef.current = new maplibregl.Popup({ closeButton: false, maxWidth: '300px', offset: [0, -40] })
      .setDOMContent(el)
      .setLngLat([lng, lat])
      .addTo(map);
    searchPopupRef.current.on('close', () => {
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      searchPopupRef.current = null;
    });
  }

  function handleSelectFeature(featureId: string) {
    const feat = featuresRef.current.find((f) => f.id === featureId) ?? null;
    if (!feat) return;
    setHighlightedId(feat.id);
    if (feat.geometry.type === 'Point') {
      const [lng, lat] = feat.geometry.coordinates as [number, number];
      flyToRef.current?.(lng, lat, Math.max(zoomLevel, 14));
      if (engine === 'maplibre') {
        const map = mapRef.current;
        if (map && mapReadyRef.current) {
          const pt = map.project([lng, lat]);
          setPopupFeature(feat);
          setPopupPos({ x: Math.round(pt.x), y: Math.round(pt.y) });
        }
      }
    }
  }

  const cursor = mode === 'select' ? 'default' : 'crosshair';

  const measureDistStr = measureDist > 0
    ? (measureDist < 1 ? `${(measureDist * 1000).toFixed(0)} m` : `${measureDist.toFixed(2)} km`)
    : '';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', position: 'relative' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, flexWrap: 'nowrap', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
      }}>
        <Btn onClick={onBack} title={t('editor.backToList')}><ArrowLeft size={16} /></Btn>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {mapName}
        </span>
        {offline && <Tag color="#FBBF24">{t('common.offline')}</Tag>}
        {tileWarning && <Tag color="#FBBF24">{t('editor.tileWarning')}</Tag>}

        <Sep />

        <Btn active={mode === 'select'} onClick={() => { setMode('select'); setDrawCoords([]); }} title={t('editor.modeSelect')}>
          <Undo2 size={14} />
        </Btn>
        <Btn active={mode === 'marker'} onClick={() => setMode('marker')} title={t('editor.modeMarker')}>
          <MapPin size={14} />
        </Btn>
        <Btn active={mode === 'line'} onClick={() => { setMode('line'); setDrawCoords([]); }} title={t('editor.modeLine')}>
          <Minus size={14} />
        </Btn>
        <Btn active={mode === 'polygon'} onClick={() => { setMode('polygon'); setDrawCoords([]); }} title={t('editor.modePolygon')}>
          <Square size={14} />
        </Btn>
        <Btn active={mode === 'measure'} onClick={() => { setMode('measure'); setDrawCoords([]); }} title={t('editor.modeMeasure')}>
          <Ruler size={14} />
        </Btn>
        <Btn
          active={false}
          onClick={() => { if (selected) void deleteFeature(selected.id); }}
          title={t('editor.deleteSelected')}
          disabled={!selected}
        >
          <Trash2 size={14} />
        </Btn>

        {engine === 'maplibre' && !useOSM && MAPTILER_KEY && (
          <>
            <Sep />
            <Btn active={basemap === 'streets'} onClick={() => setBasemap('streets')} title={t('editor.basemapStreets')}><MapIcon size={14} /></Btn>
            <Btn active={basemap === 'satellite'} onClick={() => setBasemap('satellite')} title={t('editor.basemapSatellite')}><Satellite size={14} /></Btn>
            <Btn active={basemap === 'terrain'} onClick={() => setBasemap('terrain')} title={t('editor.basemapTerrain')}><Mountain size={14} /></Btn>
          </>
        )}
        {engine === 'google' && (
          <>
            <Sep />
            <Btn active={basemap === 'streets'} onClick={() => setBasemap('streets')} title={t('editor.basemapStreets')}><MapIcon size={14} /></Btn>
            <Btn active={basemap === 'satellite'} onClick={() => setBasemap('satellite')} title={t('editor.basemapSatellite')}><Satellite size={14} /></Btn>
            <Btn active={basemap === 'terrain'} onClick={() => setBasemap('terrain')} title={t('editor.basemapTerrain')}><Mountain size={14} /></Btn>
          </>
        )}

        <Sep />
        <Btn onClick={() => setShowLayers((v) => !v)} title={t('editor.layersPanel')}><Layers size={15} /></Btn>
        <Btn onClick={() => setShowKmlModal(true)} title={t('kml.title')}>
          <Download size={15} />
        </Btn>

        <Sep />
        <Btn onClick={() => setShowAiModal(true)} title={t('ai.placesTitle')}><Sparkles size={15} /></Btn>
        <Btn onClick={() => setShowAiLayerModal(true)} title={t('ai.layerTitle')}><Wand2 size={15} /></Btn>
        <Btn onClick={openRouteOptimize} title={t('route.title')}><Route size={15} /></Btn>
      </div>

      {/* Draw hint */}
      {mode !== 'select' && (
        <div style={{
          position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 999, padding: '4px 14px', fontSize: 12, color: 'var(--text-secondary)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {mode === 'marker' && t('editor.hintMarker')}
          {mode === 'line' && (engine === 'google' ? t('editor.hintLineGoogle') : t('editor.hintLine', { n: drawCoords.length }))}
          {mode === 'polygon' && (engine === 'google' ? t('editor.hintPolygonGoogle') : t('editor.hintPolygon', { n: drawCoords.length }))}
          {mode === 'measure' && t('editor.hintMeasure', { n: drawCoords.length, dist: measureDistStr ? ` — ${measureDistStr}` : '' })}
        </div>
      )}

      {/* Map + panels */}
      <div style={{ flex: 1, position: 'relative', cursor, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          {engine === 'google' ? (
            <GoogleMapBody
              features={features}
              layers={layers}
              mode={mode}
              basemap={basemap}
              selected={selected}
              highlightedFeatureId={highlightedId}
              searchResult={searchResult}
              onFeatureSelect={setSelected}
              onFeatureAdd={addFeature}
              onFeatureDelete={deleteFeature}
              onCursorMove={(lng, lat) => { setCursorLng(lng); setCursorLat(lat); }}
              onZoomChange={setZoomLevel}
              onMeasureCoords={(coords) => { setDrawCoords(coords); }}
              onModeReset={() => { setMode('select'); setDrawCoords([]); }}
              onSearchResultClear={() => setSearchResult(null)}
              onFeatureHighlight={(id) => setHighlightedId(id)}
              flyToRef={flyToRef}
              onLoadError={(reason) => { setFallbackReason(reason); setEngine('maplibre'); }}
            />
          ) : (
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          )}

          <div style={{
            position: 'absolute', top: 12,
            left: showLayers ? panelWidth + 16 : 12,
            width: `calc(100% - ${(showLayers ? panelWidth + 16 : 12) + 12}px)`,
            maxWidth: 600, zIndex: 30,
          }}>
            <SearchBar
              onResult={(lng, lat, name, address) => {
                flyToRef.current?.(lng, lat, 14);
                if (engine === 'google') {
                  const layerLabel = layersRef.current.find((l) => l.id === activeLayerRef.current)?.name ?? t('common.activeLayer');
                  setSearchResult({ lng, lat, name, address, layerLabel });
                } else {
                  showSearchMarker(lng, lat, name, address);
                }
              }}
              onClose={() => {}}
            />
          </div>

          {showLayers && (
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: panelWidth, zIndex: 20,
              boxShadow: '2px 0 8px rgba(0,0,0,0.08)',
            }}>
              <LayersPanel
                mapId={mapId}
                layers={layers}
                features={features}
                activeLayerId={activeLayerId}
                offline={offline}
                selectedFeatureId={popupFeature?.id ?? highlightedId}
                onChangeActive={setActiveLayerId}
                onLayersChange={(ls) => { setLayers(ls); layersRef.current = ls; }}
                onFeaturesChange={(fs) => { setFeatures(fs); featuresRef.current = fs; }}
                onSelectFeature={handleSelectFeature}
                onEditFeature={(id) => {
                  const feat = featuresRef.current.find((f) => f.id === id);
                  if (feat) setSelected(feat);
                }}
                onDeleteFeature={deleteFeature}
                onClose={() => setShowLayers(false)}
              />
              <div
                onMouseDown={startResize}
                title={t('editor.resizePanel')}
                style={{
                  position: 'absolute', top: 0, right: -3, bottom: 0,
                  width: 6, cursor: 'col-resize', zIndex: 21, background: 'transparent',
                }}
              />
            </div>
          )}

          {engine === 'maplibre' && popupFeature && popupPos && (
            <FeaturePopup
              feature={popupFeature}
              position={popupPos}
              onEdit={() => { setSelected(popupFeature); setPopupFeature(null); setPopupPos(null); }}
              onDelete={async () => {
                const ok = await confirmDialog({ message: t('common.deleteItemConfirm'), confirmLabel: t('common.delete'), danger: true });
                if (ok) { await deleteFeature(popupFeature.id); setPopupFeature(null); setPopupPos(null); }
              }}
              onClose={() => { setPopupFeature(null); setPopupPos(null); setHighlightedId(null); }}
            />
          )}

          {selected && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 }}>
              <FeatureSheet
                feature={selected}
                offline={offline}
                onUpdate={updateFeature}
                onDelete={deleteFeature}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>

        {/* Status bar */}
        <div style={{
          height: 32, background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', padding: '0 12px', gap: 16, flexShrink: 0,
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          {cursorLng !== null && cursorLat !== null && (
            <span>📍 {cursorLng.toFixed(4)}, {cursorLat.toFixed(4)}</span>
          )}
          <span>{t('editor.zoom', { z: zoomLevel.toFixed(1) })}</span>
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
            {engine === 'google' ? '🗺 Google' : `🗺 ${t('editor.maplibreFallback', { reason: fallbackReason ? ': ' + fallbackReason : '' })}`}
          </span>
        </div>
      </div>

      {/* KML modal */}
      {showKmlModal && (
        <KmlExportModal
          mapName={mapName}
          layers={layers}
          features={features}
          onClose={() => setShowKmlModal(false)}
        />
      )}

      {/* AI place suggestions modal */}
      {showAiModal && (
        <AiPlacesModal
          layerName={layers.find((l) => l.id === activeLayerId)?.name ?? t('common.activeLayer')}
          onAdd={(places) => { void addAiPlaces(places); }}
          onClose={() => setShowAiModal(false)}
        />
      )}

      {/* AI natural-language layer modal */}
      {showAiLayerModal && (
        <AiLayerModal
          onCreate={createAiLayer}
          onClose={() => setShowAiLayerModal(false)}
        />
      )}

      {/* Route optimization modal */}
      {routePoints && (
        <RouteOptimizeModal
          layerName={layers.find((l) => l.id === activeLayerId)?.name ?? t('common.activeLayer')}
          points={routePoints}
          onClose={() => setRoutePoints(null)}
        />
      )}
    </div>
  );
}

function Btn({
  onClick, children, title, active, disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={iconBtn('sm', active ? 'primary' : 'subtle', {
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...(active ? null : { border: 'none' }),
        ...(!active && disabled ? { color: 'var(--border)' } : null),
      })}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />;
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: 12, padding: '2px 8px', borderRadius: 999,
      background: `${color}22`, color,
    }}>
      {children}
    </span>
  );
}

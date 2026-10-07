import { useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase, type LayerRow, type FeatureRow } from '../lib/supabase';
import { idb } from '../lib/offline';
import { confirmDialog, alertDialog } from './ConfirmDialog';
import {
  Eye, EyeOff, Plus, Trash2, X, Check, Edit2,
  ChevronDown, MapPin, Minus, Square, Mail, GripVertical,
} from 'lucide-react';
import { postToHost, type PlaceAttachment } from '../lib/host-bridge';
import MoreMenu from './MoreMenu';
import { t as translate, useI18n } from '../i18n';
import { iconBtn } from '../ui/controls';

const FEATURE_ICON: Record<string, React.ReactNode> = {
  marker: <MapPin size={11} />,
  line: <Minus size={11} />,
  polygon: <Square size={11} />,
};

const LAYER_PREFIX = 'layer:';
const FEATURE_PREFIX = 'feature:';
const CONTAINER_PREFIX = 'container:';

type Props = {
  mapId: string;
  layers: LayerRow[];
  features: FeatureRow[];
  activeLayerId: string | null;
  offline: boolean;
  selectedFeatureId?: string | null;
  onChangeActive: (id: string) => void;
  onLayersChange: (layers: LayerRow[]) => void;
  onFeaturesChange: (features: FeatureRow[]) => void;
  onSelectFeature: (featureId: string) => void;
  onEditFeature: (featureId: string) => void;
  onDeleteFeature: (featureId: string) => void;
  onClose: () => void;
};

const genId = () => crypto.randomUUID();

function buildPlaceAttachment(f: FeatureRow): PlaceAttachment {
  const coords = f.type === 'marker'
    ? (f.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates
    : undefined;
  return {
    type: 'place',
    name: String(f.properties.name || translate('common.unnamedParen')),
    address: f.properties.address as string | undefined,
    lat: coords?.[1],
    lng: coords?.[0],
    color: f.properties.color as string | undefined,
    featureId: f.id,
  };
}

export default function LayersPanel({
  mapId, layers, features, activeLayerId, offline, selectedFeatureId,
  onChangeActive, onLayersChange, onFeaturesChange, onSelectFeature, onEditFeature, onDeleteFeature, onClose,
}: Props) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // dnd-kit listeners live only on the grip handles, so a small distance threshold is enough:
  // reordering starts instantly from the handle while HTML5 native drag (feature → chat)
  // stays on the row body without conflict.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createLayer() {
    const id = genId();
    const layer: LayerRow = {
      id, map_id: mapId, name: t('layers.defaultName', { n: layers.length + 1 }), visible: true, order: layers.length,
    };
    await idb.layers.put(layer);
    if (supabase && !offline) {
      await supabase.from('mymaps_layers').insert(layer);
    }
    onLayersChange([...layers, layer]);
    onChangeActive(id);
  }

  async function toggleVisible(layer: LayerRow) {
    const updated = { ...layer, visible: !layer.visible };
    await idb.layers.put(updated);
    if (supabase && !offline) {
      await supabase.from('mymaps_layers').update({ visible: updated.visible }).eq('id', layer.id);
    }
    onLayersChange(layers.map((l) => (l.id === layer.id ? updated : l)));
  }

  async function deleteLayer(id: string) {
    if (layers.length <= 1) { await alertDialog(t('layers.minOne')); return; }
    const ok = await confirmDialog({
      message: t('layers.deleteConfirm'),
      confirmLabel: t('common.delete'), danger: true,
    });
    if (!ok) return;
    await idb.layers.delete(id);
    if (supabase && !offline) {
      await supabase.from('mymaps_layers').delete().eq('id', id);
    }
    const next = layers.filter((l) => l.id !== id);
    onLayersChange(next);
    if (activeLayerId === id && next.length) onChangeActive(next[0].id);
  }

  async function renameLayer(id: string, name: string) {
    const l = layers.find((l) => l.id === id);
    if (l) await idb.layers.put({ ...l, name });
    if (supabase && !offline) {
      await supabase.from('mymaps_layers').update({ name }).eq('id', id);
    }
    onLayersChange(layers.map((l) => (l.id === id ? { ...l, name } : l)));
    setRenaming(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    if (activeId.startsWith(LAYER_PREFIX) && overId.startsWith(LAYER_PREFIX)) {
      const activeLid = activeId.slice(LAYER_PREFIX.length);
      const overLid = overId.slice(LAYER_PREFIX.length);
      const oldIndex = layers.findIndex((l) => l.id === activeLid);
      const newIndex = layers.findIndex((l) => l.id === overLid);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(layers, oldIndex, newIndex).map((l, i) => ({ ...l, order: i }));
      onLayersChange(reordered);
      await Promise.all(reordered.map((l) => idb.layers.put(l)));
      if (supabase && !offline) {
        await Promise.all(reordered.map((l) =>
          supabase!.from('mymaps_layers').update({ order: l.order }).eq('id', l.id),
        ));
      }
      return;
    }

    if (activeId.startsWith(FEATURE_PREFIX)) {
      const featureId = activeId.slice(FEATURE_PREFIX.length);
      const feature = features.find((f) => f.id === featureId);
      if (!feature) return;

      let targetLayerId: string | null = null;
      let overFeatureId: string | null = null;
      if (overId.startsWith(CONTAINER_PREFIX)) {
        targetLayerId = overId.slice(CONTAINER_PREFIX.length);
      } else if (overId.startsWith(FEATURE_PREFIX)) {
        overFeatureId = overId.slice(FEATURE_PREFIX.length);
        const overFeature = features.find((f) => f.id === overFeatureId);
        if (!overFeature) return;
        targetLayerId = overFeature.layer_id;
      } else if (overId.startsWith(LAYER_PREFIX)) {
        // Dropping feature onto a layer row itself — treat as "move into this layer at end"
        targetLayerId = overId.slice(LAYER_PREFIX.length);
      }
      if (!targetLayerId) return;

      const withoutMoved = features.filter((f) => f.id !== featureId);
      let insertIndex: number;
      if (overFeatureId) {
        insertIndex = withoutMoved.findIndex((f) => f.id === overFeatureId);
        if (insertIndex === -1) {
          insertIndex = withoutMoved.length;
        } else {
          // arrayMove semantics: dragging downward drops the item *after* the row
          // it lands on; without this, adjacent downward swaps are a no-op.
          const fromIndex = features.findIndex((f) => f.id === featureId);
          const overIndex = features.findIndex((f) => f.id === overFeatureId);
          if (fromIndex < overIndex) insertIndex += 1;
        }
      } else {
        let lastIdx = -1;
        withoutMoved.forEach((f, i) => { if (f.layer_id === targetLayerId) lastIdx = i; });
        insertIndex = lastIdx + 1;
      }
      const movedFeature = { ...feature, layer_id: targetLayerId };
      const nextFeatures = [...withoutMoved.slice(0, insertIndex), movedFeature, ...withoutMoved.slice(insertIndex)];

      // Renumber order fields for source + target layers, collect rows that actually changed.
      const affectedLayers = new Set([feature.layer_id, targetLayerId]);
      const counters = new Map<string, number>();
      const changed: FeatureRow[] = [];
      const renumbered = nextFeatures.map((f) => {
        if (!affectedLayers.has(f.layer_id)) return f;
        const n = counters.get(f.layer_id) ?? 0;
        counters.set(f.layer_id, n + 1);
        const prev = features.find((x) => x.id === f.id);
        if (prev && prev.layer_id === f.layer_id && prev.order === n) return f;
        const updated = { ...f, order: n };
        changed.push(updated);
        return updated;
      });
      onFeaturesChange(renumbered);

      await Promise.all(changed.map((f) => idb.features.put(f)));
      if (supabase && !offline) {
        await Promise.all(changed.map((f) =>
          supabase!.from('mymaps_features').update({ layer_id: f.layer_id, order: f.order }).eq('id', f.id),
        ));
      }
    }
  }

  return (
    <div style={{
      height: '100%', background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t('layers.title')}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <PanelBtn onClick={createLayer} title={t('layers.add')}><Plus size={14} /></PanelBtn>
          <PanelBtn onClick={onClose} title={t('common.close')}><X size={14} /></PanelBtn>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SortableContext items={layers.map((l) => `${LAYER_PREFIX}${l.id}`)} strategy={verticalListSortingStrategy}>
            {layers.map((layer) => (
              <SortableLayerRow
                key={layer.id}
                layer={layer}
                layerFeatures={features.filter((f) => f.layer_id === layer.id)}
                isActive={activeLayerId === layer.id}
                isCollapsed={collapsed.has(layer.id)}
                isRenaming={renaming === layer.id}
                renameVal={renameVal}
                selectedFeatureId={selectedFeatureId}
                onToggleCollapsed={() => toggleCollapsed(layer.id)}
                onChangeActive={() => onChangeActive(layer.id)}
                onToggleVisible={() => void toggleVisible(layer)}
                onStartRename={() => { setRenaming(layer.id); setRenameVal(layer.name); }}
                onRenameValChange={setRenameVal}
                onConfirmRename={() => void renameLayer(layer.id, renameVal)}
                onCancelRename={() => setRenaming(null)}
                onDeleteLayer={() => void deleteLayer(layer.id)}
                onSelectFeature={onSelectFeature}
                onEditFeature={onEditFeature}
                onDeleteFeature={onDeleteFeature}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
        {t('layers.hint')}
      </div>
    </div>
  );
}

function SortableLayerRow({
  layer, layerFeatures, isActive, isCollapsed, isRenaming, renameVal, selectedFeatureId,
  onToggleCollapsed, onChangeActive, onToggleVisible, onStartRename, onRenameValChange,
  onConfirmRename, onCancelRename, onDeleteLayer, onSelectFeature, onEditFeature, onDeleteFeature,
}: {
  layer: LayerRow;
  layerFeatures: FeatureRow[];
  isActive: boolean;
  isCollapsed: boolean;
  isRenaming: boolean;
  renameVal: string;
  selectedFeatureId?: string | null;
  onToggleCollapsed: () => void;
  onChangeActive: () => void;
  onToggleVisible: () => void;
  onStartRename: () => void;
  onRenameValChange: (v: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onDeleteLayer: () => void;
  onSelectFeature: (featureId: string) => void;
  onEditFeature: (featureId: string) => void;
  onDeleteFeature: (featureId: string) => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `${LAYER_PREFIX}${layer.id}` });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `${CONTAINER_PREFIX}${layer.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style}>
      <div ref={setDropRef} style={{ borderRadius: 6, background: isOver ? 'rgba(99,102,241,0.06)' : 'transparent' }}>
        <div
          onClick={onChangeActive}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '7px 8px',
            borderRadius: 6, cursor: 'pointer',
            background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
            border: `1px solid ${isActive ? 'rgba(99,102,241,0.4)' : 'transparent'}`,
          }}
        >
          <span
            {...attributes} {...listeners}
            title={t('layers.dragReorder')}
            style={{
              display: 'flex', alignItems: 'center', flexShrink: 0,
              cursor: 'grab', touchAction: 'none', padding: '4px 2px',
              color: 'var(--text-secondary)',
            }}
          >
            <GripVertical size={12} />
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapsed(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--text-secondary)' }}
          >
            <ChevronDown
              size={12}
              style={{ transform: isCollapsed ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
            />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: layer.visible ? '#818CF8' : 'var(--text-secondary)', display: 'flex' }}
          >
            {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>

          {isRenaming ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={renameVal}
                onChange={(e) => onRenameValChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onConfirmRename();
                  if (e.key === 'Escape') onCancelRename();
                }}
                style={{
                  flex: 1, padding: '3px 6px', background: 'var(--bg-elevated)',
                  border: '1px solid #6366F1', borderRadius: 4,
                  color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                }}
              />
              <button onClick={onConfirmRename} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Check size={12} color="#34D399" />
              </button>
            </div>
          ) : (
            <span style={{
              flex: 1, fontSize: 14, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {layer.name}
              {layerFeatures.length > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 4 }}>
                  ({layerFeatures.length})
                </span>
              )}
            </span>
          )}

          {!isRenaming && (
            <div onClick={(e) => e.stopPropagation()}>
              <MoreMenu
                title={t('layers.menu')}
                items={[
                  { label: t('common.rename'), icon: <Edit2 size={12} />, onClick: onStartRename },
                  { label: t('common.delete'), icon: <Trash2 size={12} />, onClick: onDeleteLayer, danger: true },
                ]}
              />
            </div>
          )}
        </div>

        {!isCollapsed && (
          <SortableContext items={layerFeatures.map((f) => `${FEATURE_PREFIX}${f.id}`)} strategy={verticalListSortingStrategy}>
            <div style={{ marginLeft: 24, marginTop: 2, marginBottom: 2, display: 'flex', flexDirection: 'column', gap: 1, minHeight: layerFeatures.length ? undefined : 8 }}>
              {layerFeatures.map((f) => (
                <SortableFeatureRow
                  key={f.id}
                  feature={f}
                  selectedFeatureId={selectedFeatureId}
                  onSelectFeature={onSelectFeature}
                  onEditFeature={onEditFeature}
                  onDeleteFeature={onDeleteFeature}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  );
}

function SortableFeatureRow({
  feature, selectedFeatureId, onSelectFeature, onEditFeature, onDeleteFeature,
}: {
  feature: FeatureRow;
  selectedFeatureId?: string | null;
  onSelectFeature: (featureId: string) => void;
  onEditFeature: (featureId: string) => void;
  onDeleteFeature: (featureId: string) => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `${FEATURE_PREFIX}${feature.id}` });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  function handleNativeDragStart(e: React.DragEvent) {
    const place = buildPlaceAttachment(feature);
    e.dataTransfer.setData('application/x-mycrew-attachment', JSON.stringify(place));
    e.dataTransfer.effectAllowed = 'copy';
    postToHost('drag.start', { attachment: place });
  }

  function handleNativeDragEnd() {
    postToHost('drag.end', {});
  }

  function handleEmailShare() {
    const place = buildPlaceAttachment(feature);
    const subject = encodeURIComponent(`[MyMaps] ${place.name}`);
    const bodyLines = [
      place.name,
      place.address,
      place.lat !== undefined && place.lng !== undefined ? `${place.lat}, ${place.lng}` : '',
    ].filter(Boolean);
    const body = encodeURIComponent(bodyLines.join('\n'));
    const a = document.createElement('a');
    a.href = `mailto:?subject=${subject}&body=${body}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleDelete() {
    const ok = await confirmDialog({ message: t('common.deleteItemConfirm'), confirmLabel: t('common.delete'), danger: true });
    if (ok) onDeleteFeature(feature.id);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, display: 'flex', alignItems: 'center', borderRadius: 6 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      <span
        {...attributes} {...listeners}
        title={t('layers.dragMove')}
        style={{
          display: 'flex', alignItems: 'center', flexShrink: 0,
          cursor: 'grab', touchAction: 'none', padding: '4px 2px',
          color: 'var(--text-secondary)',
        }}
      >
        <GripVertical size={11} />
      </span>
      <button
        draggable
        onDragStart={handleNativeDragStart}
        onDragEnd={handleNativeDragEnd}
        onClick={() => onSelectFeature(feature.id)}
        title={t('layers.dragToChat')}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
          background: feature.id === selectedFeatureId ? 'rgba(99,102,241,0.12)' : 'none',
          border: 'none', cursor: 'grab', borderRadius: 6,
          textAlign: 'left', minWidth: 0,
          borderLeft: `3px solid ${feature.id === selectedFeatureId ? '#6366F1' : 'transparent'}`,
        }}
      >
        <span style={{ color: (feature.properties.color as string | undefined) ?? '#6366F1', display: 'flex', flexShrink: 0 }}>
          {FEATURE_ICON[feature.type]}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {feature.properties.name || t('common.unnamedParen')}
        </span>
      </button>

      <MoreMenu
        title={t('layers.placeMenu')}
        items={[
          { label: t('layers.shareEmail'), icon: <Mail size={12} />, onClick: handleEmailShare },
          { label: t('common.modify'), icon: <Edit2 size={12} />, onClick: () => onEditFeature(feature.id) },
          { label: t('common.delete'), icon: <Trash2 size={12} />, onClick: () => void handleDelete(), danger: true },
        ]}
      />
    </div>
  );
}

function PanelBtn({
  onClick, children, title, danger, disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={iconBtn('sm', danger ? 'dangerSubtle' : 'subtle', {
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        ...(disabled ? { color: 'var(--border)' } : null),
      })}
    >
      {children}
    </button>
  );
}

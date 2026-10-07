"use client";

import { useState } from "react";
import { ActionIcon, Group, ScrollArea, Stack, Text } from "@mantine/core";
import {
  IconCircle,
  IconEye,
  IconEyeOff,
  IconFrame,
  IconLine,
  IconLock,
  IconLockOpen,
  IconStack2,
  IconPhoto,
  IconSquare,
  IconTypography,
  IconVector,
} from "@tabler/icons-react";
import { useDesign } from "@/lib/store/designStore";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Shape, ShapeType } from "@/lib/design/types";

function iconFor(type: ShapeType) {
  switch (type) {
    case "rect": return <IconSquare size={14} />;
    case "frame": return <IconFrame size={14} />;
    case "ellipse": return <IconCircle size={14} />;
    case "text": return <IconTypography size={14} />;
    case "line": return <IconLine size={14} />;
    case "path": return <IconVector size={14} />;
    case "image": return <IconPhoto size={14} />;
    case "group": return <IconStack2 size={14} />;
  }
}

type DropHint = { id: string; position: "above" | "below" } | null;

function LayerRow({
  shape,
  indent,
  active,
  dragging,
  dropHint,
  onToggleSelect,
  onToggleLock,
  onToggleVisible,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  shape: Shape;
  indent: number;
  active: boolean;
  dragging: boolean;
  dropHint: DropHint;
  onToggleSelect: (id: string, shift: boolean) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onDragStart: (id: string) => void;
  onDragEnter: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDrop: (id: string) => void;
}) {
  const hintForMe = dropHint && dropHint.id === shape.id ? dropHint.position : null;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", shape.id);
        onDragStart(shape.id);
      }}
      onDragEnter={() => onDragEnter(shape.id)}
      onDragOver={(e) => onDragOver(e, shape.id)}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(shape.id);
      }}
      style={{
        borderTop:
          hintForMe === "above" ? "2px solid #6366F1" : "2px solid transparent",
        borderBottom:
          hintForMe === "below" ? "2px solid #6366F1" : "2px solid transparent",
        opacity: dragging ? 0.4 : 1,
      }}
    >
      <Group
        gap={6}
        px="sm"
        py={5}
        wrap="nowrap"
        onClick={(e) => onToggleSelect(shape.id, e.shiftKey)}
        style={{
          cursor: "pointer",
          background: active ? "#6366F1" : "transparent",
          color: active ? "#fff" : "#9DB7EB",
          paddingLeft: indent ? indent + 12 : undefined,
        }}
      >
        {indent > 0 && (
          <span style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
        )}
        <span style={{ display: "flex", opacity: 0.8 }}>{iconFor(shape.type)}</span>
        <Text size="xs" style={{ flex: 1 }} truncate>
          {shape.name}
        </Text>
        <ActionIcon
          size="xs"
          variant="transparent"
          c={active ? "white" : "dimmed"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(shape.id, !shape.locked);
          }}
        >
          {shape.locked ? <IconLock size={12} /> : <IconLockOpen size={12} />}
        </ActionIcon>
        <ActionIcon
          size="xs"
          variant="transparent"
          c={active ? "white" : "dimmed"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible(shape.id, !shape.visible);
          }}
        >
          {shape.visible ? <IconEye size={12} /> : <IconEyeOff size={12} />}
        </ActionIcon>
      </Group>
    </div>
  );
}

export default function LayersPanel() {
  const { t } = useI18n();
  const doc = useDesign((s) => s.doc);
  const activePageId = useDesign((s) => s.activePageId);
  const selectedIds = useDesign((s) => s.selectedIds);
  const toggleSelect = useDesign((s) => s.toggleSelect);
  const updateShape = useDesign((s) => s.updateShape);
  const reorderLayer = useDesign((s) => s.reorderLayer);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);

  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];

  const groupIds = new Set(page.shapes.filter((s) => s.type === "group").map((s) => s.id));
  const isGroupChild = (s: Shape) => !!s.parentId && groupIds.has(s.parentId);
  const topLevel = [...page.shapes].reverse().filter((s) => !isGroupChild(s));
  const childrenOf = (gid: string) =>
    [...page.shapes].reverse().filter((s) => s.parentId === gid);

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragId || dragId === id) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position: "above" | "below" =
      e.clientY < rect.top + rect.height / 2 ? "above" : "below";
    if (!dropHint || dropHint.id !== id || dropHint.position !== position) {
      setDropHint({ id, position });
    }
  };

  const handleDrop = (targetId: string) => {
    if (dragId && dropHint && dropHint.id === targetId) {
      reorderLayer(dragId, targetId, dropHint.position);
    }
    setDragId(null);
    setDropHint(null);
  };

  const rows: React.ReactNode[] = [];
  for (const s of topLevel) {
    rows.push(
      <LayerRow
        key={s.id}
        shape={s}
        indent={0}
        active={selectedIds.includes(s.id)}
        dragging={dragId === s.id}
        dropHint={dropHint}
        onToggleSelect={(id, shift) => toggleSelect(id, shift)}
        onToggleLock={(id, locked) => updateShape(id, { locked })}
        onToggleVisible={(id, visible) => updateShape(id, { visible })}
        onDragStart={(id) => setDragId(id)}
        onDragEnter={() => {}}
        onDragOver={handleDragOver}
        onDragEnd={() => {
          setDragId(null);
          setDropHint(null);
        }}
        onDrop={handleDrop}
      />,
    );
    if (s.type === "group") {
      for (const child of childrenOf(s.id)) {
        rows.push(
          <LayerRow
            key={child.id}
            shape={child}
            indent={16}
            active={selectedIds.includes(child.id)}
            dragging={dragId === child.id}
            dropHint={dropHint}
            onToggleSelect={(id, shift) => toggleSelect(id, shift)}
            onToggleLock={(id, locked) => updateShape(id, { locked })}
            onToggleVisible={(id, visible) => updateShape(id, { visible })}
            onDragStart={(id) => setDragId(id)}
            onDragEnter={() => {}}
            onDragOver={handleDragOver}
            onDragEnd={() => {
              setDragId(null);
              setDropHint(null);
            }}
            onDrop={handleDrop}
          />,
        );
      }
    }
  }

  return (
    <Stack
      gap={0}
      h="100%"
      style={{
        width: 220,
        background: "#070D1A",
        borderRight: "1px solid #1F293D",
        flex: "0 0 auto",
      }}
    >
      <Text size="xs" fw={700} c="dimmed" px="sm" py={8} tt="uppercase">
        {t("panel.layers")}
      </Text>
      <ScrollArea style={{ flex: 1 }}>
        <Stack gap={0} pb="sm">
          {rows.length === 0 && (
            <Text size="xs" c="dimmed" px="sm" py={4}>
              {t("panel.empty")}
            </Text>
          )}
          {rows}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

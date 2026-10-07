import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ActionIcon, Text, Group } from "@mantine/core";
import { IconX, IconMinus, IconMessage } from "@tabler/icons-react";
import { useT } from "../../i18n/I18nProvider";

interface Props {
  visible: boolean;
  onClose: () => void;
  context: { view?: string; albumId?: string | null; assetId?: string | null };
}

const DEFAULT_W = 360;
const DEFAULT_H = 480;
const MIN_W = 280;
const MIN_H = 320;
const STORAGE_KEY = "mycrew:detachedChat:pos";

export default function DetachedChat({ visible, onClose, context }: Props) {
  const t = useT();
  const [pos, setPos] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { right: 24, bottom: 96, w: DEFAULT_W, h: DEFAULT_H };
  });
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startRight: number; startBottom: number } | null>(null);

  // Persist on change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
  }, [pos]);

  const onDragStart = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startRight: pos.right, startBottom: pos.bottom };
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos((p: typeof pos) => ({
      ...p,
      right: Math.max(0, dragRef.current!.startRight - dx),
      bottom: Math.max(0, dragRef.current!.startBottom - dy),
    }));
  };
  const onDragEnd = () => { dragRef.current = null; };

  if (!visible) return null;

  const style: CSSProperties = {
    position: "fixed",
    right: pos.right,
    bottom: pos.bottom,
    width: minimized ? 220 : pos.w,
    height: minimized ? 44 : pos.h,
    background: "var(--mantine-color-body)",
    border: "1px solid var(--mantine-color-default-border)",
    borderRadius: 10,
    boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
    zIndex: 1000,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    resize: minimized ? "none" : "both",
    minWidth: MIN_W,
    minHeight: MIN_H,
  };

  return (
    <div style={style}>
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        style={{
          cursor: "grab", padding: "6px 10px", display: "flex", alignItems: "center", gap: 6,
          background: "var(--mantine-color-default-hover)", borderBottom: "1px solid var(--mantine-color-default-border)",
          userSelect: "none",
        }}
      >
        <IconMessage size={14} />
        <Text size="xs" fw={600}>{t('apps.detachedChatTitle')}</Text>
        {context?.view && (
          <Text size="xs" c="dimmed" style={{ marginLeft: 4 }}>
            · {context.view}{context.albumId ? `/${String(context.albumId).slice(0,6)}` : ""}
          </Text>
        )}
        <div style={{ flex: 1 }} />
        <ActionIcon size="xs" variant="subtle" onClick={() => setMinimized((m) => !m)} aria-label="minimize">
          <IconMinus size={12} />
        </ActionIcon>
        <ActionIcon size="xs" variant="subtle" onClick={onClose} aria-label="close">
          <IconX size={12} />
        </ActionIcon>
      </div>
      {!minimized && (
        <div style={{ flex: 1, padding: 12, fontSize: "var(--font-m)", color: "var(--text-muted)", overflow: "auto" }}>
          <Group gap={6} mb="xs">
            <Text size="xs" c="dimmed">{t('apps.detachedChatPoc')}</Text>
          </Group>
          <div style={{ marginTop: 8 }}>
            <Text size="sm">{t('apps.currentContext')}</Text>
            <pre style={{ margin: "6px 0", fontSize: "var(--font-s)", background: "var(--mantine-color-default-hover)", padding: 8, borderRadius: 4 }}>
              {JSON.stringify(context, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

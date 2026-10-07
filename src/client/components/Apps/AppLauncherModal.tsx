import { useEffect, useMemo, useState } from "react";
import { SimpleGrid, UnstyledButton, Text, Stack, ActionIcon, Group, Box } from "@mantine/core";
import { IconSettings, IconCheck, IconCircleMinus, IconShoppingBag } from "@tabler/icons-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getManifests, onAppRegistryChanged, onAppSettingsChanged, onAppOrderChanged,
  saveAppOrder, removeApp,
  type AppManifestClient,
} from "../../utils/appRegistry";
import { useI18n } from "../../i18n/I18nProvider";
import { useAppDisplayName } from "./useAppDisplayName";

interface Props {
  opened: boolean;
  onClose: () => void;
  onEnterApp: (manifest: AppManifestClient) => void;
}

// 스토어 메인이 아닌 앱 목록(/browse)으로 바로 진입시킨다.
const STORE_BROWSE_URL = `${(import.meta.env.VITE_MYCREW_STORE_URL || "https://store.dooitspace.com").replace(/\/+$/, "")}/browse`;

type Mode = "grid" | "edit";

function AppIcon({ manifest }: { manifest: AppManifestClient }) {
  const raw = manifest.icon;
  // URL/path/data-URI icons render as <img>, everything else (emoji or empty) falls back to text glyph.
  const isUrl = raw && (raw.startsWith("http") || raw.startsWith("/") || raw.startsWith("data:"));
  if (isUrl) {
    return <img src={raw} alt="" width={48} height={48} style={{ objectFit: "contain", borderRadius: 10 }} />;
  }
  return (
    <Box style={{ fontSize: 36, lineHeight: 1, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {raw || "📦"}
    </Box>
  );
}

function GridCell({
  manifest, mode, onLaunch, onDelete,
}: {
  manifest: AppManifestClient;
  mode: Mode;
  onLaunch: () => void;
  onDelete: () => void;
}) {
  const getDisplayName = useAppDisplayName();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: manifest.id,
    disabled: mode !== "edit",
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    position: "relative",
    touchAction: mode === "edit" ? "none" : "auto",
  };
  const cellContent = (
    <Stack gap={6} align="center" py={6}>
      <AppIcon manifest={manifest} />
      <Text size="xs" fw={500} ta="center" lineClamp={2} style={{ wordBreak: "keep-all" }}>
        {getDisplayName(manifest)}
      </Text>
    </Stack>
  );

  if (mode === "edit") {
    return (
      <Box ref={setNodeRef} style={style} {...attributes} {...listeners}>
        <Box
          style={{
            borderRadius: "var(--mantine-radius-md)",
            padding: "10px 6px",
            cursor: "grab",
            background: "var(--bg-surface)",
            border: "1px solid var(--mantine-color-default-border)",
          }}
        >
          {cellContent}
          <ActionIcon
            size="sm"
            variant="filled"
            color="red"
            aria-label="delete"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ position: "absolute", top: 4, right: 4 }}
          >
            <IconCircleMinus size={14} stroke={2} />
          </ActionIcon>
        </Box>
      </Box>
    );
  }

  return (
    <Box ref={setNodeRef} style={style}>
      <UnstyledButton
        onClick={onLaunch}
        style={{
          width: "100%",
          borderRadius: "var(--mantine-radius-md)",
          padding: "10px 6px",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        {cellContent}
      </UnstyledButton>
    </Box>
  );
}

export default function AppLauncherModal({ opened, onClose, onEnterApp }: Props) {
  const { t } = useI18n();
  const [manifests, setManifests] = useState<AppManifestClient[]>(() => getManifests());
  const [mode, setMode] = useState<Mode>("grid");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const offReg = onAppRegistryChanged(() => setManifests(getManifests()));
    const offSet = onAppSettingsChanged(() => setManifests(getManifests()));
    const offOrd = onAppOrderChanged(() => setManifests(getManifests()));
    return () => { offReg(); offSet(); offOrd(); };
  }, []);

  // Reset to grid mode whenever the popover closes so reopening always starts in launch view.
  useEffect(() => { if (!opened) setMode("grid"); }, [opened]);

  const ids = useMemo(() => manifests.map((m) => m.id), [manifests]);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    saveAppOrder(next);
  };

  const handleDelete = async (m: AppManifestClient) => {
    const name = m.name;
    const msg = t("appLauncher.deleteConfirm").replace("{name}", name);
    if (!window.confirm(msg)) return;
    const result = await removeApp(m.id);
    if (!result.ok) {
      window.alert(result.error || "remove failed");
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text fw={700} size="sm">{t("appLauncher.title")}</Text>
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="filled"
            color="dark"
            size="lg"
            radius="xl"
            aria-label={t("appLauncher.openStore")}
            title={t("appLauncher.openStore")}
            onClick={() => window.open(STORE_BROWSE_URL, "_blank", "noopener,noreferrer")}
          >
            <IconShoppingBag size={18} stroke={1.5} />
          </ActionIcon>
          <ActionIcon
            variant="filled"
            color="dark"
            size="lg"
            radius="xl"
            aria-label={mode === "grid" ? t("appLauncher.editMode") : t("appLauncher.done")}
            title={mode === "grid" ? t("appLauncher.editMode") : t("appLauncher.done")}
            onClick={() => setMode((m) => (m === "grid" ? "edit" : "grid"))}
          >
            {mode === "grid" ? <IconSettings size={18} stroke={1.5} /> : <IconCheck size={18} stroke={2} />}
          </ActionIcon>
        </Group>
      </Group>
      {manifests.length === 0 ? (
        // 신품 상태(앱 0개): 빈 문구 대신 마이크루 스토어 소개로 채운다.
        <UnstyledButton
          onClick={() => window.open(STORE_BROWSE_URL, "_blank", "noopener,noreferrer")}
          style={{
            borderRadius: "var(--mantine-radius-lg)",
            padding: "28px 20px",
            textAlign: "center",
            background: "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(67,56,202,0.25))",
            border: "1px solid rgba(99,102,241,0.35)",
          }}
        >
          <Stack gap={8} align="center">
            <Box style={{ fontSize: 40, lineHeight: 1 }}>🛍️</Box>
            <Text fw={700} size="sm">MyCrew Store</Text>
            <Text c="dimmed" size="xs" style={{ maxWidth: 260 }}>
              {t('apps.storeIntro')}
            </Text>
            <Box
              component="span"
              style={{
                marginTop: 6,
                display: "inline-block",
                background: "var(--mantine-color-jarvis-filled, #6366F1)",
                color: "#fff",
                borderRadius: 10,
                padding: "8px 18px",
                fontSize: "var(--font-m)",
                fontWeight: 600,
              }}
            >
              {t('apps.storeBrowse')}
            </Box>
          </Stack>
        </UnstyledButton>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <SimpleGrid cols={4} spacing="md" verticalSpacing="md">
              {manifests.map((m) => (
                <GridCell
                  key={m.id}
                  manifest={m}
                  mode={mode}
                  onLaunch={() => { onEnterApp(m); onClose(); }}
                  onDelete={() => handleDelete(m)}
                />
              ))}
            </SimpleGrid>
          </SortableContext>
        </DndContext>
      )}
    </Stack>
  );
}

"use client";

import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  ColorSwatch,
  Divider,
  Drawer,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  IconMessageChatbot,
  IconPalette,
  IconRuler2,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useDesign } from "@/lib/store/designStore";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";
import type {
  CritiqueResponse,
  DesignOp,
  DesignRunResponse,
  PaletteResponse,
  PaletteSuggestion,
} from "@/lib/design/types";

export default function DesignFab() {
  const { t } = useI18n();
  const open = useDesign((s) => s.fabOpen);
  const setOpen = useDesign((s) => s.setFabOpen);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  // Brand palette suggestion (POST /api/design/palette)
  const [paletteKeywords, setPaletteKeywords] = useState("");
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [palette, setPalette] = useState<PaletteSuggestion | null>(null);

  // Layout critique (POST /api/design/critique)
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const [critique, setCritique] = useState<CritiqueResponse | null>(null);

  const doc = useDesign((s) => s.doc);
  const activePageId = useDesign((s) => s.activePageId);
  const selectedIds = useDesign((s) => s.selectedIds);
  const clearSelection = useDesign((s) => s.clearSelection);
  const select = useDesign((s) => s.select);
  const applyOps = useDesign((s) => s.applyOps);

  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];
  // selected components shown as attachment chips (targeted edit)
  const chips = page.shapes
    .filter((s) => selectedIds.includes(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  const submit = async () => {
    const intent = text.trim();
    if (!intent || loading) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/design/run"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          doc,
          pageId: activePageId,
          selectedIds,
          intent,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DesignRunResponse;
      if (data.ops?.length) {
        applyOps(data.ops);
        notifications.show({
          color: "jarvis",
          message: data.message || `${data.ops.length} ops applied`,
        });
      } else {
        notifications.show({
          color: "yellow",
          message: data.message || t("toast.noChanges"),
        });
      }
      setText("");
    } catch (err) {
      notifications.show({
        color: "red",
        message: `${t("toast.aiFail")}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const suggestPalette = async () => {
    const keywords = paletteKeywords.trim();
    if (!keywords || paletteLoading) return;
    setPaletteLoading(true);
    try {
      const res = await fetch(apiUrl("/api/design/palette"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PaletteResponse;
      if (data.palette) {
        setPalette(data.palette);
        if (data.message) {
          notifications.show({ color: "jarvis", message: data.message });
        }
      } else {
        notifications.show({
          color: "yellow",
          message: data.message || t("toast.paletteFail"),
        });
      }
    } catch (err) {
      notifications.show({
        color: "red",
        message: `${t("toast.paletteReqFail")}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPaletteLoading(false);
    }
  };

  // Map palette roles onto existing canvas shapes via update ops:
  // background → frames, text → text shapes, remaining colors cycle over
  // filled rect/ellipse/path shapes. Reuses the standard ops pipeline.
  const applyPalette = () => {
    if (!palette) return;
    const roleOf = (role: string) => role.trim().toLowerCase();
    const byRole = new Map(palette.colors.map((c) => [roleOf(c.role), c.hex]));
    const bg = byRole.get("background");
    const textColor = byRole.get("text");
    const accents = palette.colors
      .filter((c) => !["background", "text"].includes(roleOf(c.role)))
      .map((c) => c.hex);
    const ops: DesignOp[] = [];
    let i = 0;
    for (const sh of page.shapes) {
      if (sh.locked || !sh.visible) continue;
      if (sh.type === "text") {
        if (textColor) ops.push({ op: "update", id: sh.id, shape: { color: textColor } });
      } else if (sh.type === "frame") {
        if (bg) ops.push({ op: "update", id: sh.id, shape: { fill: bg } });
      } else if (sh.type === "rect" || sh.type === "ellipse" || sh.type === "path") {
        if (sh.fill !== "none" && accents.length > 0) {
          ops.push({ op: "update", id: sh.id, shape: { fill: accents[i % accents.length] } });
          i += 1;
        }
      }
    }
    if (ops.length === 0) {
      notifications.show({ color: "yellow", message: t("toast.paletteNoShapes") });
      return;
    }
    applyOps(ops);
    notifications.show({
      color: "jarvis",
      message: t("toast.paletteApplied"),
    });
  };

  const runCritique = async () => {
    if (critiqueLoading) return;
    setCritiqueLoading(true);
    setCritique(null);
    try {
      const res = await fetch(apiUrl("/api/design/critique"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc, pageId: activePageId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CritiqueResponse;
      setCritique(data);
      if (!data.critique && data.message) {
        notifications.show({ color: "yellow", message: data.message });
      }
    } catch (err) {
      notifications.show({
        color: "red",
        message: `${t("toast.critiqueFail")}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setCritiqueLoading(false);
    }
  };

  const applyCritiqueOps = () => {
    if (!critique?.ops.length) return;
    applyOps(critique.ops);
    notifications.show({
      color: "jarvis",
      message: t("toast.critiqueApplied"),
    });
    setCritique(null);
  };

  return (
    <>
      <ActionIcon
        size={56}
        radius="xl"
        variant="filled"
        color="jarvis"
        aria-label={t("fab.title")}
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 24,
          bottom: 96,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          zIndex: 1000,
        }}
      >
        <IconMessageChatbot size={28} />
      </ActionIcon>

      <Drawer
        opened={open}
        onClose={() => setOpen(false)}
        position="right"
        size="md"
        title={t("fab.title")}
        withOverlay={false}
        closeOnClickOutside={false}
        lockScroll={false}
        trapFocus={false}
        styles={{
          content: {
            background: "#070D1A",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
            pointerEvents: "auto",
          },
          header: { background: "#070D1A" },
          inner: { pointerEvents: "none" },
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t("fab.hint")}
          </Text>

          {chips.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                {t("fab.attached")} ({chips.length})
              </Text>
              <Group gap={6}>
                {chips.map((c) => (
                  <Badge
                    key={c.id}
                    color="jarvis"
                    variant="light"
                    rightSection={
                      <IconX
                        size={11}
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          select(selectedIds.filter((id) => id !== c.id))
                        }
                      />
                    }
                  >
                    🎨 {c.name}
                  </Badge>
                ))}
                <Badge
                  color="gray"
                  variant="outline"
                  style={{ cursor: "pointer" }}
                  onClick={clearSelection}
                >
                  {t("action.delete")} ✕
                </Badge>
              </Group>
            </Stack>
          )}

          <Textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            minRows={4}
            autosize
            placeholder={t("fab.placeholder")}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
            }}
          />
          <Group justify="flex-end">
            <Button variant="filled"
              loading={loading}
              disabled={text.trim().length === 0}
              leftSection={<IconSend size={14} />}
              onClick={() => void submit()}
            >
              {loading ? t("fab.thinking") : t("fab.send")}
            </Button>
          </Group>

          <Divider label={t("fab.paletteSection")} labelPosition="left" />
          <Group gap={6} wrap="nowrap" align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              size="xs"
              value={paletteKeywords}
              onChange={(e) => setPaletteKeywords(e.currentTarget.value)}
              placeholder={t("fab.palettePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") void suggestPalette();
              }}
            />
            <Button
              size="xs"
              variant="light"
              loading={paletteLoading}
              disabled={paletteKeywords.trim().length === 0}
              leftSection={<IconPalette size={14} />}
              onClick={() => void suggestPalette()}
            >
              {t("fab.paletteSuggest")}
            </Button>
          </Group>
          {palette && (
            <Stack
              gap={8}
              p="sm"
              style={{ background: "#04070F", borderRadius: 10, border: "1px solid #1F293D" }}
            >
              <Text size="sm" fw={600}>
                {palette.name}
              </Text>
              <Group gap={8}>
                {palette.colors.map((c, idx) => (
                  <Stack key={`${c.role}-${idx}`} gap={2} align="center">
                    <ColorSwatch color={c.hex} size={26} radius="sm" />
                    <Text size="xs" c="dimmed">
                      {c.role}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {c.hex}
                    </Text>
                  </Stack>
                ))}
              </Group>
              <Text size="xs" c="dimmed">
                {t("fab.fonts")} — {t("fab.fontHeading")}: {palette.fonts.heading} / {t("fab.fontBody")}: {palette.fonts.body}
              </Text>
              <Group justify="flex-end">
                <Button size="xs" variant="light" onClick={applyPalette}>
                  {t("fab.applyToCanvas")}
                </Button>
              </Group>
            </Stack>
          )}

          <Divider label={t("fab.critiqueSection")} labelPosition="left" />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {t("fab.critiqueHint")}
            </Text>
            <Button
              size="xs"
              variant="light"
              loading={critiqueLoading}
              disabled={page.shapes.length === 0}
              leftSection={<IconRuler2 size={14} />}
              onClick={() => void runCritique()}
            >
              {t("fab.critiqueRun")}
            </Button>
          </Group>
          {critique && (
            <Stack
              gap={8}
              p="sm"
              style={{ background: "#04070F", borderRadius: 10, border: "1px solid #1F293D" }}
            >
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {critique.critique}
              </Text>
              <Group justify="flex-end" gap={6}>
                <Button size="xs" variant="subtle" color="gray" onClick={() => setCritique(null)}>
                  {t("action.close")}
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  disabled={critique.ops.length === 0}
                  onClick={applyCritiqueOps}
                >
                  {t("fab.applyFixes")} ({critique.ops.length})
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      </Drawer>
    </>
  );
}

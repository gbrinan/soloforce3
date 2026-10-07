"use client";

import { useRef } from "react";
import {
  ActionIcon,
  Divider,
  Group,
  Menu,
  Select,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlignBoxBottomCenter,
  IconAlignBoxCenterMiddle,
  IconAlignBoxLeftMiddle,
  IconAlignBoxRightMiddle,
  IconAlignBoxTopCenter,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCircle,
  IconCopy,
  IconDownload,
  IconFrame,
  IconGrid4x4,
  IconHandStop,
  IconLayoutAlignBottom,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconLine,
  IconMagnet,
  IconMessageChatbot,
  IconPalette,
  IconPencil,
  IconPhotoScan,
  IconShape,
  IconStack2,
  IconStackPop,
  IconPhoto,
  IconPlus,
  IconPointer,
  IconSquare,
  IconTrash,
  IconTypography,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useDesign, type ToolId, makeShape } from "@/lib/store/designStore";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiUrl } from "@/lib/api-url";
import type { DesignRunResponse } from "@/lib/design/types";
import { buildPngDataUrl, buildSvg, exportPdf, exportPng, exportSvg } from "@/lib/export";
import { postAssetHandoffToHost } from "@/lib/host-bridge";
import { computeBoolean, type BoolType } from "@/lib/boolean";

const TOOLS: { id: ToolId; icon: React.ReactNode; key: string }[] = [
  { id: "select", icon: <IconPointer size={18} />, key: "tool.select" },
  { id: "frame", icon: <IconFrame size={18} />, key: "tool.frame" },
  { id: "rect", icon: <IconSquare size={18} />, key: "tool.rect" },
  { id: "ellipse", icon: <IconCircle size={18} />, key: "tool.ellipse" },
  { id: "text", icon: <IconTypography size={18} />, key: "tool.text" },
  { id: "line", icon: <IconLine size={18} />, key: "tool.line" },
  { id: "pen", icon: <IconPencil size={18} />, key: "tool.pen" },
  { id: "hand", icon: <IconHandStop size={18} />, key: "tool.hand" },
];

export default function Toolbar() {
  const { t } = useI18n();
  const tool = useDesign((s) => s.tool);
  const setTool = useDesign((s) => s.setTool);
  const undo = useDesign((s) => s.undo);
  const redo = useDesign((s) => s.redo);
  const canUndo = useDesign((s) => s.past.length > 0);
  const canRedo = useDesign((s) => s.future.length > 0);
  const duplicate = useDesign((s) => s.duplicateSelected);
  const deleteShapes = useDesign((s) => s.deleteShapes);
  const selectedIds = useDesign((s) => s.selectedIds);
  const zoom = useDesign((s) => s.zoom);
  const setZoom = useDesign((s) => s.setZoom);
  const setPan = useDesign((s) => s.setPan);
  const addShape = useDesign((s) => s.addShape);
  const alignSelected = useDesign((s) => s.alignSelected);
  const distributeSelected = useDesign((s) => s.distributeSelected);
  const groupSelected = useDesign((s) => s.groupSelected);
  const ungroupSelected = useDesign((s) => s.ungroupSelected);
  const applyBoolean = useDesign((s) => s.applyBoolean);
  const doc = useDesign((s) => s.doc);
  const activePageId = useDesign((s) => s.activePageId);
  const setActivePage = useDesign((s) => s.setActivePage);
  const addPage = useDesign((s) => s.addPage);
  const deletePage = useDesign((s) => s.deletePage);
  const renamePage = useDesign((s) => s.renamePage);
  const showGrid = useDesign((s) => s.showGrid);
  const snapToGrid = useDesign((s) => s.snapToGrid);
  const toggleGrid = useDesign((s) => s.toggleGrid);
  const toggleSnap = useDesign((s) => s.toggleSnap);
  const setFabOpen = useDesign((s) => s.setFabOpen);
  const applyOps = useDesign((s) => s.applyOps);

  // Derive group/ungroup eligibility from current page
  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];
  const selectedShapes = page.shapes.filter((sh) => selectedIds.includes(sh.id));
  const canGroup = selectedIds.length >= 2 && selectedShapes.some((sh) => sh.type !== "group");
  const canUngroup = selectedShapes.some((sh) => sh.type === "group");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const cloneRef = useRef<HTMLInputElement | null>(null);
  const [cloneLoading, setCloneLoading] = useState(false);
  const restyleRef = useRef<HTMLInputElement | null>(null);
  const [restyleLoading, setRestyleLoading] = useState(false);

  const runBoolean = async (type: BoolType) => {
    const s = useDesign.getState();
    const pg = s.activePage();
    const ids = s.selectedIds;
    if (ids.length < 2) return;
    const shapes = pg.shapes.filter((sh) => ids.includes(sh.id));
    if (shapes.length < 2) return;
    const ok = shapes.every(
      (sh) =>
        sh.type === "rect" ||
        sh.type === "frame" ||
        sh.type === "ellipse" ||
        sh.type === "path",
    );
    if (!ok) return;
    try {
      const res = await computeBoolean(type, shapes);
      if (!res || !res.d) return;
      applyBoolean(ids, res.d, res.bbox, { name: `Bool ${type}` });
    } catch (err) {
      console.error("boolean op failed", err);
    }
  };

  const doExport = (kind: "svg" | "png" | "pdf") => {
    const s = useDesign.getState();
    const page = s.activePage();
    if (kind === "svg") exportSvg(s.doc, page);
    else if (kind === "png") void exportPng(s.doc, page);
    else void exportPdf(s.doc, page);
  };

  // Send the active page to another installed MyCrew app (currently only Mail).
  // Goes through the host's asset.handoff bridge → openAppWithAsset → mail
  // ComposeModal prefilled with the export as an attachment.
  const sendToMail = async (kind: "svg" | "png") => {
    const s = useDesign.getState();
    const page = s.activePage();
    const baseName = s.doc.name || "design";
    if (kind === "svg") {
      const svg = buildSvg(s.doc, page);
      // btoa on the UTF-8 byte string (encodeURIComponent → byte-safe ASCII first)
      const dataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      postAssetHandoffToHost({ targetAppId: "mail", kind: "image", dataUrl, name: `${baseName}.svg` });
    } else {
      const dataUrl = await buildPngDataUrl(s.doc, page);
      if (!dataUrl) return;
      postAssetHandoffToHost({ targetAppId: "mail", kind: "image", dataUrl, name: `${baseName}.png` });
    }
  };

  const onPickImage = () => fileRef.current?.click();

  const onImageChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    const href = await new Promise<string>((res, rej) => {
      reader.onerror = () => rej(reader.error);
      reader.onload = () => res(String(reader.result ?? ""));
      reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("image load failed"));
      im.src = href;
    });
    const maxEdge = 480;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    addShape(
      makeShape("image", {
        href,
        width: w,
        height: h,
        x: 80,
        y: 80,
        name: file.name || "이미지",
      }),
    );
    setTool("select");
  };

  // Screenshot → design clone: upload the image to /api/design/clone and
  // apply the returned add-ops through the existing ops pipeline.
  const onCloneChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || cloneLoading) return;
    setCloneLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("width", String(doc.width));
      fd.append("height", String(doc.height));
      const res = await fetch(apiUrl("/api/design/clone"), {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DesignRunResponse;
      if (data.ops?.length) {
        applyOps(data.ops);
        notifications.show({
          color: "jarvis",
          message: data.message || t("toast.cloneDone"),
        });
      } else {
        notifications.show({
          color: "yellow",
          message: data.message || t("toast.cloneEmpty"),
        });
      }
    } catch (err) {
      notifications.show({
        color: "red",
        message: `${t("toast.cloneFail")}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setCloneLoading(false);
    }
  };

  // 참조 이미지로 리스타일: 무드보드 이미지 + 현재 페이지 shapes를 /api/design/restyle에
  // 올려, 참조 톤을 현재 요소에 이식하는 update-ops를 받아 기존 ops 파이프라인으로 적용.
  const onRestyleChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || restyleLoading) return;
    const activePage = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];
    if (!activePage.shapes.length) {
      notifications.show({
        color: "yellow",
        message: t("toast.restyleNoShapes"),
      });
      return;
    }
    setRestyleLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("shapes", JSON.stringify(activePage.shapes));
      fd.append("width", String(doc.width));
      fd.append("height", String(doc.height));
      fd.append("instruction", "참조 이미지의 색감·분위기를 현재 디자인에 이식해줘");
      const res = await fetch(apiUrl("/api/design/restyle"), {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DesignRunResponse;
      if (data.ops?.length) {
        applyOps(data.ops);
        notifications.show({
          color: "jarvis",
          message: data.message || t("toast.restyleDone"),
        });
      } else {
        notifications.show({
          color: "yellow",
          message: data.message || t("toast.restyleEmpty"),
        });
      }
    } catch (err) {
      notifications.show({
        color: "red",
        message: `${t("toast.restyleFail")}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setRestyleLoading(false);
    }
  };

  const pageOptions = doc.pages.map((p) => ({ value: p.id, label: p.name }));

  return (
    <Group
      h={48}
      px="sm"
      gap={4}
      wrap="nowrap"
      style={{
        background: "#070D1A",
        borderBottom: "1px solid #1F293D",
        flex: "0 0 auto",
      }}
    >
      {/* Page selector — far left */}
      <Group gap={4} wrap="nowrap">
        <Select
          size="xs"
          w={140}
          data={pageOptions}
          value={activePageId}
          onChange={(v) => v && setActivePage(v)}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          styles={{ input: { background: "#04070F" } }}
          aria-label={t("panel.page")}
        />
        <Tooltip label={t("page.add")} openDelay={300}>
          <ActionIcon
            variant="subtle"
            size="lg"
            aria-label={t("page.add")}
            onClick={() => addPage()}
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("page.rename")} openDelay={300}>
          <PageRename
            value={doc.pages.find((p) => p.id === activePageId)?.name ?? ""}
            onChange={(v) => renamePage(activePageId, v)}
          />
        </Tooltip>
        <Tooltip label={t("page.delete")} openDelay={300}>
          <ActionIcon
            variant="subtle"
            size="lg"
            color="red"
            disabled={doc.pages.length <= 1}
            aria-label={t("page.delete")}
            onClick={() => deletePage(activePageId)}
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Divider orientation="vertical" mx={4} />

      {TOOLS.map((tl) => (
        <Tooltip key={tl.id} label={t(tl.key)} openDelay={300}>
          <ActionIcon
            variant={tool === tl.id ? "filled" : "subtle"}
            color="jarvis"
            size="lg"
            aria-label={t(tl.key)}
            onClick={() => setTool(tl.id)}
          >
            {tl.icon}
          </ActionIcon>
        </Tooltip>
      ))}

      <Tooltip label={t("tool.image")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          color="jarvis"
          size="lg"
          aria-label={t("tool.image")}
          onClick={onPickImage}
        >
          <IconPhoto size={18} />
        </ActionIcon>
      </Tooltip>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={onImageChosen}
      />

      <Tooltip label={t("tool.clone")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          color="jarvis"
          size="lg"
          loading={cloneLoading}
          aria-label={t("tool.clone")}
          onClick={() => cloneRef.current?.click()}
        >
          <IconPhotoScan size={18} />
        </ActionIcon>
      </Tooltip>
      <input
        ref={cloneRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => void onCloneChosen(e)}
      />

      <Tooltip label={t("tool.restyle")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          color="jarvis"
          size="lg"
          loading={restyleLoading}
          aria-label={t("tool.restyle")}
          onClick={() => restyleRef.current?.click()}
        >
          <IconPalette size={18} />
        </ActionIcon>
      </Tooltip>
      <input
        ref={restyleRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => void onRestyleChosen(e)}
      />

      <Divider orientation="vertical" mx={4} />

      {/* Group / Ungroup */}
      <Tooltip label={t("action.group")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          size="lg"
          disabled={!canGroup}
          aria-label={t("action.group")}
          onClick={groupSelected}
        >
          <IconStack2 size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("action.ungroup")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          size="lg"
          disabled={!canUngroup}
          aria-label={t("action.ungroup")}
          onClick={ungroupSelected}
        >
          <IconStackPop size={18} />
        </ActionIcon>
      </Tooltip>

      {/* Boolean ops (union / subtract / intersect / exclude) */}
      <Menu position="bottom-start" withinPortal disabled={selectedIds.length < 2}>
        <Menu.Target>
          <Tooltip label={t("action.boolean")} openDelay={300}>
            <ActionIcon
              variant="subtle"
              size="lg"
              disabled={selectedIds.length < 2}
              aria-label={t("action.boolean")}
            >
              <IconShape size={18} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => runBoolean("union")}>
            {t("action.booleanUnion")}
          </Menu.Item>
          <Menu.Item onClick={() => runBoolean("subtract")}>
            {t("action.booleanSubtract")}
          </Menu.Item>
          <Menu.Item onClick={() => runBoolean("intersect")}>
            {t("action.booleanIntersect")}
          </Menu.Item>
          <Menu.Item onClick={() => runBoolean("exclude")}>
            {t("action.booleanExclude")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Divider orientation="vertical" mx={4} />

      {/* Grid / Snap toggles */}
      <Tooltip label={t("action.toggleGrid")} openDelay={300}>
        <ActionIcon
          variant={showGrid ? "filled" : "subtle"}
          color={showGrid ? "jarvis" : undefined}
          size="lg"
          aria-label={t("action.toggleGrid")}
          onClick={toggleGrid}
        >
          <IconGrid4x4 size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("action.toggleSnap")} openDelay={300}>
        <ActionIcon
          variant={snapToGrid ? "filled" : "subtle"}
          color={snapToGrid ? "jarvis" : undefined}
          size="lg"
          aria-label={t("action.toggleSnap")}
          onClick={toggleSnap}
        >
          <IconMagnet size={18} />
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />

      <Tooltip label={t("action.undo")} openDelay={300}>
        <ActionIcon variant="subtle" size="lg" disabled={!canUndo} onClick={undo}>
          <IconArrowBackUp size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("action.redo")} openDelay={300}>
        <ActionIcon variant="subtle" size="lg" disabled={!canRedo} onClick={redo}>
          <IconArrowForwardUp size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("action.duplicate")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          size="lg"
          disabled={!selectedIds.length}
          onClick={duplicate}
        >
          <IconCopy size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("action.delete")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          size="lg"
          color="red"
          disabled={!selectedIds.length}
          onClick={() => deleteShapes(selectedIds)}
        >
          <IconTrash size={18} />
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />

      {/* Align + Distribute menu */}
      <Menu position="bottom-start" withinPortal disabled={selectedIds.length < 2}>
        <Menu.Target>
          <Tooltip label={t("action.align")} openDelay={300}>
            <ActionIcon
              variant="subtle"
              size="lg"
              disabled={selectedIds.length < 2}
              aria-label={t("action.align")}
            >
              <IconLayoutAlignBottom size={18} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconAlignBoxLeftMiddle size={14} />}
            onClick={() => alignSelected("left")}
          >
            {t("action.alignLeft")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconAlignBoxCenterMiddle size={14} />}
            onClick={() => alignSelected("centerX")}
          >
            {t("action.alignCenterX")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconAlignBoxRightMiddle size={14} />}
            onClick={() => alignSelected("right")}
          >
            {t("action.alignRight")}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconAlignBoxTopCenter size={14} />}
            onClick={() => alignSelected("top")}
          >
            {t("action.alignTop")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconAlignBoxCenterMiddle size={14} />}
            onClick={() => alignSelected("centerY")}
          >
            {t("action.alignCenterY")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconAlignBoxBottomCenter size={14} />}
            onClick={() => alignSelected("bottom")}
          >
            {t("action.alignBottom")}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconLayoutDistributeHorizontal size={14} />}
            disabled={selectedIds.length < 3}
            onClick={() => distributeSelected("horizontal")}
          >
            {t("action.distributeH")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconLayoutDistributeVertical size={14} />}
            disabled={selectedIds.length < 3}
            onClick={() => distributeSelected("vertical")}
          >
            {t("action.distributeV")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <div style={{ flex: 1 }} />

      <Tooltip label={t("action.zoomOut")} openDelay={300}>
        <ActionIcon variant="subtle" size="lg" onClick={() => setZoom(zoom * 0.9)}>
          <IconZoomOut size={18} />
        </ActionIcon>
      </Tooltip>
      <Text size="xs" c="dimmed" w={42} ta="center">
        {Math.round(zoom * 100)}%
      </Text>
      <Tooltip label={t("action.zoomIn")} openDelay={300}>
        <ActionIcon variant="subtle" size="lg" onClick={() => setZoom(zoom * 1.1)}>
          <IconZoomIn size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("action.zoomFit")} openDelay={300}>
        <ActionIcon
          variant="subtle"
          size="lg"
          onClick={() => {
            setZoom(1);
            setPan({ x: 40, y: 40 });
          }}
        >
          <IconZoomReset size={18} />
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />
      <Tooltip label={t("fab.title")} openDelay={300}>
        <ActionIcon
          variant="filled"
          color="jarvis"
          size="lg"
          aria-label={t("fab.title")}
          onClick={() => setFabOpen(true)}
        >
          <IconMessageChatbot size={18} />
        </ActionIcon>
      </Tooltip>

      <Divider orientation="vertical" mx={4} />
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="light" color="jarvis" size="lg" aria-label={t("action.export")}>
            <IconDownload size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => doExport("svg")}>{t("action.exportSvg")}</Menu.Item>
          <Menu.Item onClick={() => doExport("png")}>{t("action.exportPng")}</Menu.Item>
          <Menu.Item onClick={() => doExport("pdf")}>{t("action.exportPdf")}</Menu.Item>
          <Menu.Divider />
          <Menu.Item onClick={() => void sendToMail("png")}>{t("action.sendMailPng")}</Menu.Item>
          <Menu.Item onClick={() => void sendToMail("svg")}>{t("action.sendMailSvg")}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

import { Popover, Stack, Button } from "@mantine/core";
import { useState } from "react";

function PageRename({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="bottom"
      withinPortal
      trapFocus
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          size="lg"
          onClick={() => {
            setDraft(value);
            setOpen((o) => !o);
          }}
        >
          <IconPencil size={14} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6}>
          <TextInput
            size="xs"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onChange(draft);
                setOpen(false);
              }
            }}
          />
          <Button
            size="xs"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            OK
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

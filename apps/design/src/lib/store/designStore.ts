"use client";

import { create } from "zustand";
import {
  DEFAULT_DOC_SIZE,
  type DesignDoc,
  type DesignOp,
  type Page,
  type Shape,
  type ShapeType,
} from "@/lib/design/types";

let _seq = 0;
export function newId(prefix = "s"): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

export type ToolId =
  | "select"
  | "frame"
  | "rect"
  | "ellipse"
  | "text"
  | "line"
  | "pen"
  | "hand";

function emptyDoc(): DesignDoc {
  const page: Page = { id: newId("page"), name: "Page 1", shapes: [] };
  return {
    id: newId("doc"),
    name: "Untitled",
    width: DEFAULT_DOC_SIZE.width,
    height: DEFAULT_DOC_SIZE.height,
    pages: [page],
  };
}

const SHAPE_DEFAULTS: Omit<Shape, "id" | "type" | "name"> = {
  x: 0,
  y: 0,
  width: 120,
  height: 80,
  rotation: 0,
  opacity: 1,
  fill: "#845ef7",
  stroke: "none",
  strokeWidth: 0,
  radius: 0,
  visible: true,
  locked: false,
  parentId: null,
};

const TYPE_LABEL: Record<ShapeType, string> = {
  rect: "사각형",
  ellipse: "원",
  text: "텍스트",
  frame: "프레임",
  line: "선",
  path: "패스",
  image: "이미지",
  group: "그룹",
};

export function makeShape(type: ShapeType, patch: Partial<Shape>): Shape {
  const base = {
    ...SHAPE_DEFAULTS,
    id: newId(),
    type,
    name: `${TYPE_LABEL[type]} ${++_nameSeq}`,
    ...patch,
  } as Shape;

  if (type === "text") {
    return {
      ...base,
      type: "text",
      text: (patch as { text?: string }).text ?? "텍스트",
      fontSize: (patch as { fontSize?: number }).fontSize ?? 32,
      fontFamily:
        (patch as { fontFamily?: string }).fontFamily ?? "system-ui",
      fontWeight: (patch as { fontWeight?: number }).fontWeight ?? 600,
      align: (patch as { align?: "left" | "center" | "right" }).align ?? "left",
      color: (patch as { color?: string }).color ?? "#e8e8e8",
      fill: "none",
    } as Shape;
  }
  if (type === "frame") {
    return { ...base, fill: "#1e1e1e", stroke: "#3a3a3a", strokeWidth: 1 } as Shape;
  }
  if (type === "group") {
    return { ...base, fill: "none", stroke: "none", strokeWidth: 0 } as Shape;
  }
  if (type === "line") {
    return {
      ...base,
      type: "line",
      stroke: "#e8e8e8",
      strokeWidth: 2,
      fill: "none",
      x2: (patch as { x2?: number }).x2 ?? base.x + base.width,
      y2: (patch as { y2?: number }).y2 ?? base.y,
    } as Shape;
  }
  if (type === "image") {
    return {
      ...base,
      type: "image",
      href: (patch as { href?: string }).href ?? "",
      fill: "none",
    } as Shape;
  }
  if (type === "path") {
    return {
      ...base,
      type: "path",
      d: (patch as { d?: string }).d ?? "M0 0",
    } as Shape;
  }
  return base;
}
let _nameSeq = 0;

interface HistoryEntry {
  pages: Page[];
  selectedIds: string[];
}

interface DesignState {
  doc: DesignDoc;
  activePageId: string;
  tool: ToolId;
  selectedIds: string[];
  zoom: number;
  pan: { x: number; y: number };
  past: HistoryEntry[];
  future: HistoryEntry[];

  // grid + snap
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;

  // AI assistant FAB (trigger lives in the toolbar)
  fabOpen: boolean;
  setFabOpen: (open: boolean) => void;

  // selectors
  activePage: () => Page;
  selectedShapes: () => Shape[];

  // mutations
  setTool: (t: ToolId) => void;
  setZoom: (z: number, center?: { x: number; y: number }) => void;
  setPan: (p: { x: number; y: number }) => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  addShape: (shape: Shape) => void;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  updateMany: (patches: { id: string; patch: Partial<Shape> }[]) => void;
  beginAction: () => void;
  updateShapeNoHistory: (id: string, patch: Partial<Shape>) => void;
  updateManyNoHistory: (patches: { id: string; patch: Partial<Shape> }[]) => void;
  deleteShapes: (ids: string[]) => void;
  duplicateSelected: () => void;
  selectAll: () => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  reorderLayer: (
    dragId: string,
    targetId: string,
    position: "above" | "below",
  ) => void;
  reparent: (ids: string[], parentId: string | null) => void;
  // Replace a set of shapes with a single path shape (Boolean op result).
  applyBoolean: (
    originIds: string[],
    pathD: string,
    bbox: { x: number; y: number; width: number; height: number },
    options?: { fill?: string; stroke?: string; strokeWidth?: number; name?: string },
  ) => void;
  alignSelected: (
    axis: "left" | "centerX" | "right" | "top" | "centerY" | "bottom",
  ) => void;
  distributeSelected: (axis: "horizontal" | "vertical") => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  applyOps: (ops: DesignOp[]) => void;

  addPage: (name?: string) => void;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;
  setActivePage: (id: string) => void;

  toggleGrid: () => void;
  toggleSnap: () => void;
  setGridSize: (n: number) => void;

  undo: () => void;
  redo: () => void;
  resetDoc: () => void;
}

function snapshot(s: DesignState): HistoryEntry {
  return {
    pages: JSON.parse(JSON.stringify(s.doc.pages)) as Page[],
    selectedIds: [...s.selectedIds],
  };
}

export const useDesign = create<DesignState>((set, get) => {
  const initial = emptyDoc();
  return {
    doc: initial,
    activePageId: initial.pages[0].id,
    tool: "select",
    selectedIds: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    past: [],
    future: [],

    showGrid: false,
    gridSize: 8,
    snapToGrid: false,

    fabOpen: false,
    setFabOpen: (open) => set({ fabOpen: open }),

    activePage: () => {
      const s = get();
      return s.doc.pages.find((p) => p.id === s.activePageId) ?? s.doc.pages[0];
    },
    selectedShapes: () => {
      const s = get();
      const page = s.activePage();
      return page.shapes.filter((sh) => s.selectedIds.includes(sh.id));
    },

    setTool: (t) => set({ tool: t }),
    setZoom: (z) => set({ zoom: Math.min(8, Math.max(0.05, z)) }),
    setPan: (p) => set({ pan: p }),
    select: (ids) => set({ selectedIds: ids }),
    toggleSelect: (id, additive) =>
      set((s) => {
        if (!additive) return { selectedIds: [id] };
        return s.selectedIds.includes(id)
          ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
          : { selectedIds: [...s.selectedIds, id] };
      }),
    clearSelection: () => set({ selectedIds: [] }),

    addShape: (shape) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId ? { ...p, shapes: [...p.shapes, shape] } : p,
        );
        return {
          past,
          future: [],
          doc: { ...s.doc, pages },
          selectedIds: [shape.id],
        };
      }),

    updateShape: (id, patch) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes.map((sh) =>
                  sh.id === id ? ({ ...sh, ...patch } as Shape) : sh,
                ),
              }
            : p,
        );
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    updateMany: (patches) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const map = new Map(patches.map((p) => [p.id, p.patch]));
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes.map((sh) =>
                  map.has(sh.id)
                    ? ({ ...sh, ...map.get(sh.id) } as Shape)
                    : sh,
                ),
              }
            : p,
        );
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    beginAction: () =>
      set((s) => ({ past: [...s.past, snapshot(s)], future: [] })),

    updateShapeNoHistory: (id, patch) =>
      set((s) => {
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes.map((sh) =>
                  sh.id === id ? ({ ...sh, ...patch } as Shape) : sh,
                ),
              }
            : p,
        );
        return { doc: { ...s.doc, pages } };
      }),

    updateManyNoHistory: (patches) =>
      set((s) => {
        const map = new Map(patches.map((p) => [p.id, p.patch]));
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes.map((sh) =>
                  map.has(sh.id)
                    ? ({ ...sh, ...map.get(sh.id) } as Shape)
                    : sh,
                ),
              }
            : p,
        );
        return { doc: { ...s.doc, pages } };
      }),

    selectAll: () =>
      set((s) => {
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        return { selectedIds: page.shapes.map((sh) => sh.id) };
      }),

    deleteShapes: (ids) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const idSet = new Set(ids);
        // also delete children of deleted groups
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        const childrenToDelete = new Set<string>();
        if (page) {
          for (const sh of page.shapes) {
            if (sh.parentId && idSet.has(sh.parentId)) childrenToDelete.add(sh.id);
          }
        }
        const toDelete = new Set([...idSet, ...childrenToDelete]);
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? { ...p, shapes: p.shapes.filter((sh) => !toDelete.has(sh.id)) }
            : p,
        );
        return {
          past,
          future: [],
          doc: { ...s.doc, pages },
          selectedIds: s.selectedIds.filter((x) => !toDelete.has(x)),
        };
      }),

    duplicateSelected: () =>
      set((s) => {
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        const sel = page.shapes.filter((sh) => s.selectedIds.includes(sh.id));
        if (!sel.length) return {};
        const past = [...s.past, snapshot(s)];
        const clones = sel.map(
          (sh) =>
            ({
              ...JSON.parse(JSON.stringify(sh)),
              id: newId(),
              x: sh.x + 16,
              y: sh.y + 16,
              name: `${sh.name} copy`,
            }) as Shape,
        );
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? { ...p, shapes: [...p.shapes, ...clones] }
            : p,
        );
        return {
          past,
          future: [],
          doc: { ...s.doc, pages },
          selectedIds: clones.map((c) => c.id),
        };
      }),

    bringToFront: (id) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const pages = s.doc.pages.map((p) => {
          if (p.id !== s.activePageId) return p;
          const target = p.shapes.find((sh) => sh.id === id);
          if (!target) return p;
          return {
            ...p,
            shapes: [...p.shapes.filter((sh) => sh.id !== id), target],
          };
        });
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    sendToBack: (id) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const pages = s.doc.pages.map((p) => {
          if (p.id !== s.activePageId) return p;
          const target = p.shapes.find((sh) => sh.id === id);
          if (!target) return p;
          return {
            ...p,
            shapes: [target, ...p.shapes.filter((sh) => sh.id !== id)],
          };
        });
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    // Reorder a shape in the page's shapes[] (z-order). LayersPanel renders
    // top-most first (reverse of shapes[]), so "above" means a larger array
    // index, "below" a smaller one. Same parentId only.
    reorderLayer: (dragId, targetId, position) =>
      set((s) => {
        if (dragId === targetId) return {};
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        const arr = [...page.shapes];
        const fromIdx = arr.findIndex((sh) => sh.id === dragId);
        if (fromIdx < 0) return {};
        const drag = arr[fromIdx];
        const tgt = arr.find((sh) => sh.id === targetId);
        if (!tgt) return {};
        if ((drag.parentId ?? null) !== (tgt.parentId ?? null)) return {};
        const past = [...s.past, snapshot(s)];
        arr.splice(fromIdx, 1);
        const toIdx = arr.findIndex((sh) => sh.id === targetId);
        if (toIdx < 0) return {};
        const insertIdx = position === "above" ? toIdx + 1 : toIdx;
        arr.splice(insertIdx, 0, drag);
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId ? { ...p, shapes: arr } : p,
        );
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    applyBoolean: (originIds, pathD, bbox, options) =>
      set((s) => {
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        const idSet = new Set(originIds);
        const originals = page.shapes.filter((sh) => idSet.has(sh.id));
        if (originals.length < 2) return {};
        const first = originals[0];
        const past = [...s.past, snapshot(s)];
        const result = makeShape("path", {
          x: bbox.x,
          y: bbox.y,
          width: Math.max(1, bbox.width),
          height: Math.max(1, bbox.height),
          d: pathD,
          fill: options?.fill ?? (first.fill !== "none" ? first.fill : "#845ef7"),
          stroke: options?.stroke ?? first.stroke,
          strokeWidth: options?.strokeWidth ?? first.strokeWidth,
          name: options?.name ?? "패스 (Boolean)",
          parentId: first.parentId,
        });
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: [...p.shapes.filter((sh) => !idSet.has(sh.id)), result],
              }
            : p,
        );
        return {
          past,
          future: [],
          doc: { ...s.doc, pages },
          selectedIds: [result.id],
        };
      }),

    reparent: (ids, parentId) =>
      set((s) => {
        if (!ids.length) return {};
        const past = [...s.past, snapshot(s)];
        const idSet = new Set(ids);
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes.map((sh) =>
                  idSet.has(sh.id) ? ({ ...sh, parentId } as Shape) : sh,
                ),
              }
            : p,
        );
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    alignSelected: (axis) =>
      set((s) => {
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        const sel = page.shapes.filter((sh) => s.selectedIds.includes(sh.id));
        if (sel.length < 2) return {};
        const past = [...s.past, snapshot(s)];
        const minX = Math.min(...sel.map((sh) => sh.x));
        const maxX = Math.max(...sel.map((sh) => sh.x + sh.width));
        const minY = Math.min(...sel.map((sh) => sh.y));
        const maxY = Math.max(...sel.map((sh) => sh.y + sh.height));
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const idSet = new Set(s.selectedIds);
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes.map((sh) => {
                  if (!idSet.has(sh.id)) return sh;
                  let { x, y } = sh;
                  if (axis === "left") x = minX;
                  else if (axis === "right") x = maxX - sh.width;
                  else if (axis === "centerX") x = midX - sh.width / 2;
                  else if (axis === "top") y = minY;
                  else if (axis === "bottom") y = maxY - sh.height;
                  else if (axis === "centerY") y = midY - sh.height / 2;
                  return { ...sh, x, y } as Shape;
                }),
              }
            : p,
        );
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    distributeSelected: (axis) =>
      set((s) => {
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        const sel = page.shapes.filter((sh) => s.selectedIds.includes(sh.id));
        if (sel.length < 3) return {};
        const past = [...s.past, snapshot(s)];
        const idMap = new Map<string, Partial<Shape>>();

        if (axis === "horizontal") {
          const sorted = [...sel].sort((a, b) => a.x - b.x);
          const totalWidth = sorted.reduce((sum, sh) => sum + sh.width, 0);
          const span = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width - sorted[0].x;
          const gap = (span - totalWidth) / (sorted.length - 1);
          let curX = sorted[0].x;
          for (const sh of sorted) {
            idMap.set(sh.id, { x: curX });
            curX += sh.width + gap;
          }
        } else {
          const sorted = [...sel].sort((a, b) => a.y - b.y);
          const totalHeight = sorted.reduce((sum, sh) => sum + sh.height, 0);
          const span = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height - sorted[0].y;
          const gap = (span - totalHeight) / (sorted.length - 1);
          let curY = sorted[0].y;
          for (const sh of sorted) {
            idMap.set(sh.id, { y: curY });
            curY += sh.height + gap;
          }
        }

        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes.map((sh) =>
                  idMap.has(sh.id) ? ({ ...sh, ...idMap.get(sh.id) } as Shape) : sh,
                ),
              }
            : p,
        );
        return { past, future: [], doc: { ...s.doc, pages } };
      }),

    groupSelected: () =>
      set((s) => {
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        const sel = page.shapes.filter(
          (sh) => s.selectedIds.includes(sh.id) && sh.type !== "group",
        );
        if (sel.length < 2) return {};
        const past = [...s.past, snapshot(s)];
        const minX = Math.min(...sel.map((sh) => sh.x));
        const minY = Math.min(...sel.map((sh) => sh.y));
        const maxX = Math.max(...sel.map((sh) => sh.x + sh.width));
        const maxY = Math.max(...sel.map((sh) => sh.y + sh.height));
        const group = makeShape("group", {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          fill: "none",
          stroke: "none",
          strokeWidth: 0,
        });
        const selIds = new Set(s.selectedIds);
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: [
                  ...p.shapes.filter((sh) => !selIds.has(sh.id)),
                  ...p.shapes
                    .filter((sh) => selIds.has(sh.id))
                    .map((sh) => ({ ...sh, parentId: group.id } as Shape)),
                  group,
                ],
              }
            : p,
        );
        return { past, future: [], doc: { ...s.doc, pages }, selectedIds: [group.id] };
      }),

    ungroupSelected: () =>
      set((s) => {
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        const groups = page.shapes.filter(
          (sh) => s.selectedIds.includes(sh.id) && sh.type === "group",
        );
        if (!groups.length) return {};
        const past = [...s.past, snapshot(s)];
        const groupIds = new Set(groups.map((g) => g.id));
        const liberated: string[] = [];
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId
            ? {
                ...p,
                shapes: p.shapes
                  .filter((sh) => !groupIds.has(sh.id))
                  .map((sh) => {
                    if (sh.parentId && groupIds.has(sh.parentId)) {
                      const g = groups.find((gr) => gr.id === sh.parentId)!;
                      liberated.push(sh.id);
                      return { ...sh, parentId: g.parentId } as Shape;
                    }
                    return sh;
                  }),
              }
            : p,
        );
        return { past, future: [], doc: { ...s.doc, pages }, selectedIds: liberated };
      }),

    applyOps: (ops) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const page = s.doc.pages.find((p) => p.id === s.activePageId);
        if (!page) return {};
        let shapes = [...page.shapes];
        const touched: string[] = [];
        for (const op of ops) {
          if (op.op === "delete" && op.id) {
            shapes = shapes.filter((sh) => sh.id !== op.id);
          } else if (op.op === "update" && (op.id || op.shape?.id)) {
            const id = op.id ?? (op.shape?.id as string);
            shapes = shapes.map((sh) =>
              sh.id === id ? ({ ...sh, ...op.shape, id } as Shape) : sh,
            );
            touched.push(id);
          } else if (op.op === "add" && op.shape) {
            const type = (op.shape.type ?? "rect") as ShapeType;
            const created = makeShape(type, op.shape as Partial<Shape>);
            shapes.push(created);
            touched.push(created.id);
          }
        }
        const pages = s.doc.pages.map((p) =>
          p.id === s.activePageId ? { ...p, shapes } : p,
        );
        return {
          past,
          future: [],
          doc: { ...s.doc, pages },
          selectedIds: touched.length ? touched : s.selectedIds,
        };
      }),

    addPage: (name) =>
      set((s) => {
        const past = [...s.past, snapshot(s)];
        const page: Page = {
          id: newId("page"),
          name: name || `Page ${s.doc.pages.length + 1}`,
          shapes: [],
        };
        return {
          past,
          future: [],
          doc: { ...s.doc, pages: [...s.doc.pages, page] },
          activePageId: page.id,
          selectedIds: [],
        };
      }),

    renamePage: (id, name) =>
      set((s) => {
        const pages = s.doc.pages.map((p) =>
          p.id === id ? { ...p, name } : p,
        );
        return { doc: { ...s.doc, pages } };
      }),

    deletePage: (id) =>
      set((s) => {
        if (s.doc.pages.length <= 1) return {};
        const past = [...s.past, snapshot(s)];
        const pages = s.doc.pages.filter((p) => p.id !== id);
        const nextActive =
          s.activePageId === id ? pages[0].id : s.activePageId;
        return {
          past,
          future: [],
          doc: { ...s.doc, pages },
          activePageId: nextActive,
          selectedIds: [],
        };
      }),

    setActivePage: (id) => set({ activePageId: id, selectedIds: [] }),

    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
    setGridSize: (n) => set({ gridSize: Math.max(1, n) }),

    undo: () =>
      set((s) => {
        if (!s.past.length) return {};
        const prev = s.past[s.past.length - 1];
        const future = [snapshot(s), ...s.future];
        return {
          past: s.past.slice(0, -1),
          future,
          doc: { ...s.doc, pages: prev.pages },
          selectedIds: prev.selectedIds,
        };
      }),

    redo: () =>
      set((s) => {
        if (!s.future.length) return {};
        const next = s.future[0];
        const past = [...s.past, snapshot(s)];
        return {
          future: s.future.slice(1),
          past,
          doc: { ...s.doc, pages: next.pages },
          selectedIds: next.selectedIds,
        };
      }),

    resetDoc: () => {
      const d = emptyDoc();
      set({
        doc: d,
        activePageId: d.pages[0].id,
        selectedIds: [],
        past: [],
        future: [],
        zoom: 1,
        pan: { x: 0, y: 0 },
      });
    },
  };
});

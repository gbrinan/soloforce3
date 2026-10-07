"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDesign, makeShape, type ToolId } from "@/lib/store/designStore";
import type { Shape } from "@/lib/design/types";
import ShapeView from "./ShapeView";

type Pt = { x: number; y: number };

const HANDLES = [
  "nw", "n", "ne", "e", "se", "s", "sw", "w",
] as const;
type Handle = (typeof HANDLES)[number];

const DRAW_TOOLS: ToolId[] = ["rect", "ellipse", "text", "frame", "line"];

function snapTo(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

// ── Pen tool helpers ──────────────────────────────────────────────────────
// 각 anchor 는 좌표 + 양쪽 베지어 핸들(cin/cout)을 가진다. 핸들이 없으면 corner.
type PenAnchor = { x: number; y: number; cin?: Pt; cout?: Pt };

function penPathD(anchors: PenAnchor[], closed: boolean, ox = 0, oy = 0): string {
  if (anchors.length === 0) return "";
  const parts: string[] = [`M ${anchors[0].x - ox} ${anchors[0].y - oy}`];
  const seg = (prev: PenAnchor, cur: PenAnchor) => {
    if (prev.cout || cur.cin) {
      const c1 = prev.cout ?? { x: prev.x, y: prev.y };
      const c2 = cur.cin ?? { x: cur.x, y: cur.y };
      parts.push(
        `C ${c1.x - ox} ${c1.y - oy} ${c2.x - ox} ${c2.y - oy} ${cur.x - ox} ${cur.y - oy}`,
      );
    } else {
      parts.push(`L ${cur.x - ox} ${cur.y - oy}`);
    }
  };
  for (let i = 1; i < anchors.length; i++) seg(anchors[i - 1], anchors[i]);
  if (closed && anchors.length >= 2) {
    seg(anchors[anchors.length - 1], anchors[0]);
    parts.push("Z");
  }
  return parts.join(" ");
}

function penBbox(anchors: PenAnchor[]): { x: number; y: number; w: number; h: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const a of anchors) {
    xs.push(a.x);
    ys.push(a.y);
    if (a.cin) {
      xs.push(a.cin.x);
      ys.push(a.cin.y);
    }
    if (a.cout) {
      xs.push(a.cout.x);
      ys.push(a.cout.y);
    }
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export default function Canvas() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const doc = useDesign((s) => s.doc);
  const activePageId = useDesign((s) => s.activePageId);
  const tool = useDesign((s) => s.tool);
  const selectedIds = useDesign((s) => s.selectedIds);
  const zoom = useDesign((s) => s.zoom);
  const pan = useDesign((s) => s.pan);
  const showGrid = useDesign((s) => s.showGrid);
  const gridSize = useDesign((s) => s.gridSize);
  const snapToGrid = useDesign((s) => s.snapToGrid);

  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];

  const [draft, setDraft] = useState<Shape | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const drag = useRef<{
    mode: "move" | "resize" | "pan" | "draw" | "marquee" | null;
    handle?: Handle;
    start: Pt;
    origin: Record<string, Shape>;
    panStart: Pt;
  }>({ mode: null, start: { x: 0, y: 0 }, origin: {}, panStart: { x: 0, y: 0 } });
  // 모바일 두 손가락 팬 제스처 — pointerId별 최신 위치 추적(핀치 줌은 스코프 아님).
  const touchPoints = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Pen tool 진행 상태: anchors 와 현재 드래그 중인 anchor 인덱스.
  // 키보드 핸들러에서 stale closure 방지를 위해 ref 로도 동기화.
  const [penAnchors, setPenAnchors] = useState<PenAnchor[] | null>(null);
  const penAnchorsRef = useRef<PenAnchor[] | null>(null);
  const penDragRef = useRef<{ idx: number } | null>(null);
  useEffect(() => {
    penAnchorsRef.current = penAnchors;
  }, [penAnchors]);

  // pen 모드를 빠져나오거나 도구가 바뀌면 진행 중인 path 폐기.
  useEffect(() => {
    if (tool !== "pen" && penAnchorsRef.current) {
      setPenAnchors(null);
      penDragRef.current = null;
    }
  }, [tool]);

  const finishPen = useCallback((closed: boolean) => {
    const anchors = penAnchorsRef.current;
    setPenAnchors(null);
    penDragRef.current = null;
    if (!anchors || anchors.length < 2) {
      useDesign.getState().setTool("select");
      return;
    }
    const bb = penBbox(anchors);
    const d = penPathD(anchors, closed, bb.x, bb.y);
    const st = useDesign.getState();
    st.addShape(
      makeShape("path", {
        x: bb.x,
        y: bb.y,
        width: bb.w,
        height: bb.h,
        d,
        fill: closed ? "#845ef7" : "none",
        stroke: "#845ef7",
        strokeWidth: 2,
        name: closed ? "패스 (닫힘)" : "패스",
      }),
    );
    st.setTool("select");
  }, []);

  const toCanvas = useCallback(
    (clientX: number, clientY: number): Pt => {
      const r = svgRef.current?.getBoundingClientRect();
      const ox = r?.left ?? 0;
      const oy = r?.top ?? 0;
      return {
        x: (clientX - ox - pan.x) / zoom,
        y: (clientY - oy - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  const onShapePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (tool !== "select") return;
      e.stopPropagation();
      const st = useDesign.getState();

      // If shape is a child of a group, redirect to group
      let targetId = id;
      const clickedShape = page.shapes.find((s) => s.id === id);
      if (clickedShape?.parentId) {
        const parent = page.shapes.find((s) => s.id === clickedShape.parentId);
        if (parent?.type === "group") targetId = parent.id;
      }

      const additive = e.shiftKey;
      let sel = st.selectedIds;
      if (!sel.includes(targetId)) {
        st.toggleSelect(targetId, additive);
        sel = useDesign.getState().selectedIds;
      }
      const origin: Record<string, Shape> = {};
      for (const sh of page.shapes) if (sel.includes(sh.id)) origin[sh.id] = sh;

      // Include children of any selected groups in origin (so they move with the group)
      for (const sh of page.shapes) {
        if (sh.parentId && sel.includes(sh.parentId)) {
          origin[sh.id] = sh;
        }
      }

      st.beginAction();
      drag.current = {
        mode: "move",
        start: toCanvas(e.clientX, e.clientY),
        origin,
        panStart: pan,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [tool, page.shapes, toCanvas, pan],
  );

  const onHandlePointerDown = (e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation();
    const st = useDesign.getState();
    const origin: Record<string, Shape> = {};
    for (const sh of page.shapes)
      if (st.selectedIds.includes(sh.id)) origin[sh.id] = sh;
    st.beginAction();
    drag.current = {
      mode: "resize",
      handle,
      start: toCanvas(e.clientX, e.clientY),
      origin,
      panStart: pan,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPoints.current.size >= 2) {
        const pts = Array.from(touchPoints.current.values()).slice(0, 2);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        drag.current = { mode: "pan", start: mid, origin: {}, panStart: pan };
        return;
      }
    }
    const st = useDesign.getState();
    const p = toCanvas(e.clientX, e.clientY);

    if (tool === "hand" || e.button === 1 || e.altKey) {
      drag.current = { mode: "pan", start: { x: e.clientX, y: e.clientY }, origin: {}, panStart: pan };
      return;
    }
    if (tool === "pen") {
      const cur = penAnchorsRef.current ?? [];
      // 시작 anchor 근처 클릭 → 닫는 path 로 완료.
      if (cur.length >= 2) {
        const first = cur[0];
        const dx = first.x - p.x;
        const dy = first.y - p.y;
        const tol2 = (10 / zoom) * (10 / zoom);
        if (dx * dx + dy * dy < tol2) {
          finishPen(true);
          return;
        }
      }
      const next: PenAnchor[] = [...cur, { x: p.x, y: p.y }];
      setPenAnchors(next);
      penAnchorsRef.current = next;
      penDragRef.current = { idx: next.length - 1 };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (DRAW_TOOLS.includes(tool)) {
      const snapped = st.snapToGrid
        ? { x: snapTo(p.x, st.gridSize), y: snapTo(p.y, st.gridSize) }
        : p;
      const created = makeShape(tool === "select" ? "rect" : (tool as Shape["type"]), {
        x: snapped.x,
        y: snapped.y,
        width: tool === "text" ? 200 : 1,
        height: tool === "text" ? 48 : 1,
        ...(tool === "line" ? { x2: snapped.x, y2: snapped.y } : {}),
      });
      setDraft(created);
      drag.current = { mode: "draw", start: snapped, origin: {}, panStart: pan };
      return;
    }
    st.clearSelection();
    setMarquee({ a: p, b: p });
    drag.current = { mode: "marquee", start: p, origin: {}, panStart: pan };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Pen 베지어 핸들 드래그는 별도 drag.mode 없이 처리.
    if (tool === "pen" && penDragRef.current && penAnchorsRef.current) {
      const p = toCanvas(e.clientX, e.clientY);
      const idx = penDragRef.current.idx;
      const arr = penAnchorsRef.current;
      const a = arr[idx];
      if (!a) return;
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      if (dx * dx + dy * dy < 1) return;
      const cout = { x: a.x + dx, y: a.y + dy };
      const cin = { x: a.x - dx, y: a.y - dy };
      const nextArr: PenAnchor[] = arr.map((it, i) =>
        i === idx ? { ...it, cin, cout } : it,
      );
      penAnchorsRef.current = nextArr;
      setPenAnchors(nextArr);
      return;
    }

    if (e.pointerType === "touch" && touchPoints.current.has(e.pointerId)) {
      touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    const d = drag.current;
    if (!d.mode) return;
    const st = useDesign.getState();

    if (d.mode === "pan") {
      if (touchPoints.current.size >= 2) {
        const pts = Array.from(touchPoints.current.values()).slice(0, 2);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        st.setPan({
          x: d.panStart.x + (mid.x - d.start.x),
          y: d.panStart.y + (mid.y - d.start.y),
        });
      } else {
        st.setPan({
          x: d.panStart.x + (e.clientX - d.start.x),
          y: d.panStart.y + (e.clientY - d.start.y),
        });
      }
      return;
    }

    const p = toCanvas(e.clientX, e.clientY);
    const rawDx = p.x - d.start.x;
    const rawDy = p.y - d.start.y;

    if (d.mode === "move") {
      // Snap relative to the first origin shape's starting position
      const first = Object.values(d.origin)[0];
      let dx = rawDx;
      let dy = rawDy;
      if (st.snapToGrid && first) {
        dx = snapTo(first.x + rawDx, st.gridSize) - first.x;
        dy = snapTo(first.y + rawDy, st.gridSize) - first.y;
      }
      const patches = Object.values(d.origin).map((o) => ({
        id: o.id,
        patch:
          o.type === "line"
            ? { x: o.x + dx, y: o.y + dy, x2: (o as Shape & { x2: number }).x2 + dx, y2: (o as Shape & { y2: number }).y2 + dy }
            : { x: o.x + dx, y: o.y + dy },
      }));
      st.updateManyNoHistory(patches as { id: string; patch: Partial<Shape> }[]);
      return;
    }

    if (d.mode === "resize" && d.handle) {
      const o = Object.values(d.origin)[0];
      if (!o) return;
      let { x, y, width, height } = o;
      const h = d.handle;
      if (h.includes("e")) width = Math.max(1, o.width + rawDx);
      if (h.includes("s")) height = Math.max(1, o.height + rawDy);
      if (h.includes("w")) {
        width = Math.max(1, o.width - rawDx);
        x = o.x + rawDx;
      }
      if (h.includes("n")) {
        height = Math.max(1, o.height - rawDy);
        y = o.y + rawDy;
      }
      if (st.snapToGrid) {
        x = snapTo(x, st.gridSize);
        y = snapTo(y, st.gridSize);
        width = Math.max(1, snapTo(width, st.gridSize));
        height = Math.max(1, snapTo(height, st.gridSize));
      }
      st.updateShapeNoHistory(o.id, { x, y, width, height });
      return;
    }

    if (d.mode === "draw" && draft) {
      if (draft.type === "line") {
        const snapped = st.snapToGrid
          ? { x: snapTo(p.x, st.gridSize), y: snapTo(p.y, st.gridSize) }
          : p;
        setDraft({ ...draft, x2: snapped.x, y2: snapped.y } as Shape);
      } else {
        const rawX = Math.min(d.start.x, p.x);
        const rawY = Math.min(d.start.y, p.y);
        const rawW = Math.max(1, Math.abs(rawDx));
        const rawH = Math.max(1, Math.abs(rawDy));
        const x = st.snapToGrid ? snapTo(rawX, st.gridSize) : rawX;
        const y = st.snapToGrid ? snapTo(rawY, st.gridSize) : rawY;
        const width = st.snapToGrid ? Math.max(1, snapTo(rawW, st.gridSize)) : rawW;
        const height = st.snapToGrid ? Math.max(1, snapTo(rawH, st.gridSize)) : rawH;
        setDraft({ ...draft, x, y, width, height } as Shape);
      }
      return;
    }

    if (d.mode === "marquee") {
      setMarquee({ a: d.start, b: p });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touchPoints.current.delete(e.pointerId);
    }
    if (tool === "pen") {
      penDragRef.current = null;
      return;
    }
    const d = drag.current;
    const st = useDesign.getState();

    if (d.mode === "draw" && draft) {
      const big = draft.type === "text" || draft.width > 3 || draft.height > 3 || draft.type === "line";
      if (big) st.addShape(draft);
      setDraft(null);
      st.setTool("select");
    }

    if (d.mode === "marquee" && marquee) {
      const x1 = Math.min(marquee.a.x, marquee.b.x);
      const y1 = Math.min(marquee.a.y, marquee.b.y);
      const x2 = Math.max(marquee.a.x, marquee.b.x);
      const y2 = Math.max(marquee.a.y, marquee.b.y);
      const hits = page.shapes
        .filter(
          (s) =>
            s.x + s.width >= x1 &&
            s.x <= x2 &&
            s.y + s.height >= y1 &&
            s.y <= y2,
        )
        .map((s) => s.id);
      if (hits.length) st.select(hits);
      setMarquee(null);
    }

    drag.current = { mode: null, start: { x: 0, y: 0 }, origin: {}, panStart: pan };
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = useDesign.getState();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      st.setZoom(st.zoom * factor);
    } else {
      st.setPan({ x: st.pan.x - e.deltaX, y: st.pan.y - e.deltaY });
    }
  };

  useEffect(() => {
    let prevTool: ToolId | null = null;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const st = useDesign.getState();
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key;

      if ((k === "Delete" || k === "Backspace") && st.selectedIds.length) {
        e.preventDefault();
        st.deleteShapes(st.selectedIds);
        return;
      }
      if (meta && k.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        st.undo();
        return;
      }
      if (meta && (k.toLowerCase() === "y" || (k.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        st.redo();
        return;
      }
      if (meta && k.toLowerCase() === "d") {
        e.preventDefault();
        st.duplicateSelected();
        return;
      }
      if (meta && k.toLowerCase() === "a") {
        e.preventDefault();
        st.selectAll();
        return;
      }
      // Cmd/Ctrl+Shift+G = ungroup
      if (meta && k.toLowerCase() === "g" && e.shiftKey) {
        e.preventDefault();
        st.ungroupSelected();
        return;
      }
      // Cmd/Ctrl+G = group
      if (meta && k.toLowerCase() === "g") {
        e.preventDefault();
        st.groupSelected();
        return;
      }
      if (k === "Escape") {
        e.preventDefault();
        if (penAnchorsRef.current && penAnchorsRef.current.length > 0) {
          setPenAnchors(null);
          penAnchorsRef.current = null;
          penDragRef.current = null;
          st.setTool("select");
          return;
        }
        st.clearSelection();
        st.setTool("select");
        return;
      }
      if (k === "Enter" && penAnchorsRef.current && penAnchorsRef.current.length >= 2) {
        e.preventDefault();
        finishPen(false);
        return;
      }
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
        if (!st.selectedIds.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
        const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
        const page = st.activePage();
        const sel = new Set(st.selectedIds);
        const patches = page.shapes
          .filter((sh) => sel.has(sh.id))
          .map((o) => ({
            id: o.id,
            patch:
              o.type === "line"
                ? {
                    x: o.x + dx,
                    y: o.y + dy,
                    x2: (o as Shape & { x2: number }).x2 + dx,
                    y2: (o as Shape & { y2: number }).y2 + dy,
                  }
                : { x: o.x + dx, y: o.y + dy },
          }));
        st.updateMany(patches as { id: string; patch: Partial<Shape> }[]);
        return;
      }
      if (k === " " && prevTool === null) {
        e.preventDefault();
        prevTool = st.tool;
        st.setTool("hand");
        return;
      }
      if (k === "v") st.setTool("select");
      else if (k === "r") st.setTool("rect");
      else if (k === "o") st.setTool("ellipse");
      else if (k === "t") st.setTool("text");
      else if (k === "f") st.setTool("frame");
      else if (k === "l") st.setTool("line");
      else if (k === "p") st.setTool("pen");
      else if (k === "h") st.setTool("hand");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && prevTool !== null) {
        e.preventDefault();
        useDesign.getState().setTool(prevTool);
        prevTool = null;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [finishPen]);

  // Clipboard image paste → insert as an image shape centered in the viewport.
  // Uses the synchronous paste ClipboardEvent (clipboardData.getAsFile), which
  // works inside the host's sandboxed iframe; the async navigator.clipboard.read
  // API would be blocked there for lack of clipboard-read permission.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      let file: File | null = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          file = it.getAsFile();
          break;
        }
      }
      if (!file) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const href = String(reader.result);
        const img = new Image();
        img.onload = () => {
          const st = useDesign.getState();
          const maxDim = 600;
          let w = img.naturalWidth || 200;
          let h = img.naturalHeight || 200;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const rect = svgRef.current?.getBoundingClientRect();
          const vw = rect?.width ?? st.doc.width;
          const vh = rect?.height ?? st.doc.height;
          const cx = (vw / 2 - st.pan.x) / st.zoom;
          const cy = (vh / 2 - st.pan.y) / st.zoom;
          st.addShape(
            makeShape("image", {
              x: Math.round(cx - w / 2),
              y: Math.round(cy - h / 2),
              width: w,
              height: h,
              href,
              name: "이미지 (붙여넣기)",
            }),
          );
          st.setTool("select");
        };
        img.src = href;
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const single =
    selectedIds.length === 1
      ? page.shapes.find((s) => s.id === selectedIds[0])
      : null;

  const handleSize = 8 / zoom;
  const gridPatternId = "canvas-grid-pattern";

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      tabIndex={0}
      onPointerDownCapture={() => svgRef.current?.focus({ preventScroll: true })}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{
        display: "block",
        outline: "none",
        background: "#04070F",
        cursor:
          tool === "hand"
            ? "grab"
            : tool === "pen" || DRAW_TOOLS.includes(tool)
              ? "crosshair"
              : "default",
        touchAction: "none",
      }}
    >
      <defs>
        {showGrid && (
          <pattern
            id={gridPatternId}
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none"
              stroke="rgba(125,134,153,0.35)"
              strokeWidth={0.5 / zoom}
            />
          </pattern>
        )}
      </defs>

      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {/* artboard */}
        <rect
          x={0}
          y={0}
          width={doc.width}
          height={doc.height}
          fill="#ffffff"
          stroke="#1F293D"
          strokeWidth={1 / zoom}
        />

        {/* grid overlay */}
        {showGrid && (
          <rect
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            fill={`url(#${gridPatternId})`}
            pointerEvents="none"
          />
        )}

        {page.shapes.map((s) => (
          <ShapeView
            key={s.id}
            shape={s}
            selected={selectedIds.includes(s.id)}
            onPointerDown={onShapePointerDown}
          />
        ))}

        {draft && (
          <ShapeView shape={draft} selected onPointerDown={() => {}} />
        )}

        {/* Pen tool: 진행 중인 path 와 anchor/handle 시각화 */}
        {tool === "pen" && penAnchors && penAnchors.length > 0 && (
          <g pointerEvents="none">
            <path
              d={penPathD(penAnchors, false)}
              fill="none"
              stroke="#6366F1"
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
            {penAnchors.map((a, i) => (
              <g key={i}>
                {a.cin && (
                  <>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={a.cin.x}
                      y2={a.cin.y}
                      stroke="#6366F1"
                      strokeWidth={0.5 / zoom}
                    />
                    <circle
                      cx={a.cin.x}
                      cy={a.cin.y}
                      r={3 / zoom}
                      fill="#6366F1"
                    />
                  </>
                )}
                {a.cout && (
                  <>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={a.cout.x}
                      y2={a.cout.y}
                      stroke="#6366F1"
                      strokeWidth={0.5 / zoom}
                    />
                    <circle
                      cx={a.cout.x}
                      cy={a.cout.y}
                      r={3 / zoom}
                      fill="#6366F1"
                    />
                  </>
                )}
                <circle
                  cx={a.x}
                  cy={a.y}
                  r={4 / zoom}
                  fill={i === 0 ? "#6366F1" : "#ffffff"}
                  stroke="#6366F1"
                  strokeWidth={1 / zoom}
                />
              </g>
            ))}
          </g>
        )}

        {/* resize handles for single selection (skip for groups) */}
        {single && single.type !== "group" &&
          HANDLES.map((h) => {
            const pos = handlePos(single, h);
            return (
              <rect
                key={h}
                x={pos.x - handleSize / 2}
                y={pos.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                fill="#ffffff"
                stroke="#6366F1"
                strokeWidth={1 / zoom}
                style={{ cursor: cursorFor(h) }}
                onPointerDown={(e) => onHandlePointerDown(e, h)}
              />
            );
          })}

        {marquee && (
          <rect
            x={Math.min(marquee.a.x, marquee.b.x)}
            y={Math.min(marquee.a.y, marquee.b.y)}
            width={Math.abs(marquee.b.x - marquee.a.x)}
            height={Math.abs(marquee.b.y - marquee.a.y)}
            fill="rgba(99,102,241,0.1)"
            stroke="#6366F1"
            strokeWidth={1 / zoom}
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}

function handlePos(s: Shape, h: Handle): Pt {
  const l = s.x;
  const r = s.x + s.width;
  const t = s.y;
  const b = s.y + s.height;
  const mx = s.x + s.width / 2;
  const my = s.y + s.height / 2;
  switch (h) {
    case "nw": return { x: l, y: t };
    case "n": return { x: mx, y: t };
    case "ne": return { x: r, y: t };
    case "e": return { x: r, y: my };
    case "se": return { x: r, y: b };
    case "s": return { x: mx, y: b };
    case "sw": return { x: l, y: b };
    case "w": return { x: l, y: my };
  }
}

function cursorFor(h: Handle): string {
  if (h === "n" || h === "s") return "ns-resize";
  if (h === "e" || h === "w") return "ew-resize";
  if (h === "nw" || h === "se") return "nwse-resize";
  return "nesw-resize";
}

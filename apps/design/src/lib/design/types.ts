// Shared design document model — the contract between canvas (FE), AI backend
// (/api/design/run), and the FAB. Penpot-inspired shape tree with frame nesting.

export type ShapeType =
  | "rect"
  | "ellipse"
  | "text"
  | "frame"
  | "line"
  | "path"
  | "image"
  | "group";

export interface BaseShape {
  id: string;
  type: ShapeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0..1
  fill: string; // hex (#RRGGBB) or "none"
  stroke: string; // hex or "none"
  strokeWidth: number;
  radius: number; // corner radius (rect only; ignored otherwise)
  visible: boolean;
  locked: boolean;
  parentId: string | null; // frame/group nesting; null = page root
  shadow?: { x: number; y: number; blur: number; color: string };
}

export interface RectShape extends BaseShape {
  type: "rect";
}
export interface EllipseShape extends BaseShape {
  type: "ellipse";
}
export interface FrameShape extends BaseShape {
  type: "frame";
}
export interface GroupShape extends BaseShape {
  type: "group";
}

export interface TextShape extends BaseShape {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  align: "left" | "center" | "right";
  color: string; // text color hex
}

export interface PathShape extends BaseShape {
  type: "path";
  d: string; // SVG path data (in shape-local coords, viewBox = width/height)
}

export interface ImageShape extends BaseShape {
  type: "image";
  href: string; // data: URL or absolute src
  alt?: string;
  sourcePrompt?: string;
  generatedAt?: string; // ISO timestamp for AI-generated assets
}

export interface LineShape extends BaseShape {
  type: "line";
  x2: number; // second endpoint (absolute)
  y2: number;
}

export type Shape =
  | RectShape
  | EllipseShape
  | FrameShape
  | GroupShape
  | TextShape
  | PathShape
  | ImageShape
  | LineShape;

export interface Page {
  id: string;
  name: string;
  shapes: Shape[];
}

export interface DesignDoc {
  id: string;
  name: string;
  width: number; // default artboard size
  height: number;
  pages: Page[];
}

// ── AI edit contract: POST /api/design/run ──────────────────────────────
// The agent receives the current doc + selected shape ids + a natural-language
// intent, and returns a list of operations to apply to the active page.

export interface DesignOp {
  op: "add" | "update" | "delete";
  // add: full shape (id may be omitted → client assigns). update: id + partial.
  shape?: Partial<Shape> & { type?: ShapeType };
  id?: string; // target id for update/delete
}

export interface DesignRunRequest {
  doc: DesignDoc;
  pageId: string;
  selectedIds: string[]; // targeted components (from FAB selection chips)
  intent: string;
}

export interface DesignRunResponse {
  ops: DesignOp[];
  message?: string;
  warnings?: string[];
}

export const DEFAULT_DOC_SIZE = { width: 1440, height: 1024 };

// ── Brand palette suggestion: POST /api/design/palette ──────────────────
// No shared "jarvis" palette token spec exists in the codebase (jarvis is a
// Mantine color name only), so this fallback contract is used.

export interface PaletteColor {
  role: string; // e.g. "primary" | "secondary" | "accent" | "background" | "surface" | "text"
  hex: string; // #RRGGBB
}

export interface PaletteSuggestion {
  name: string;
  colors: PaletteColor[];
  fonts: { heading: string; body: string };
}

export interface PaletteResponse {
  palette: PaletteSuggestion | null;
  message?: string;
}

// ── Layout critique: POST /api/design/critique ──────────────────────────
// Returns a textual critique plus suggested fix ops (applied only when the
// user clicks apply — same DesignOp pipeline as /api/design/run).

export interface CritiqueResponse {
  critique: string;
  ops: DesignOp[];
  message?: string;
}

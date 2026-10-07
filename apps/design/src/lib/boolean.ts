"use client";

import type { Shape } from "@/lib/design/types";

export type BoolType = "union" | "subtract" | "intersect" | "exclude";

// paper는 CommonJS + native deps(`canvas`) 를 가진 모듈이라 dynamic import.
// 번들러에 따라 default/named 양쪽으로 노출돼 typeof import 추론이 까다로워서,
// 런타임에서 정규화하고 타입은 `typeof PaperNS` 로 고정한다.
import type * as PaperNS from "paper";
type PaperMod = typeof PaperNS;
let paperPromise: Promise<PaperMod> | null = null;
function loadPaper(): Promise<PaperMod> {
  if (!paperPromise) {
    paperPromise = (async () => {
      const mod = (await import("paper")) as unknown as {
        default?: PaperMod;
      } & PaperMod;
      return mod.default ?? mod;
    })();
  }
  return paperPromise;
}

function makeItem(
  paper: PaperMod,
  s: Shape,
): InstanceType<PaperMod["PathItem"]> | null {
  let p: InstanceType<PaperMod["PathItem"]> | null = null;
  if (s.type === "rect" || s.type === "frame") {
    p = new paper.Path.Rectangle({
      point: [s.x, s.y],
      size: [s.width, s.height],
      radius: s.radius || 0,
    });
  } else if (s.type === "ellipse") {
    p = new paper.Path.Ellipse({
      point: [s.x, s.y],
      size: [s.width, s.height],
    });
  } else if (s.type === "path") {
    p = paper.PathItem.create(s.d);
    p.translate(new paper.Point(s.x, s.y));
  }
  if (p && s.rotation) {
    p.rotate(
      s.rotation,
      new paper.Point(s.x + s.width / 2, s.y + s.height / 2),
    );
  }
  return p;
}

export interface BoolResult {
  d: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export async function computeBoolean(
  type: BoolType,
  shapes: Shape[],
): Promise<BoolResult | null> {
  if (shapes.length < 2) return null;
  const paper = await loadPaper();
  const scope = new paper.PaperScope();
  // No DOM canvas needed for pure boolean math; provide a virtual one.
  scope.setup(new paper.Size(10000, 10000));
  try {
    const items = shapes
      .map((s) => makeItem(paper, s))
      .filter((p): p is InstanceType<PaperMod["PathItem"]> => !!p);
    if (items.length < 2) return null;
    const method =
      type === "union"
        ? "unite"
        : type === "subtract"
          ? "subtract"
          : type === "intersect"
            ? "intersect"
            : "exclude";
    let result: InstanceType<PaperMod["PathItem"]> = items[0];
    for (let i = 1; i < items.length; i++) {
      const next = (result as unknown as Record<string, Function>)[method].call(
        result,
        items[i],
      ) as InstanceType<PaperMod["PathItem"]>;
      result = next;
    }
    const b = result.bounds;
    result.translate(new paper.Point(-b.x, -b.y));
    return {
      d: result.pathData,
      bbox: { x: b.x, y: b.y, width: b.width, height: b.height },
    };
  } finally {
    scope.project.remove();
  }
}

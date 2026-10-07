import { NextRequest, NextResponse } from "next/server";
import { readEventTypes, updateEventType, deleteEventType } from "@/lib/event-types";
import type { EventType } from "@/types/event-type";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const found = (await readEventTypes()).find((et) => et.id === id || et.slug === id);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(found);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  let body: Partial<EventType>;
  try {
    body = (await req.json()) as Partial<EventType>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const all = await readEventTypes();
  const cur = all.find((et) => et.id === id);
  if (!cur) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (body.slug && body.slug !== cur.slug) {
    if (!/^[a-z0-9-]+$/.test(body.slug)) {
      return NextResponse.json({ error: "invalid slug format" }, { status: 400 });
    }
    if (all.some((et) => et.slug === body.slug && et.id !== id)) {
      return NextResponse.json({ error: "slug already exists" }, { status: 409 });
    }
  }

  const updated = await updateEventType(id, body);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const ok = await deleteEventType(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

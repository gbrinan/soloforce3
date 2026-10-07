import { NextRequest, NextResponse } from "next/server";
import {
  readEventTypes,
  findEventTypeBySlug,
  createEventType,
} from "@/lib/event-types";
import type { EventType } from "@/types/event-type";

export async function GET(req: NextRequest) {
  const all = await readEventTypes();
  const activeParam = req.nextUrl.searchParams.get("active");
  if (activeParam === "true") {
    return NextResponse.json(all.filter((et) => et.active));
  }
  return NextResponse.json(all);
}

export async function POST(req: NextRequest) {
  let body: Partial<EventType>;
  try {
    body = (await req.json()) as Partial<EventType>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.title || !body.slug) {
    return NextResponse.json({ error: "title and slug are required" }, { status: 400 });
  }
  if (typeof body.durationMin !== "number" || body.durationMin <= 0) {
    return NextResponse.json({ error: "durationMin must be a positive number" }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(body.slug)) {
    return NextResponse.json(
      { error: "slug must contain only lowercase letters, numbers, and hyphens" },
      { status: 400 },
    );
  }

  const existing = await findEventTypeBySlug(body.slug);
  if (existing) {
    return NextResponse.json({ error: "slug already exists" }, { status: 409 });
  }

  const newEventType = await createEventType({
    slug: body.slug,
    title: body.title,
    durationMin: body.durationMin,
    description: body.description,
    color: body.color ?? "jarvis",
    active: body.active ?? true,
  });

  return NextResponse.json(newEventType, { status: 201 });
}

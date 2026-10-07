import { NextRequest, NextResponse } from "next/server";
import { getMailbox, updateMailbox, deleteMailbox } from "@/lib/mailbox-store";
import type { Mailbox } from "@/types/mail";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  let patch: Partial<Mailbox>;
  try {
    patch = (await req.json()) as Partial<Mailbox>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const updated = await updateMailbox(id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const existing = await getMailbox(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteMailbox(id);
  return NextResponse.json({ ok: true });
}

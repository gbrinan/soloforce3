import { NextRequest, NextResponse } from "next/server";
import { getMail, updateMail, deleteMail } from "@/lib/mail-store";
import type { Mail } from "@/types/mail";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const mail = await getMail(id);
  if (!mail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(mail);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  let patch: Partial<Mail>;
  try {
    patch = (await req.json()) as Partial<Mail>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const updated = await updateMail(id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const existing = await getMail(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteMail(id);
  return NextResponse.json({ ok: true });
}

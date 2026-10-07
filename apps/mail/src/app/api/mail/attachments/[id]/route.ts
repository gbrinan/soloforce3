import { NextRequest, NextResponse } from "next/server";
import { readAttachment, ATTACHMENT_ID_RE } from "@/lib/mail-attachments";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!ATTACHMENT_ID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const att = await readAttachment(id);
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(att.buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(att.name)}`,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getAvailability, saveAvailability } from "@/lib/availability-store";

export async function GET() {
  const data = await getAvailability();
  if (data === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  await saveAvailability(body);
  return NextResponse.json({ ok: true });
}

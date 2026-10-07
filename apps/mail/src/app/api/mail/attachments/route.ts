import { NextRequest, NextResponse } from "next/server";
import { saveAttachment } from "@/lib/mail-attachments";

const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 25MB)" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const stored = await saveAttachment(buf, file.name || "file", file.type || "application/octet-stream");
  return NextResponse.json(
    { id: stored.id, name: stored.name, size: stored.size, mimeType: stored.mimeType, url: `/api/mail/attachments/${stored.id}` },
    { status: 201 },
  );
}

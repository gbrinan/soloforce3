import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sendMail } from "@/lib/mail/transport";
import { insertMail } from "@/lib/mail-store";
import { readAttachment } from "@/lib/mail-attachments";
import type { Mail, MailAttachment } from "@/types/mail";

interface SendRequest {
  mailboxId: string;
  from: { email: string; name?: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyType: "text" | "html";
  attachments?: MailAttachment[];
}

export async function POST(req: NextRequest) {
  let body: SendRequest;
  try {
    body = (await req.json()) as SendRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.mailboxId || !body.from?.email || !body.to?.length || !body.subject) {
    return NextResponse.json({ error: "Missing required fields: mailboxId, from, to, subject" }, { status: 400 });
  }

  const attachmentsMeta: MailAttachment[] = Array.isArray(body.attachments) ? body.attachments : [];
  const sendAttachments: { name: string; content: Buffer; mimeType: string }[] = [];
  for (const a of attachmentsMeta) {
    if (!a?.id) continue;
    const stored = await readAttachment(a.id);
    if (stored) {
      sendAttachments.push({
        name: a.name || stored.name,
        content: stored.buffer,
        mimeType: a.mimeType || "application/octet-stream",
      });
    }
  }

  let messageId: string;
  try {
    const result = await sendMail({
      from: body.from.email,
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      body: body.body ?? "",
      bodyType: body.bodyType ?? "text",
      attachments: sendAttachments.length ? sendAttachments : undefined,
    });
    messageId = result.messageId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mail/send] sendMail error:", msg);
    return NextResponse.json({ error: "Failed to send mail", detail: msg }, { status: 502 });
  }

  const mail: Mail = {
    id: randomUUID(),
    mailboxId: body.mailboxId,
    folder: "sent",
    from: body.from,
    to: body.to.map((e) => ({ email: e })),
    cc: body.cc?.map((e) => ({ email: e })),
    bcc: body.bcc?.map((e) => ({ email: e })),
    subject: body.subject,
    body: body.body ?? "",
    bodyType: body.bodyType ?? "text",
    read: true,
    starred: false,
    attachments: attachmentsMeta.length ? attachmentsMeta : undefined,
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  await insertMail(mail);
  return NextResponse.json({ ok: true, messageId, mail }, { status: 201 });
}

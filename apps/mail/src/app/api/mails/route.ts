import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listMails, insertMail } from "@/lib/mail-store";
import type { Mail, MailFolder } from "@/types/mail";


export async function GET(req: NextRequest) {
  const mailboxId = req.nextUrl.searchParams.get("mailboxId") ?? undefined;
  const folder = (req.nextUrl.searchParams.get("folder") ?? undefined) as MailFolder | undefined;
  const mails = await listMails(mailboxId, folder);
  return NextResponse.json(mails);
}

export async function POST(req: NextRequest) {
  let body: Partial<Mail>;
  try {
    body = (await req.json()) as Partial<Mail>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.mailboxId || !body.subject || !body.to?.length) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }

  const mail: Mail = {
    id: randomUUID(),
    mailboxId: body.mailboxId,
    folder: body.folder ?? "sent",
    from: body.from ?? { email: "" },
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject: body.subject,
    body: body.body ?? "",
    bodyType: body.bodyType ?? "text",
    read: true,
    starred: false,
    attachments: body.attachments,
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  await insertMail(mail);
  return NextResponse.json(mail, { status: 201 });
}

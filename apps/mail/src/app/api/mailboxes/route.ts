import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listMailboxes, insertMailbox } from "@/lib/mailbox-store";
import type { Mailbox } from "@/types/mail";

export async function GET() {
  const mailboxes = await listMailboxes();
  return NextResponse.json(mailboxes);
}

export async function POST(req: NextRequest) {
  let body: Partial<Mailbox>;
  try {
    body = (await req.json()) as Partial<Mailbox>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.email || !body.displayName) {
    return NextResponse.json({ error: "email and displayName required" }, { status: 400 });
  }

  const mailbox: Mailbox = {
    id: randomUUID(),
    email: body.email,
    displayName: body.displayName,
    ...(body.forwardTo ? { forwardTo: body.forwardTo } : {}),
    createdAt: new Date().toISOString(),
  };

  await insertMailbox(mailbox);
  return NextResponse.json(mailbox, { status: 201 });
}

/**
 * POST /api/mail/inbound
 *
 * Receives parsed inbound email from the Cloudflare Email Worker.
 * Verifies the shared secret, then calls developer CRUD layer to persist.
 *
 * saveInboundMail() persists via lib/mail-store insertMail (구현 완료 — 2026-07-04 주석 정정).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { insertMail } from "@/lib/mail-store";
import { listMailboxes } from "@/lib/mailbox-store";
import { saveAttachment } from "@/lib/mail-attachments";
import type { InboundMailPayload, SaveInboundMailFn } from "@/lib/mail/transport";
import type { Mail, MailAttachment } from "@/types/mail";

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfigured: refuse all requests to avoid open ingestion
    console.error("[mail/inbound] INBOUND_WEBHOOK_SECRET not set — rejecting request");
    return false;
  }
  return req.headers.get("x-mail-worker-secret") === secret;
}

// ── CRUD stub (Paul fills this in) ───────────────────────────────────────────

/**
 * 수신 메일 저장 — mail-store(insertMail)로 영속화한다 (stub 아님, 주석 정정 2026-07-04).
 *
 * The function receives:
 *   - mailboxAddress: the To address that matched one of our registered mailboxes
 *   - mail: parsed email payload (see InboundMailPayload in transport.ts)
 *
 * It should persist the email and return the new record's ID.
 */
const saveInboundMail: SaveInboundMailFn = async (mailboxAddress, mail) => {
  // CF 워커 payload는 text/html 키를 쓰고 타입 정의는 bodyText/bodyHtml — 양쪽 모두 수용.
  const raw = mail as InboundMailPayload & { text?: string; html?: string; fromName?: string };
  const bodyHtml = raw.bodyHtml ?? raw.html;
  const bodyText = raw.bodyText ?? raw.text;
  // 수신 주소를 등록 메일함 id로 해석 — 주소를 그대로 mailboxId로 저장하면
  // 메일함(id "default") 조회에서 누락된다.
  const addr = mailboxAddress.trim().toLowerCase();
  const boxes = await listMailboxes();
  const box = boxes.find((b) => b.email.trim().toLowerCase() === addr);

  // 인라인(base64) 첨부를 로컬에 저장 → 앱의 기존 서빙 경로(/api/mail/attachments/:id)로 바로 열람.
  // r2Key만 있고 인라인이 없는 대형 첨부는 로컬 서빙 불가라 메타에서 제외한다(누락 로그).
  const attachments: MailAttachment[] = [];
  for (const att of raw.attachments ?? []) {
    if (att.contentBase64) {
      try {
        const buf = Buffer.from(att.contentBase64, "base64");
        const stored = await saveAttachment(buf, att.filename, att.contentType);
        attachments.push({ id: stored.id, name: stored.name, size: stored.size, mimeType: stored.mimeType });
      } catch (err) {
        console.error(`[mail/inbound] attachment save failed (${att.filename}):`, err instanceof Error ? err.message : err);
      }
    } else {
      console.warn(`[mail/inbound] attachment too large for inline delivery, skipped local serve: ${att.filename} (${att.size} bytes)`);
    }
  }

  const record: Mail = {
    id: randomUUID(),
    mailboxId: box?.id ?? boxes[0]?.id ?? mailboxAddress,
    folder: "inbox",
    from: { email: mail.from, name: raw.fromName },
    to: mail.to.map((e) => ({ email: e })),
    cc: mail.cc?.map((e) => ({ email: e })),
    subject: mail.subject,
    body: bodyText ?? bodyHtml ?? "",
    bodyType: !bodyText && bodyHtml ? "html" : "text",
    read: false,
    starred: false,
    date: mail.receivedAt,
    createdAt: new Date().toISOString(),
    ...(attachments.length ? { attachments } : {}),
  };
  const saved = await insertMail(record);
  return { id: saved.id };
};

// ── 호스트 알림 (fire-and-forget) ─────────────────────────────────────────────

function gatewayToken(): string {
  if (process.env.MYCREW_AI_GATEWAY_TOKEN) return process.env.MYCREW_AI_GATEWAY_TOKEN;
  try {
    // 앱 cwd = apps/mail — 호스트 리포의 게이트웨이 토큰 파일 폴백
    return readFileSync(resolve(process.cwd(), "../../history/.ai-gateway-token"), "utf-8").trim();
  } catch {
    return "";
  }
}

async function notifyHostInbound(subject: string, from: string): Promise<void> {
  try {
    const base = process.env.MYCREW_API_URL || "http://127.0.0.1:3457";
    await fetch(`${base}/api/notifications/app-inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${gatewayToken()}`,
      },
      body: JSON.stringify({
        appId: "mail",
        title: "📩 새 메일 수신",
        body: `${from} — ${subject}`.slice(0, 200),
        route: "/api/apps/mail/proxy",
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // 알림 실패는 수신 저장에 영향 주지 않음
    console.warn("[mail/inbound] host notify failed:", err instanceof Error ? err.message : err);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: InboundMailPayload;
  try {
    payload = (await req.json()) as InboundMailPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.messageId || !payload.from || !payload.to?.length) {
    return NextResponse.json({ error: "Missing required fields: messageId, from, to" }, { status: 400 });
  }

  // The "to" field contains our mailbox address(es) from the CF worker.
  // Use the first one as the primary mailbox target.
  const mailboxAddress = payload.to[0];

  try {
    const result = await saveInboundMail(mailboxAddress, payload);
    void notifyHostInbound(payload.subject ?? "(no subject)", payload.from);
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mail/inbound] saveInboundMail error:", msg);
    return NextResponse.json({ error: "Failed to save inbound mail", detail: msg }, { status: 500 });
  }
}

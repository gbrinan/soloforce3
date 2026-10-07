/**
 * Cloudflare Email Worker — inbound mail handler.
 *
 * Flow:
 *   1. Receive raw email via the CF Email Routing "email" handler.
 *   2. Parse with PostalMime (headers, text, html, attachments).
 *   3. Upload each attachment binary to R2.
 *   4. POST the structured InboundMailPayload to INBOUND_WEBHOOK_URL
 *      (your Next.js /api/mail/inbound endpoint) authenticated with
 *      INBOUND_WEBHOOK_SECRET.
 *
 * Required bindings (see wrangler.toml):
 *   - ATTACHMENTS_BUCKET  (R2)
 *   - INBOUND_WEBHOOK_URL (plain var) — e.g. https://mycrew.example.com/api/mail/inbound
 *   - INBOUND_WEBHOOK_SECRET (secret) — shared with Next.js for HMAC verification
 */

import PostalMime from "postal-mime";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Env {
  ATTACHMENTS_BUCKET: R2Bucket;
  INBOUND_WEBHOOK_URL: string;
  INBOUND_WEBHOOK_SECRET: string;
  // 검증된 Email Routing 목적지 주소 — 설정 시 원본 메일을 그대로 포워딩(기존 Gmail 수신 유지)
  FORWARD_ADDRESS?: string;
}

interface InboundAttachment {
  filename: string;
  contentType: string;
  size: number;
  r2Key?: string;
  // 소형 첨부는 base64로 인라인 전송 → 앱이 로컬에 저장해 바로 서빙(R2 접근 불필요).
  contentBase64?: string;
}

// 웹훅 payload에 인라인으로 실어 보내는 첨부 최대 크기(바이트). 초과분은 R2에만 저장.
const INLINE_ATTACHMENT_MAX = 8 * 1024 * 1024;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface InboundMailPayload {
  messageId: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  text?: string;
  html?: string;
  receivedAt: string;
  attachments: InboundAttachment[];
  headers?: Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toAddressList(
  addr: Array<{ address?: string }> | undefined,
): string[] {
  if (!addr) return [];
  return addr.map((a) => a.address ?? "").filter(Boolean);
}

async function uploadAttachmentToR2(
  bucket: R2Bucket,
  messageId: string,
  filename: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `attachments/${messageId}/${Date.now()}-${safe}`;
  await bucket.put(key, content, {
    httpMetadata: { contentType },
    customMetadata: { originalFilename: filename },
  });
  return key;
}

async function streamToArrayBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Validate required bindings at runtime
    if (!env.INBOUND_WEBHOOK_URL || !env.INBOUND_WEBHOOK_SECRET) {
      console.error(
        "[mail-worker] Missing INBOUND_WEBHOOK_URL or INBOUND_WEBHOOK_SECRET — dropping message",
      );
      // Reject so CF marks delivery as failed (sender receives bounce)
      message.setReject("Internal configuration error");
      return;
    }

    // 1. Read raw email stream into a buffer
    let rawBuffer: ArrayBuffer;
    try {
      rawBuffer = await streamToArrayBuffer(message.raw);
    } catch (err) {
      console.error("[mail-worker] Failed to read raw message:", err);
      message.setReject("Failed to read message");
      return;
    }

    // 2. Parse with PostalMime
    const parser = new PostalMime();
    const parsed = await parser.parse(rawBuffer);

    const messageId =
      (parsed.messageId ?? `${Date.now()}-${message.to}`).replace(/[<>]/g, "");

    // 3. Upload attachments to R2
    const attachmentResults: InboundAttachment[] = [];
    for (const att of parsed.attachments ?? []) {
      const filename = att.filename ?? `attachment-${attachmentResults.length + 1}`;
      const contentType = att.mimeType ?? "application/octet-stream";
      let r2Key: string | undefined;

      const buf: ArrayBuffer | undefined =
        att.content instanceof ArrayBuffer
          ? att.content
          : att.content instanceof Uint8Array
            ? (att.content.buffer as ArrayBuffer)
            : undefined;
      const size = buf ? buf.byteLength : 0;

      if (env.ATTACHMENTS_BUCKET && buf) {
        try {
          r2Key = await uploadAttachmentToR2(env.ATTACHMENTS_BUCKET, messageId, filename, buf, contentType);
        } catch (err) {
          console.warn(`[mail-worker] R2 upload failed for ${filename}:`, err);
        }
      }

      // 소형 첨부는 base64로 인라인 전송 → 앱이 로컬 저장해 즉시 서빙.
      const contentBase64 = buf && size > 0 && size <= INLINE_ATTACHMENT_MAX ? arrayBufferToBase64(buf) : undefined;

      attachmentResults.push({ filename, contentType, size, r2Key, contentBase64 });
    }

    // 4. Build payload
    const fromAddr = parsed.from?.address ?? message.from;
    const fromName = parsed.from?.name;

    // Collect relevant headers for downstream filtering/spam scoring
    const relevantHeaders: Record<string, string> = {};
    for (const h of parsed.headers ?? []) {
      const lower = h.key.toLowerCase();
      if (
        [
          "dkim-signature",
          "x-spam-status",
          "x-spam-score",
          "authentication-results",
          "received-spf",
          "x-mailer",
        ].includes(lower)
      ) {
        relevantHeaders[lower] = h.value;
      }
    }

    const payload: InboundMailPayload = {
      messageId,
      from: fromAddr,
      fromName: fromName || undefined,
      to: toAddressList(parsed.to),
      cc: toAddressList(parsed.cc),
      subject: parsed.subject ?? "(no subject)",
      text: parsed.text,
      html: parsed.html,
      receivedAt: new Date().toISOString(),
      attachments: attachmentResults,
      headers: Object.keys(relevantHeaders).length > 0 ? relevantHeaders : undefined,
    };

    // 5. POST to Next.js webhook
    try {
      const body = JSON.stringify(payload);
      const resp = await fetch(env.INBOUND_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Simple shared-secret auth — Next.js verifies this header
          "X-Mail-Worker-Secret": env.INBOUND_WEBHOOK_SECRET,
        },
        body,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error(
          `[mail-worker] Webhook POST failed: ${resp.status} ${resp.statusText} — ${text}`,
        );
        // Do not reject — the email was received, just the webhook notification failed.
        // Ops should investigate INBOUND_WEBHOOK_URL / Next.js logs.
      } else {
        console.log(
          `[mail-worker] Delivered ${messageId} to webhook (${resp.status})`,
        );
      }
    } catch (err) {
      console.error("[mail-worker] Webhook POST error:", err);
    }

    // 6. Gmail 포워딩 유지 — 웹훅 성공/실패와 무관하게 원본을 그대로 전달.
    // FORWARD_ADDRESS는 Email Routing에 등록·검증된 목적지여야 한다(미검증 시 forward가 throw).
    if (env.FORWARD_ADDRESS) {
      try {
        await message.forward(env.FORWARD_ADDRESS);
        console.log(`[mail-worker] Forwarded ${messageId} to ${env.FORWARD_ADDRESS}`);
      } catch (err) {
        console.error("[mail-worker] Forward failed:", err);
      }
    }
  },
};

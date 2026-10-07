import { Resend } from "resend";

// Inbound email payload from Cloudflare Email Worker webhook
export interface InboundMailPayload {
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  // CF 워커 payload 스키마: filename/contentType + 소형은 contentBase64 인라인, 대형은 r2Key.
  attachments?: { filename: string; contentType: string; size: number; r2Key?: string; contentBase64?: string }[];
  receivedAt: string;
}

export type SaveInboundMailFn = (
  mailboxAddress: string,
  mail: InboundMailPayload,
) => Promise<{ id: string }>;

export interface SendMailParams {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  body: string;
  bodyType: "text" | "html";
  attachments?: { name: string; content: Buffer; mimeType: string }[];
}

export interface SendMailResult {
  messageId: string;
}

export async function sendMail(params: SendMailParams): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: params.from,
    to: params.to,
    ...(params.cc && { cc: params.cc }),
    ...(params.bcc && { bcc: params.bcc }),
    ...(params.replyTo && { replyTo: params.replyTo }),
    subject: params.subject,
    ...(params.bodyType === "html" ? { html: params.body } : { text: params.body }),
    ...(params.attachments?.length
      ? { attachments: params.attachments.map((a) => ({ filename: a.name, content: a.content })) }
      : {}),
  });

  if (error || !data) throw new Error(error?.message ?? "Resend returned no data");
  return { messageId: data.id };
}

// Incoming mails arrive via POST /api/mail/inbound from the CF Email Worker
export async function fetchInbox(_mailboxId: string): Promise<void> {
  throw new Error("fetchInbox: push-based — no polling needed");
}

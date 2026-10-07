/**
 * 웹훅 이벤트 발송 유틸리티
 * (Next.js App Router route 파일은 GET/POST 등 핸들러만 export 가능하므로,
 *  재사용 유틸은 이 모듈로 분리 — 빌드 타입에러 방지)
 */
import { prisma } from "@/lib/db";
import crypto from "crypto";

export const WEBHOOK_EVENT_TYPES = [
  "submission.created",
  "submission.completed",
  "submission.expired",
  "submission.archived",
  "submitter.sent",
  "submitter.opened",
  "submitter.signed",
  "submitter.declined",
  "template.created",
  "template.archived",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export async function dispatchWebhookEvent(
  accountId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>
) {
  const webhooks = await prisma.webhookUrl.findMany({
    where: {
      accountId,
      enabled: true,
      events: { has: eventType },
    },
  });

  const results = await Promise.allSettled(
    webhooks.map(async (webhook: { id: string; url: string; secret: string | null }) => {
      const body = JSON.stringify({
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload,
      });

      // HMAC 서명 생성
      const signature = webhook.secret
        ? crypto
            .createHmac("sha256", webhook.secret)
            .update(body)
            .digest("hex")
        : undefined;

      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature && { "X-Webhook-Signature": `sha256=${signature}` }),
          "X-Webhook-Event": eventType,
        },
        body,
        signal: AbortSignal.timeout(10000), // 10초 타임아웃
      });

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status}`);
      }

      return { webhookId: webhook.id, status: response.status };
    })
  );

  return results;
}

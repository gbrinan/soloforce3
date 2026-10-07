/**
 * Notifications API
 * GET  /api/notifications - 알림 목록 (영속 모델 없어 빈 목록 — MyCrew 헬스 폴링용)
 * POST /api/notifications - 알림 발송 (이메일 또는 카카오 알림톡)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";
import { sendSigningRequestEmail, sendSigningReminderEmail } from "@/lib/email";

/**
 * GET /api/notifications — 알림 목록 조회. Notification 영속 모델이 없어 항상 빈 목록.
 * MyCrew 쉘이 앱 진입 전 healthPath(/api/notifications)를 `res.ok`(2xx)로 폴링하므로 반드시 200이어야 한다.
 * requireAuth(next-auth 세션)는 mycrew SSO 사용자에겐 MySign 세션이 없어 401 → 폴러 실패하므로 적용하지 않는다.
 * (호스트 인증 게이트가 이미 mycrew 세션을 요구하고, 응답 본문은 빈 목록으로 비민감.)
 */
export async function GET() {
  return NextResponse.json({ notifications: [] });
}

const SendNotificationSchema = z.object({
  type: z.enum(["signing_request", "signing_reminder", "signing_complete"]),
  channel: z.enum(["email", "kakao", "sms"]),
  recipient: z.object({
    name: z.string(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }),
  data: z.object({
    senderName: z.string(),
    documentName: z.string(),
    signingUrl: z.string().url().optional(),
    downloadUrl: z.string().url().optional(),
    expiresAt: z.string().optional(),
    message: z.string().optional(),
  }),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const body = await request.json();
    const parsed = SendNotificationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { type, channel, recipient, data } = parsed.data;

    if (channel === "kakao") {
      // 카카오 알림톡 발송
      if (!recipient.phone) {
        return NextResponse.json(
          { error: "카카오 알림톡 발송에는 전화번호가 필요합니다" },
          { status: 400 }
        );
      }

      // 동적 import로 solapi 로드
      const { getAlimtalkClient } = await import(
        "@/lib/notifications/kakao-alimtalk"
      );
      const client = getAlimtalkClient();

      if (!client) {
        return NextResponse.json(
          { error: "카카오 알림톡이 설정되지 않았습니다. 설정에서 SOLAPI 정보를 입력해주세요." },
          { status: 503 }
        );
      }

      switch (type) {
        case "signing_request":
          await client.sendSigningRequest(
            recipient.phone,
            recipient.name,
            data.documentName,
            data.signingUrl || ""
          );
          break;
        case "signing_reminder":
          await client.sendSigningReminder(
            recipient.phone,
            recipient.name,
            data.documentName,
            data.signingUrl || ""
          );
          break;
        case "signing_complete":
          await client.sendSigningComplete(
            recipient.phone,
            recipient.name,
            data.documentName
          );
          break;
      }

      return NextResponse.json({
        success: true,
        channel: "kakao",
        message: "카카오 알림톡이 발송되었습니다",
      });
    } else {
      // 이메일 발송
      if (!recipient.email) {
        return NextResponse.json(
          { error: "이메일 발송에는 이메일 주소가 필요합니다" },
          { status: 400 }
        );
      }

      let result;
      switch (type) {
        case "signing_request":
          result = await sendSigningRequestEmail({
            to: recipient.email,
            signerName: recipient.name,
            senderName: data.senderName,
            documentName: data.documentName,
            signingUrl: data.signingUrl || "",
            expiresAt: data.expiresAt,
            message: data.message,
          });
          break;
        case "signing_reminder":
          result = await sendSigningReminderEmail({
            to: recipient.email,
            signerName: recipient.name,
            senderName: data.senderName,
            documentName: data.documentName,
            signingUrl: data.signingUrl || "",
            expiresAt: data.expiresAt,
          });
          break;
        default:
          return NextResponse.json(
            { error: "지원하지 않는 알림 유형입니다" },
            { status: 400 }
          );
      }

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "이메일 발송 실패" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        channel: "email",
        message: "이메일이 발송되었습니다",
        id: result.id,
      });
    }
  } catch (error) {
    console.error("알림 발송 실패:", error);
    return NextResponse.json(
      { error: "알림 발송에 실패했습니다" },
      { status: 500 }
    );
  }
}

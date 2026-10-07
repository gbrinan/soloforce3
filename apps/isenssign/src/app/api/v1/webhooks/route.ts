/**
 * Webhooks API
 * GET  /api/v1/webhooks - 웹훅 URL 목록
 * POST /api/v1/webhooks - 웹훅 URL 등록
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { z } from "zod";
import crypto from "crypto";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhook-dispatch";

const CreateWebhookSchema = z.object({
  url: z.string().url("올바른 URL을 입력해주세요"),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, "최소 1개의 이벤트를 선택해주세요"),
  secret: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const webhooks = await prisma.webhookUrl.findMany({
      where: { accountId: session.user.accountId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: webhooks });
  } catch (error) {
    console.error("웹훅 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "웹훅 목록을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    const body = await request.json();
    const parsed = CreateWebhookSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const webhook = await prisma.webhookUrl.create({
      data: {
        url: parsed.data.url,
        events: parsed.data.events,
        secret: parsed.data.secret || crypto.randomBytes(32).toString("hex"),
        accountId: session.user.accountId,
      },
    });

    return NextResponse.json({ data: webhook }, { status: 201 });
  } catch (error) {
    console.error("웹훅 생성 실패:", error);
    return NextResponse.json(
      { error: "웹훅을 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

// dispatchWebhookEvent 유틸은 @/lib/webhook-dispatch 로 분리됨
// (route 파일은 GET/POST 등 핸들러만 export 가능 — Next.js App Router 규칙)

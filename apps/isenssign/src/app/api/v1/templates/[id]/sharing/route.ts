/**
 * Template Sharing API
 * GET  /api/v1/templates/:id/sharing - 공유 링크 조회 (없으면 생성)
 * POST /api/v1/templates/:id/sharing - 공유 링크 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;
    const { id: templateId } = await context.params;

    // 템플릿 소유권 확인
    const template = await prisma.template.findFirst({
      where: { id: templateId, accountId },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // 기존 공유 링크 조회
    const existing = await prisma.templateSharing.findFirst({
      where: { templateId },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return NextResponse.json({ data: existing });
    }

    // 없으면 새로 생성
    const sharing = await prisma.templateSharing.create({
      data: {
        slug: generateSlug(),
        templateId,
      },
    });

    return NextResponse.json({ data: sharing }, { status: 201 });
  } catch (error) {
    console.error("공유 링크 조회 실패:", error);
    return NextResponse.json(
      { error: "공유 링크를 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;
    const { id: templateId } = await context.params;

    // 템플릿 소유권 확인
    const template = await prisma.template.findFirst({
      where: { id: templateId, accountId },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // 기존 링크가 있으면 반환
    const existing = await prisma.templateSharing.findFirst({
      where: { templateId },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return NextResponse.json({ data: existing });
    }

    const sharing = await prisma.templateSharing.create({
      data: {
        slug: generateSlug(),
        templateId,
      },
    });

    return NextResponse.json({ data: sharing }, { status: 201 });
  } catch (error) {
    console.error("공유 링크 생성 실패:", error);
    return NextResponse.json(
      { error: "공유 링크를 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

/** 8자리 URL-safe slug 생성 */
function generateSlug(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

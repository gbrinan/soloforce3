/**
 * Dashboard Stats API
 * GET /api/v1/dashboard/stats - 대시보드 통계 조회
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalTemplates,
      pendingSignatures,
      completedSignatures,
      monthlySignatures,
    ] = await Promise.all([
      prisma.template.count({
        where: { accountId, archivedAt: null },
      }),
      prisma.submission.count({
        where: {
          accountId,
          status: { in: ["PENDING", "ACTIVE"] },
        },
      }),
      prisma.submission.count({
        where: {
          accountId,
          status: "COMPLETED",
        },
      }),
      prisma.submission.count({
        where: {
          accountId,
          createdAt: { gte: firstDayOfMonth },
        },
      }),
    ]);

    return NextResponse.json({
      totalTemplates,
      pendingSignatures,
      completedSignatures,
      monthlySignatures,
    });
  } catch (error) {
    console.error("대시보드 통계 조회 실패:", error);
    return NextResponse.json(
      { error: "대시보드 통계를 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

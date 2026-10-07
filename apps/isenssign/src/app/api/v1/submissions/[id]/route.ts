/**
 * Submission Detail API
 * GET /api/v1/submissions/:id - 단일 서명 요청 조회
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;

    const submission = await prisma.submission.findFirst({
      where: { id, accountId },
      include: {
        submitters: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            completedAt: true,
            verificationMethod: true,
            verifiedAt: true,
          },
        },
        template: { select: { id: true, name: true } },
        submissionEvents: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "서명 요청을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: submission });
  } catch (error) {
    console.error("서명 요청 조회 실패:", error);
    return NextResponse.json(
      { error: "서명 요청을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

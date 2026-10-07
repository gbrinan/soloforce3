/**
 * Bookings API
 * GET /api/v1/bookings - 예약 목록 조회
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status");
    const eventTypeId = searchParams.get("eventTypeId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const where: Record<string, unknown> = {
      accountId,
      ...(status && { status }),
      ...(eventTypeId && { eventTypeId }),
      ...((startDate || endDate) && {
        startTime: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      }),
    };

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          eventType: {
            select: { id: true, title: true, slug: true, duration: true },
          },
          user: { select: { id: true, firstName: true, email: true } },
          attendees: true,
        },
        orderBy: { startTime: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    return NextResponse.json({
      data: bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("예약 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "예약 목록을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

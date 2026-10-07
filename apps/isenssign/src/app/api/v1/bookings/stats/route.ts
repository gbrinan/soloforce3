/**
 * Booking Stats API
 * GET /api/v1/bookings/stats - 예약 통계 조회
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
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const todayEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    );
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalBookings,
      upcomingBookings,
      todayBookings,
      cancelledBookings,
      completedBookings,
      monthlyBookings,
    ] = await Promise.all([
      prisma.booking.count({
        where: { accountId },
      }),
      prisma.booking.count({
        where: {
          accountId,
          startTime: { gt: now },
          status: { in: ["PENDING", "ACCEPTED"] },
        },
      }),
      prisma.booking.count({
        where: {
          accountId,
          startTime: { gte: todayStart, lt: todayEnd },
          status: { in: ["PENDING", "ACCEPTED"] },
        },
      }),
      prisma.booking.count({
        where: {
          accountId,
          status: "CANCELLED",
        },
      }),
      prisma.booking.count({
        where: {
          accountId,
          endTime: { lt: now },
          status: "ACCEPTED",
        },
      }),
      prisma.booking.count({
        where: {
          accountId,
          startTime: { gte: firstDayOfMonth },
        },
      }),
    ]);

    return NextResponse.json({
      data: {
        totalBookings,
        upcomingBookings,
        todayBookings,
        cancelledBookings,
        completedBookings,
        monthlyBookings,
      },
    });
  } catch (error) {
    console.error("예약 통계 조회 실패:", error);
    return NextResponse.json(
      { error: "예약 통계를 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

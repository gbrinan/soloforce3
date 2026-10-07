/**
 * Public Booking API
 * POST /api/v1/bookings/public - 공개 예약 생성 (인증 불필요)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const CreatePublicBookingSchema = z.object({
  eventTypeId: z.string().min(1, "이벤트 유형 ID는 필수입니다"),
  startTime: z.string().datetime("올바른 ISO 날짜 형식이 필요합니다"),
  endTime: z.string().datetime("올바른 ISO 날짜 형식이 필요합니다"),
  attendee: z.object({
    name: z.string().min(1, "참석자 이름은 필수입니다"),
    email: z.string().email("올바른 이메일 형식이 필요합니다"),
    phone: z.string().optional(),
    timeZone: z.string().default("Asia/Seoul"),
    locale: z.string().default("ko"),
  }),
  responses: z.any().optional().default({}),
  location: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreatePublicBookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { eventTypeId, startTime, endTime, attendee, responses, location } =
      parsed.data;

    // 1. Fetch eventType with user and account
    const eventType = await prisma.eventType.findUnique({
      where: { id: eventTypeId },
      include: {
        user: true,
        account: true,
      },
    });

    if (!eventType) {
      return NextResponse.json(
        { error: "이벤트 유형을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // 2. Verify eventType is not archived or hidden
    if (eventType.archivedAt || eventType.hidden) {
      return NextResponse.json(
        { error: "현재 예약을 받지 않는 이벤트입니다" },
        { status: 400 }
      );
    }

    const bookingStart = new Date(startTime);
    const bookingEnd = new Date(endTime);
    const now = new Date();

    // 3. Check minimumNotice
    const minimumNoticeMs = eventType.minimumNotice * 60 * 1000;
    if (bookingStart.getTime() < now.getTime() + minimumNoticeMs) {
      return NextResponse.json(
        {
          error: `최소 ${eventType.minimumNotice}분 전에 예약해야 합니다`,
        },
        { status: 400 }
      );
    }

    // 4. Check for conflicts
    const conflict = await prisma.booking.findFirst({
      where: {
        userId: eventType.userId,
        status: { not: "CANCELLED" },
        startTime: { lt: bookingEnd },
        endTime: { gt: bookingStart },
      },
    });

    if (conflict) {
      return NextResponse.json(
        { error: "해당 시간에 이미 예약이 있습니다" },
        { status: 409 }
      );
    }

    // 5-6. Create booking + attendee in transaction
    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          title: `${eventType.title} with ${attendee.name}`,
          startTime: bookingStart,
          endTime: bookingEnd,
          status: eventType.requiresConfirmation ? "PENDING" : "ACCEPTED",
          location: location || null,
          responses: responses || {},
          accountId: eventType.accountId,
          eventTypeId: eventType.id,
          userId: eventType.userId,
        },
      });

      await tx.bookingAttendee.create({
        data: {
          name: attendee.name,
          email: attendee.email,
          phone: attendee.phone || null,
          timeZone: attendee.timeZone,
          locale: attendee.locale,
          bookingId: created.id,
        },
      });

      return tx.booking.findUnique({
        where: { id: created.id },
        include: { attendees: true },
      });
    });

    return NextResponse.json({ data: booking }, { status: 201 });
  } catch (error) {
    console.error("공개 예약 생성 실패:", error);
    return NextResponse.json(
      { error: "예약을 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

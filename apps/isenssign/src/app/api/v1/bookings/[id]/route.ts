/**
 * Booking Detail API
 * GET    /api/v1/bookings/:id - 단일 예약 조회
 * PATCH  /api/v1/bookings/:id - 예약 상태 변경
 * DELETE /api/v1/bookings/:id - 예약 삭제
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const UpdateBookingSchema = z.object({
  status: z.enum([
    "PENDING",
    "ACCEPTED",
    "CANCELLED",
    "REJECTED",
    "RESCHEDULED",
    "NO_SHOW",
  ]),
  cancellationReason: z.string().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;

    const booking = await prisma.booking.findFirst({
      where: { id, accountId },
      include: {
        eventType: {
          select: { id: true, title: true, slug: true, duration: true },
        },
        user: { select: { id: true, firstName: true, email: true } },
        attendees: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "예약을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: booking });
  } catch (error) {
    console.error("예약 조회 실패:", error);
    return NextResponse.json(
      { error: "예약을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateBookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findFirst({
      where: { id, accountId },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "예약을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.cancellationReason && {
          cancellationReason: parsed.data.cancellationReason,
        }),
      },
      include: {
        eventType: {
          select: { id: true, title: true, slug: true, duration: true },
        },
        user: { select: { id: true, firstName: true, email: true } },
        attendees: true,
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("예약 상태 변경 실패:", error);
    return NextResponse.json(
      { error: "예약 상태를 변경하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;

    const booking = await prisma.booking.findFirst({
      where: { id, accountId },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "예약을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    await prisma.booking.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("예약 삭제 실패:", error);
    return NextResponse.json(
      { error: "예약을 삭제하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

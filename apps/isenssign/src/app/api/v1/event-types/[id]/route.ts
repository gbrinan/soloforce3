/**
 * Event Type Detail API
 * GET    /api/v1/event-types/:id - 단일 이벤트 타입 조회
 * PUT    /api/v1/event-types/:id - 이벤트 타입 수정
 * DELETE /api/v1/event-types/:id - 이벤트 타입 삭제 (소프트 삭제)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

// 이벤트 타입 수정 스키마
const UpdateEventTypeSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  duration: z.number().int().positive().optional(),
  locations: z.any().optional(),
  color: z.string().optional(),
  hidden: z.boolean().optional(),
  requiresConfirmation: z.boolean().optional(),
  minimumNotice: z.number().int().min(0).optional(),
  bufferBefore: z.number().int().min(0).optional(),
  bufferAfter: z.number().int().min(0).optional(),
  slotInterval: z.number().int().positive().optional(),
  bookingLimits: z.any().optional(),
  bookingFields: z.any().optional(),
  scheduleId: z.string().optional(),
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

    const eventType = await prisma.eventType.findFirst({
      where: { id, accountId },
      include: {
        user: { select: { id: true, firstName: true, email: true } },
        _count: { select: { bookings: true } },
        schedule: { select: { id: true, name: true } },
      },
    });

    if (!eventType) {
      return NextResponse.json(
        { error: "이벤트 타입을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: eventType });
  } catch (error) {
    console.error("이벤트 타입 조회 실패:", error);
    return NextResponse.json(
      { error: "이벤트 타입을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;
    const body = await request.json();

    const parsed = UpdateEventTypeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const eventType = await prisma.eventType.findFirst({
      where: { id, accountId },
    });

    if (!eventType) {
      return NextResponse.json(
        { error: "이벤트 타입을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const updated = await prisma.eventType.update({
      where: { id },
      data: {
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.slug !== undefined && { slug: parsed.data.slug }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.duration !== undefined && { duration: parsed.data.duration }),
        ...(parsed.data.locations !== undefined && { locations: parsed.data.locations }),
        ...(parsed.data.color !== undefined && { color: parsed.data.color }),
        ...(parsed.data.hidden !== undefined && { hidden: parsed.data.hidden }),
        ...(parsed.data.requiresConfirmation !== undefined && { requiresConfirmation: parsed.data.requiresConfirmation }),
        ...(parsed.data.minimumNotice !== undefined && { minimumNotice: parsed.data.minimumNotice }),
        ...(parsed.data.bufferBefore !== undefined && { bufferBefore: parsed.data.bufferBefore }),
        ...(parsed.data.bufferAfter !== undefined && { bufferAfter: parsed.data.bufferAfter }),
        ...(parsed.data.slotInterval !== undefined && { slotInterval: parsed.data.slotInterval }),
        ...(parsed.data.bookingLimits !== undefined && { bookingLimits: parsed.data.bookingLimits }),
        ...(parsed.data.bookingFields !== undefined && { bookingFields: parsed.data.bookingFields }),
        ...(parsed.data.scheduleId !== undefined && { scheduleId: parsed.data.scheduleId }),
      },
      include: {
        user: { select: { id: true, firstName: true, email: true } },
        schedule: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("이벤트 타입 수정 실패:", error);
    return NextResponse.json(
      { error: "이벤트 타입을 수정하는데 실패했습니다" },
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

    const eventType = await prisma.eventType.findFirst({
      where: { id, accountId },
    });

    if (!eventType) {
      return NextResponse.json(
        { error: "이벤트 타입을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    await prisma.eventType.update({
      where: { id },
      data: { archivedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("이벤트 타입 삭제 실패:", error);
    return NextResponse.json(
      { error: "이벤트 타입을 삭제하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * Event Types API
 * GET  /api/v1/event-types - 이벤트 타입 목록 조회
 * POST /api/v1/event-types - 새 이벤트 타입 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

// 이벤트 타입 생성 스키마
const CreateEventTypeSchema = z.object({
  title: z.string().min(1, "이벤트 타입 제목은 필수입니다"),
  slug: z.string().min(1, "슬러그는 필수입니다"),
  description: z.string().optional(),
  duration: z.number().int().positive().optional().default(30),
  locations: z.any().optional().default([]),
  color: z.string().optional(),
  hidden: z.boolean().optional().default(false),
  requiresConfirmation: z.boolean().optional().default(false),
  minimumNotice: z.number().int().min(0).optional().default(60),
  bufferBefore: z.number().int().min(0).optional().default(0),
  bufferAfter: z.number().int().min(0).optional().default(0),
  slotInterval: z.number().int().positive().optional(),
  bookingLimits: z.any().optional(),
  bookingFields: z.any().optional().default([]),
  scheduleId: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const where: Record<string, unknown> = {
      accountId,
      archivedAt: null,
    };

    const [eventTypes, total] = await Promise.all([
      prisma.eventType.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, email: true } },
          _count: { select: { bookings: true } },
          schedule: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.eventType.count({ where }),
    ]);

    return NextResponse.json({
      data: eventTypes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("이벤트 타입 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "이벤트 타입 목록을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateEventTypeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { id: userId, accountId } = session.user;

    const eventType = await prisma.eventType.create({
      data: {
        title: parsed.data.title,
        slug: parsed.data.slug,
        description: parsed.data.description,
        duration: parsed.data.duration,
        locations: parsed.data.locations,
        color: parsed.data.color,
        hidden: parsed.data.hidden,
        requiresConfirmation: parsed.data.requiresConfirmation,
        minimumNotice: parsed.data.minimumNotice,
        bufferBefore: parsed.data.bufferBefore,
        bufferAfter: parsed.data.bufferAfter,
        slotInterval: parsed.data.slotInterval,
        bookingLimits: parsed.data.bookingLimits,
        bookingFields: parsed.data.bookingFields,
        scheduleId: parsed.data.scheduleId,
        userId,
        accountId,
      },
      include: {
        user: { select: { id: true, firstName: true, email: true } },
        schedule: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: eventType }, { status: 201 });
  } catch (error) {
    console.error("이벤트 타입 생성 실패:", error);
    return NextResponse.json(
      { error: "이벤트 타입을 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * Schedules API
 * GET  /api/v1/schedules - 스케줄 목록 조회
 * POST /api/v1/schedules - 새 스케줄 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const AvailabilitySchema = z.object({
  days: z.array(z.number().min(0).max(6)),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM 형식이어야 합니다"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM 형식이어야 합니다"),
});

const CreateScheduleSchema = z.object({
  name: z.string().min(1, "스케줄 이름은 필수입니다"),
  timeZone: z.string().default("Asia/Seoul"),
  isDefault: z.boolean().default(false),
  availabilities: z.array(AvailabilitySchema).optional(),
});

export async function GET(_request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const schedules = await prisma.schedule.findMany({
      where: { accountId },
      include: {
        availabilities: true,
        _count: { select: { eventTypes: true } },
        user: { select: { id: true, firstName: true, email: true } },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ data: schedules });
  } catch (error) {
    console.error("스케줄 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "스케줄 목록을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { id: userId, accountId } = session.user;

    const { name, timeZone, isDefault, availabilities } = parsed.data;

    const schedule = await prisma.$transaction(async (tx) => {
      // 기본 스케줄로 설정 시 기존 기본 스케줄 해제
      if (isDefault) {
        await tx.schedule.updateMany({
          where: { userId, accountId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.schedule.create({
        data: {
          name,
          timeZone,
          isDefault,
          accountId,
          userId,
          ...(availabilities && availabilities.length > 0 && {
            availabilities: {
              create: availabilities.map((a) => ({
                days: a.days,
                startTime: a.startTime,
                endTime: a.endTime,
              })),
            },
          }),
        },
        include: {
          availabilities: true,
          _count: { select: { eventTypes: true } },
          user: { select: { id: true, firstName: true, email: true } },
        },
      });
    });

    return NextResponse.json({ data: schedule }, { status: 201 });
  } catch (error) {
    console.error("스케줄 생성 실패:", error);
    return NextResponse.json(
      { error: "스케줄을 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

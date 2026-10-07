/**
 * Schedule Detail API
 * GET    /api/v1/schedules/:id - 단일 스케줄 조회
 * PUT    /api/v1/schedules/:id - 스케줄 수정
 * DELETE /api/v1/schedules/:id - 스케줄 삭제
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

const UpdateScheduleSchema = z.object({
  name: z.string().min(1, "스케줄 이름은 필수입니다").optional(),
  timeZone: z.string().optional(),
  isDefault: z.boolean().optional(),
  availabilities: z.array(AvailabilitySchema).optional(),
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

    const schedule = await prisma.schedule.findFirst({
      where: { id, accountId },
      include: {
        availabilities: true,
        _count: { select: { eventTypes: true } },
        user: { select: { id: true, firstName: true, email: true } },
      },
    });

    if (!schedule) {
      return NextResponse.json(
        { error: "스케줄을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: schedule });
  } catch (error) {
    console.error("스케줄 조회 실패:", error);
    return NextResponse.json(
      { error: "스케줄을 불러오는데 실패했습니다" },
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
    const parsed = UpdateScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.schedule.findFirst({
      where: { id, accountId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "스케줄을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const { name, timeZone, isDefault, availabilities } = parsed.data;

    const schedule = await prisma.$transaction(async (tx) => {
      // 기본 스케줄로 변경 시 기존 기본 스케줄 해제
      if (isDefault === true) {
        await tx.schedule.updateMany({
          where: { userId: existing.userId, accountId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      // 기존 availabilities 삭제 후 새로 생성
      if (availabilities !== undefined) {
        await tx.availability.deleteMany({
          where: { scheduleId: id },
        });
      }

      return tx.schedule.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(timeZone !== undefined && { timeZone }),
          ...(isDefault !== undefined && { isDefault }),
          ...(availabilities !== undefined && {
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

    return NextResponse.json({ data: schedule });
  } catch (error) {
    console.error("스케줄 수정 실패:", error);
    return NextResponse.json(
      { error: "스케줄을 수정하는데 실패했습니다" },
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

    const schedule = await prisma.schedule.findFirst({
      where: { id, accountId },
    });

    if (!schedule) {
      return NextResponse.json(
        { error: "스케줄을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // 유일한 기본 스케줄은 삭제 불가
    if (schedule.isDefault) {
      const defaultCount = await prisma.schedule.count({
        where: { userId: schedule.userId, accountId, isDefault: true },
      });

      if (defaultCount <= 1) {
        return NextResponse.json(
          { error: "기본 스케줄은 삭제할 수 없습니다. 다른 스케줄을 기본으로 설정한 후 삭제해주세요." },
          { status: 400 }
        );
      }
    }

    await prisma.schedule.delete({ where: { id } });

    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("스케줄 삭제 실패:", error);
    return NextResponse.json(
      { error: "스케줄을 삭제하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

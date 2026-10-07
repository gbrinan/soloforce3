/**
 * Availability API
 * GET /api/v1/availability - 예약 가능 슬롯 계산
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * "HH:MM" 형식의 시간 문자열을 분(minutes)으로 변환
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 분(minutes)을 "HH:MM" 형식으로 변환
 */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * 주어진 날짜 범위의 각 날을 순회하며 날짜 배열 생성
 */
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

interface AvailabilityRecord {
  days: number[];
  startTime: string;
  endTime: string;
  date: Date | null;
}

interface Slot {
  startTime: string;
  endTime: string;
}

/**
 * 특정 날짜에 해당하는 availability 레코드 필터링
 * - date가 지정된 경우: 해당 날짜와 일치하는지 확인 (specific date override)
 * - date가 null인 경우: 요일(day-of-week) 기반으로 확인
 */
function getAvailabilitiesForDate(
  availabilities: AvailabilityRecord[],
  dateStr: string
): AvailabilityRecord[] {
  const date = new Date(dateStr + "T00:00:00");
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // specific date override가 있으면 우선 적용
  const dateOverrides = availabilities.filter((a) => {
    if (!a.date) return false;
    return a.date.toISOString().split("T")[0] === dateStr;
  });

  if (dateOverrides.length > 0) {
    return dateOverrides;
  }

  // 요일 기반 recurring availability
  return availabilities.filter(
    (a) => a.date === null && a.days.includes(dayOfWeek)
  );
}

/**
 * availability 시간 범위 내에서 슬롯 생성
 */
function generateSlots(
  availability: AvailabilityRecord,
  duration: number,
  slotInterval: number,
  bufferBefore: number,
  bufferAfter: number
): Slot[] {
  const slots: Slot[] = [];
  const startMinutes = timeToMinutes(availability.startTime);
  const endMinutes = timeToMinutes(availability.endTime);

  let cursor = startMinutes;

  while (cursor + duration <= endMinutes) {
    const slotStart = cursor;
    const slotEnd = cursor + duration;

    slots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
    });

    cursor += slotInterval;
  }

  return slots;
}

/**
 * 기존 예약과 충돌하는 슬롯 제거
 * bufferBefore/bufferAfter를 적용하여 충돌 범위를 확장
 */
function removeConflictingSlots(
  slots: Slot[],
  bookings: { startTime: Date; endTime: Date }[],
  dateStr: string,
  bufferBefore: number,
  bufferAfter: number
): Slot[] {
  if (bookings.length === 0) return slots;

  return slots.filter((slot) => {
    const slotStartMs = new Date(`${dateStr}T${slot.startTime}:00`).getTime();
    const slotEndMs = new Date(`${dateStr}T${slot.endTime}:00`).getTime();

    // buffer 적용: 슬롯 시작 전 bufferBefore, 슬롯 종료 후 bufferAfter
    const bufferedStart = slotStartMs - bufferBefore * 60 * 1000;
    const bufferedEnd = slotEndMs + bufferAfter * 60 * 1000;

    return !bookings.some((booking) => {
      const bookingStart = booking.startTime.getTime();
      const bookingEnd = booking.endTime.getTime();

      // 겹침 판정: buffered 슬롯과 예약이 겹치는지 확인
      return bufferedStart < bookingEnd && bufferedEnd > bookingStart;
    });
  });
}

/**
 * 현재 시각 + minimumNotice 이전의 슬롯 제거
 */
function removePastSlots(
  slots: Slot[],
  dateStr: string,
  minimumNoticeMinutes: number
): Slot[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + minimumNoticeMinutes * 60 * 1000);

  return slots.filter((slot) => {
    const slotStart = new Date(`${dateStr}T${slot.startTime}:00`);
    return slotStart > cutoff;
  });
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const eventTypeId = searchParams.get("eventTypeId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const _timeZone = searchParams.get("timeZone") || "Asia/Seoul";

    if (!eventTypeId) {
      return NextResponse.json(
        { error: "eventTypeId는 필수입니다" },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate와 endDate는 필수입니다" },
        { status: 400 }
      );
    }

    // 1. EventType 조회 (schedule 포함)
    const eventType = await prisma.eventType.findUnique({
      where: { id: eventTypeId },
      include: {
        schedule: {
          include: { availabilities: true },
        },
      },
    });

    if (!eventType) {
      return NextResponse.json(
        { error: "이벤트 유형을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // 2. schedule이 없으면 사용자의 기본 스케줄 사용
    let availabilities: AvailabilityRecord[] = [];

    if (eventType.schedule) {
      availabilities = eventType.schedule.availabilities;
    } else {
      const defaultSchedule = await prisma.schedule.findFirst({
        where: { userId: eventType.userId, isDefault: true },
        include: { availabilities: true },
      });

      if (defaultSchedule) {
        availabilities = defaultSchedule.availabilities;
      }
    }

    if (availabilities.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const {
      duration,
      slotInterval,
      bufferBefore,
      bufferAfter,
      minimumNotice,
    } = eventType;
    const interval = slotInterval || duration;

    // 3. 날짜 범위 내 기존 예약 조회 (취소 제외)
    const rangeStart = new Date(startDate + "T00:00:00");
    const rangeEnd = new Date(endDate + "T23:59:59");

    const existingBookings = await prisma.booking.findMany({
      where: {
        eventTypeId,
        status: { not: "CANCELLED" },
        startTime: { lte: rangeEnd },
        endTime: { gte: rangeStart },
      },
      select: { startTime: true, endTime: true },
    });

    // 4. 각 날짜별 슬롯 생성
    const dates = getDateRange(startDate, endDate);
    const result: { date: string; slots: Slot[] }[] = [];

    for (const dateStr of dates) {
      const dayAvailabilities = getAvailabilitiesForDate(
        availabilities,
        dateStr
      );

      if (dayAvailabilities.length === 0) continue;

      // 모든 availability 범위에서 슬롯 생성
      let daySlots: Slot[] = [];
      for (const avail of dayAvailabilities) {
        const slots = generateSlots(
          avail,
          duration,
          interval,
          bufferBefore,
          bufferAfter
        );
        daySlots.push(...slots);
      }

      // 중복 제거 (여러 availability가 겹칠 수 있음)
      const seen = new Set<string>();
      daySlots = daySlots.filter((slot) => {
        const key = `${slot.startTime}-${slot.endTime}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // 기존 예약과 충돌하는 슬롯 제거
      daySlots = removeConflictingSlots(
        daySlots,
        existingBookings,
        dateStr,
        bufferBefore,
        bufferAfter
      );

      // 과거 + minimumNotice 이전 슬롯 제거
      daySlots = removePastSlots(daySlots, dateStr, minimumNotice);

      // 시간순 정렬
      daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime));

      if (daySlots.length > 0) {
        result.push({ date: dateStr, slots: daySlots });
      }
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("가용 슬롯 조회 실패:", error);
    return NextResponse.json(
      { error: "가용 슬롯을 계산하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

import dayjs from "dayjs";

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface DayAvailability {
  enabled: boolean;
  ranges: [string, string][];
}

export interface WeeklyAvailability {
  mon: DayAvailability;
  tue: DayAvailability;
  wed: DayAvailability;
  thu: DayAvailability;
  fri: DayAvailability;
  sat: DayAvailability;
  sun: DayAvailability;
}

export interface BookingRecord {
  id: string;
  date: string;
  start: string;
  end: string;
  name: string;
  email: string;
  phone?: string;
  note?: string;
  createdAt: string;
}

export interface Slot {
  start: string;
  end: string;
  available: boolean;
}

const DAY_KEYS: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function fromMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

function isWeeklyAvailability(value: WeeklyAvailability | undefined): value is WeeklyAvailability {
  if (!value) return false;
  return DAY_KEYS.slice(1).concat("sun").every((key) => {
    const day = value[key];
    return typeof day?.enabled === "boolean" && Array.isArray(day.ranges);
  });
}

function overlaps(slotStart: number, slotEnd: number, booking: BookingRecord): boolean {
  const bookingStart = toMinutes(booking.start);
  const bookingEnd = toMinutes(booking.end);
  if (bookingStart === null || bookingEnd === null || bookingEnd <= bookingStart) return false;
  return slotStart < bookingEnd && slotEnd > bookingStart;
}

export function dayKeyFromDate(date: string): DayOfWeek {
  const day = dayjs(date);
  const index = day.isValid() ? day.day() : 0;
  return DAY_KEYS[index] ?? "sun";
}

export function generateSlots(input: {
  weeklyAvailability: WeeklyAvailability;
  date: string;
  durationMin: number;
  bufferMin?: number;
  bookings: BookingRecord[];
}): Slot[] {
  try {
    const { weeklyAvailability, date, durationMin, bookings } = input;
    const bufferMin = input.bufferMin ?? 0;

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !dayjs(date).isValid() ||
      !Number.isFinite(durationMin) ||
      durationMin <= 0 ||
      !Number.isFinite(bufferMin) ||
      bufferMin < 0 ||
      !Array.isArray(bookings) ||
      !isWeeklyAvailability(weeklyAvailability)
    ) {
      return [];
    }

    const dayAvailability = weeklyAvailability[dayKeyFromDate(date)];
    if (!dayAvailability.enabled) return [];

    const stride = durationMin + bufferMin;
    if (stride <= 0) return [];

    const dateBookings = bookings.filter((booking) => booking.date === date);
    const slots: Slot[] = [];

    for (const range of dayAvailability.ranges) {
      if (!Array.isArray(range) || range.length !== 2) continue;

      const rangeStart = toMinutes(range[0]);
      const rangeEnd = toMinutes(range[1]);
      if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) continue;

      for (let cursor = rangeStart; cursor + durationMin <= rangeEnd; cursor += stride) {
        const start = cursor;
        const end = cursor + durationMin;
        slots.push({
          start: fromMinutes(start),
          end: fromMinutes(end),
          available: !dateBookings.some((booking) => overlaps(start, end, booking)),
        });
      }
    }

    return slots;
  } catch {
    return [];
  }
}

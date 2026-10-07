import { NextRequest, NextResponse } from "next/server";
import { getAvailability } from "@/lib/availability-store";
import { listBookings } from "@/lib/bookings-store";

interface DayAvailability {
  enabled: boolean;
  ranges: [string, string][];
}

interface Availability {
  weeklyAvailability: Record<string, DayAvailability>;
  meetingDurationMin: number;
  bufferMin: number;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Parse "HH:mm" → total minutes from midnight
function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Total minutes → "HH:mm"
function fromMin(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const min = (m % 60).toString().padStart(2, "0");
  return `${h}:${min}`;
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date param YYYY-MM-DD required" }, { status: 400 });
  }

  const avail = (await getAvailability()) as Availability | null;
  if (!avail) {
    return NextResponse.json({ error: "availability not configured" }, { status: 503 });
  }

  const dayIndex = new Date(`${date}T00:00:00`).getDay(); // 0=Sun
  const dayKey = DAY_KEYS[dayIndex];
  const dayAvail = avail.weeklyAvailability[dayKey];

  if (!dayAvail?.enabled) {
    return NextResponse.json({ date, slots: [] });
  }

  const bookings = await listBookings();
  const bookedStarts = new Set(
    bookings.filter((b) => b.date === date).map((b) => b.start),
  );

  const step = avail.meetingDurationMin + avail.bufferMin;
  const slots: { start: string; end: string; available: boolean }[] = [];

  for (const [rangeStart, rangeEnd] of dayAvail.ranges) {
    let cur = toMin(rangeStart);
    const end = toMin(rangeEnd);
    while (cur + avail.meetingDurationMin <= end) {
      const startStr = fromMin(cur);
      const endStr = fromMin(cur + avail.meetingDurationMin);
      slots.push({ start: startStr, end: endStr, available: !bookedStarts.has(startStr) });
      cur += step;
    }
  }

  return NextResponse.json({ date, slots });
}

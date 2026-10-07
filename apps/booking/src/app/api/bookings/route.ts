import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sendEmail } from "@/lib/email";
import {
  bookingConfirmationGuest,
  bookingConfirmationHost,
} from "@/lib/email-templates";
import { listBookings, insertBooking, type Booking } from "@/lib/bookings-store";
import { findEventTypeById } from "@/lib/event-types";
import type { EventType } from "@/types/event-type";

export type { Booking } from "@/lib/bookings-store";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  const all = await listBookings();
  const result = date ? all.filter((b) => b.date === date) : all;
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  let body: Partial<Booking>;
  try {
    body = (await req.json()) as Partial<Booking>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const required: (keyof Booking)[] = ["date", "start", "end", "name", "email"];
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json({ error: `missing field: ${field}` }, { status: 400 });
    }
  }

  const bookings = await listBookings();

  // conflict check: same date + same start time
  const conflict = bookings.find((b) => b.date === body.date && b.start === body.start);
  if (conflict) {
    return NextResponse.json({ error: "slot already booked" }, { status: 409 });
  }

  // EventType lookup
  let eventType: EventType | undefined;
  if (body.eventTypeId) {
    eventType = await findEventTypeById(body.eventTypeId);
    if (eventType && !eventType.active) {
      return NextResponse.json({ error: "event type is not active" }, { status: 400 });
    }
  }

  const newBooking: Booking = {
    id: randomUUID(),
    date: body.date!,
    start: body.start!,
    end: body.end!,
    name: body.name!,
    email: body.email!,
    ...(body.phone ? { phone: body.phone } : {}),
    ...(body.note ? { note: body.note } : {}),
    ...(body.guestTimeZone ? { guestTimeZone: body.guestTimeZone } : {}),
    cancelToken: randomUUID(),
    createdAt: new Date().toISOString(),
    ...(eventType
      ? {
          eventTypeId: eventType.id,
          eventTypeSlug: eventType.slug,
          eventTypeTitle: eventType.title,
          durationMin: eventType.durationMin,
        }
      : {}),
  };

  await insertBooking(newBooking);

  // fire-and-forget emails
  const et = eventType ?? {
    title: newBooking.eventTypeTitle ?? "예약",
    durationMin: newBooking.durationMin ?? 30,
  };
  void sendEmail({
    to: newBooking.email,
    ...bookingConfirmationGuest(newBooking, et, newBooking.cancelToken),
  });
  const hostEmail = process.env.BOOKING_HOST_EMAIL;
  if (hostEmail) {
    void sendEmail({
      to: hostEmail,
      ...bookingConfirmationHost(newBooking, et),
    });
  }

  return NextResponse.json(newBooking, { status: 201 });
}

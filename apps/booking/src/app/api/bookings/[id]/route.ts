import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getBooking,
  updateBooking,
  deleteBooking,
  listBookings,
  type Booking,
} from "@/lib/bookings-store";
import { sendEmail } from "@/lib/email";
import { bookingCancellation, bookingReschedule } from "@/lib/email-templates";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(booking);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "not found" }, { status: 404 });

  await deleteBooking(id);

  // fire-and-forget cancellation emails
  void sendEmail({ to: booking.email, ...bookingCancellation(booking, false) });
  const hostEmail = process.env.BOOKING_HOST_EMAIL;
  if (hostEmail) {
    void sendEmail({ to: hostEmail, ...bookingCancellation(booking, true) });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  let body: Partial<Booking>;
  try {
    body = (await req.json()) as Partial<Booking>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const oldBooking = await getBooking(id);
  if (!oldBooking) return NextResponse.json({ error: "not found" }, { status: 404 });

  // conflict check: same date+start after patch, excluding self
  const newDate = body.date ?? oldBooking.date;
  const newStart = body.start ?? oldBooking.start;
  if (body.date || body.start) {
    const all = await listBookings();
    if (all.some((b) => b.id !== id && b.date === newDate && b.start === newStart)) {
      return NextResponse.json({ error: "slot already booked" }, { status: 409 });
    }
  }

  const updated: Booking = {
    ...oldBooking,
    ...body,
    id: oldBooking.id,
    createdAt: oldBooking.createdAt,
    cancelToken: oldBooking.cancelToken || randomUUID(),
  };
  await updateBooking(id, updated);

  // fire-and-forget reschedule email only when date or start time changes
  const dateOrTimeChanged =
    (body.date && body.date !== oldBooking.date) ||
    (body.start && body.start !== oldBooking.start);
  if (dateOrTimeChanged) {
    const et = {
      title: updated.eventTypeTitle ?? "예약",
      durationMin: updated.durationMin ?? 30,
    };
    void sendEmail({
      to: updated.email,
      ...bookingReschedule(oldBooking, updated, et, updated.cancelToken),
    });
    const hostEmail = process.env.BOOKING_HOST_EMAIL;
    if (hostEmail) {
      void sendEmail({
        to: hostEmail,
        ...bookingReschedule(oldBooking, updated, et, updated.cancelToken),
      });
    }
  }

  return NextResponse.json(updated);
}

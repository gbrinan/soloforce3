import { NextRequest, NextResponse } from "next/server";
import { getBooking } from "@/lib/bookings-store";
import { sendEmail } from "@/lib/email";
import { bookingConfirmationGuest } from "@/lib/email-templates";
import { findEventTypeById } from "@/lib/event-types";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!booking.cancelToken)
    return NextResponse.json({ error: "booking has no cancel token" }, { status: 400 });

  const et = booking.eventTypeId ? await findEventTypeById(booking.eventTypeId) : undefined;
  const etInfo = et ?? {
    title: booking.eventTypeTitle ?? "예약",
    durationMin: booking.durationMin ?? 30,
  };

  void sendEmail({
    to: booking.email,
    ...bookingConfirmationGuest(booking, etInfo, booking.cancelToken),
  });

  return NextResponse.json({ ok: true });
}

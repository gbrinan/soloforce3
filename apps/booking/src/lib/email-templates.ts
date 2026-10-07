interface BookingInfo {
  id: string;
  date: string;
  start: string;
  end: string;
  name: string;
  email: string;
  phone?: string;
  note?: string;
  cancelToken?: string;
  eventTypeTitle?: string;
  durationMin?: number;
  guestTimeZone?: string;
  hostTimeZone?: string;
}

function tzAbbr(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

function timeWithTz(time: string, tz?: string): string {
  return tz ? `${time} (${tzAbbr(tz)})` : time;
}

interface EventTypeInfo {
  title: string;
  durationMin: number;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  } catch {
    return dateStr;
  }
}

function cancelUrl(cancelToken: string): string {
  const origin = process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${origin}/cancel/${cancelToken}`;
}

function rescheduleUrl(cancelToken: string): string {
  const origin = process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${origin}/reschedule/${cancelToken}`;
}

export function bookingConfirmationGuest(
  booking: BookingInfo,
  eventType: EventTypeInfo,
  token: string
): { subject: string; html: string } {
  const subject = `[예약 확정] ${eventType.title} — ${formatDate(booking.date)} ${booking.start}`;
  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#04070F;padding:24px;">
  <h2 style="color:#4F46E5;">${booking.name}님, 예약이 확정되었습니다.</h2>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  <p style="margin:8px 0;">📅 <strong>${formatDate(booking.date)}</strong></p>
  <p style="margin:8px 0;">🕐 <strong>${timeWithTz(booking.start, booking.guestTimeZone ?? booking.hostTimeZone)} ~ ${timeWithTz(booking.end, booking.guestTimeZone ?? booking.hostTimeZone)}</strong> (${eventType.durationMin}분)</p>
  <p style="margin:8px 0;">📋 <strong>${eventType.title}</strong></p>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  <p style="margin:16px 0;">
    <a href="${cancelUrl(token)}" style="color:#4F46E5;">예약 취소</a>
    &nbsp;|&nbsp;
    <a href="${rescheduleUrl(token)}" style="color:#4F46E5;">일정 변경</a>
  </p>
  <p style="font-size:12px;color:#6E7278;">※ 이 이메일은 자동 발송됩니다.</p>
</div>`;
  return { subject, html };
}

export function bookingConfirmationHost(
  booking: BookingInfo,
  eventType: EventTypeInfo
): { subject: string; html: string } {
  const subject = `[새 예약] ${booking.name}님 — ${formatDate(booking.date)} ${booking.start}`;
  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#04070F;padding:24px;">
  <h2 style="color:#4F46E5;">새로운 예약이 들어왔습니다.</h2>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  <p style="margin:8px 0;">👤 예약자: <strong>${booking.name}</strong> (${booking.email})</p>
  <p style="margin:8px 0;">📋 유형: <strong>${eventType.title}</strong></p>
  <p style="margin:8px 0;">📅 일시: <strong>${formatDate(booking.date)} ${timeWithTz(booking.start, booking.hostTimeZone)} ~ ${timeWithTz(booking.end, booking.hostTimeZone)}</strong></p>
  <p style="margin:8px 0;">💬 메모: ${booking.note ?? "(없음)"}</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  <p style="font-size:12px;color:#6E7278;">예약 관리 화면에서 확인하세요.</p>
</div>`;
  return { subject, html };
}

export function bookingCancellation(
  booking: BookingInfo,
  isHost: boolean
): { subject: string; html: string } {
  const eventTitle = booking.eventTypeTitle ?? "예약";
  const subject = `[예약 취소] ${eventTitle} — ${formatDate(booking.date)} ${booking.start}`;
  const origin = process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const html = isHost
    ? `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#04070F;padding:24px;">
  <h2 style="color:#DC2626;">${booking.name}님의 예약이 취소되었습니다.</h2>
  <p style="margin:8px 0;">📅 ${formatDate(booking.date)} ${timeWithTz(booking.start, booking.hostTimeZone)} ~ ${timeWithTz(booking.end, booking.hostTimeZone)}</p>
  <p style="margin:8px 0;">취소 일시: ${new Date().toLocaleString("ko-KR")}</p>
</div>`
    : `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#04070F;padding:24px;">
  <h2 style="color:#DC2626;">${booking.name}님의 예약이 취소되었습니다.</h2>
  <p style="margin:8px 0;">📅 ${formatDate(booking.date)} ${timeWithTz(booking.start, booking.guestTimeZone ?? booking.hostTimeZone)} ~ ${timeWithTz(booking.end, booking.guestTimeZone ?? booking.hostTimeZone)}</p>
  <p style="margin:16px 0;">
    <a href="${origin}/book" style="color:#4F46E5;">다시 예약하기</a>
  </p>
</div>`;
  return { subject, html };
}

export function bookingReschedule(
  oldBooking: BookingInfo,
  newBooking: BookingInfo,
  eventType: EventTypeInfo,
  token: string
): { subject: string; html: string } {
  const subject = `[일정 변경] ${eventType.title} — 기존 ${formatDate(oldBooking.date)} → 신규 ${formatDate(newBooking.date)}`;
  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#04070F;padding:24px;">
  <h2 style="color:#4F46E5;">예약 일정이 변경되었습니다.</h2>
  <p style="margin:8px 0;">기존: <strong>${formatDate(oldBooking.date)} ${timeWithTz(oldBooking.start, oldBooking.hostTimeZone)} ~ ${timeWithTz(oldBooking.end, oldBooking.hostTimeZone)}</strong></p>
  <p style="margin:8px 0;">변경: <strong>${formatDate(newBooking.date)} ${timeWithTz(newBooking.start, newBooking.hostTimeZone)} ~ ${timeWithTz(newBooking.end, newBooking.hostTimeZone)}</strong></p>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">
  <p style="margin:16px 0;">
    <a href="${cancelUrl(token)}" style="color:#4F46E5;">예약 취소</a>
  </p>
</div>`;
  return { subject, html };
}

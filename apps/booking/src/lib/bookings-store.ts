import { sbSelect, sbInsert, sbUpdate, sbDelete } from "./supabase";

export interface Booking {
  id: string;
  date: string;
  start: string;
  end: string;
  name: string;
  email: string;
  phone?: string;
  note?: string;
  eventTypeId?: string;
  eventTypeSlug?: string;
  eventTypeTitle?: string;
  durationMin?: number;
  guestTimeZone?: string;
  cancelToken: string;
  createdAt: string;
}

interface Row {
  id: string;
  data: Booking;
}

const TABLE = "bookings";

export async function listBookings(): Promise<Booking[]> {
  const rows = await sbSelect<Row>(TABLE, "select=id,data");
  return rows
    .map((r) => r.data)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function getBooking(id: string): Promise<Booking | null> {
  const rows = await sbSelect<Row>(TABLE, `id=eq.${id}&select=id,data`);
  return rows[0]?.data ?? null;
}

export async function insertBooking(booking: Booking): Promise<Booking> {
  await sbInsert<Row>(TABLE, { id: booking.id, data: booking });
  return booking;
}

export async function updateBooking(id: string, booking: Booking): Promise<Booking> {
  await sbUpdate<Row>(TABLE, `id=eq.${id}`, { data: booking });
  return booking;
}

export async function deleteBooking(id: string): Promise<void> {
  await sbDelete(TABLE, `id=eq.${id}`);
}

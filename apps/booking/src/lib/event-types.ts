import { randomUUID } from "node:crypto";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "./supabase";
import type { EventType } from "@/types/event-type";

const TABLE = "booking_event_types";

interface Row {
  id: string;
  data: EventType;
}

export async function readEventTypes(): Promise<EventType[]> {
  const rows = await sbSelect<Row>(TABLE, "select=id,data");
  return rows
    .map((r) => r.data)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function findEventTypeById(id: string): Promise<EventType | undefined> {
  const rows = await sbSelect<Row>(TABLE, `id=eq.${id}&select=id,data`);
  return rows[0]?.data;
}

export async function findEventTypeBySlug(slug: string): Promise<EventType | undefined> {
  const all = await readEventTypes();
  return all.find((et) => et.slug === slug);
}

export async function createEventType(
  data: Omit<EventType, "id" | "createdAt" | "updatedAt">,
): Promise<EventType> {
  const now = new Date().toISOString();
  const newET: EventType = { id: randomUUID(), ...data, createdAt: now, updatedAt: now };
  await sbInsert<Row>(TABLE, { id: newET.id, data: newET });
  return newET;
}

export async function updateEventType(
  id: string,
  patch: Partial<EventType>,
): Promise<EventType | null> {
  const cur = await findEventTypeById(id);
  if (!cur) return null;
  const updated: EventType = {
    ...cur,
    ...patch,
    id: cur.id,
    createdAt: cur.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await sbUpdate<Row>(TABLE, `id=eq.${id}`, { data: updated });
  return updated;
}

export async function deleteEventType(id: string): Promise<boolean> {
  const cur = await findEventTypeById(id);
  if (!cur) return false;
  await sbDelete(TABLE, `id=eq.${id}`);
  return true;
}

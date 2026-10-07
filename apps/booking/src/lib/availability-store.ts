import { sbSelect, sbUpsert } from "./supabase";

const TABLE = "booking_availability";
const SINGLETON = "singleton";

interface Row {
  id: string;
  data: unknown;
}

export async function getAvailability(): Promise<unknown | null> {
  const rows = await sbSelect<Row>(TABLE, `id=eq.${SINGLETON}&select=id,data`);
  return rows[0]?.data ?? null;
}

export async function saveAvailability(data: unknown): Promise<void> {
  await sbUpsert<Row>(TABLE, { id: SINGLETON, data });
}

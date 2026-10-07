// Minimal PostgREST client (no SDK dependency) for the booking app.
// Server-side only — uses the service_role key, which bypasses RLS.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function restUrl(path: string): string {
  return `${SUPABASE_URL}/rest/v1/${path}`;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Supabase env not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function sbSelect<T>(table: string, query = ""): Promise<T[]> {
  const res = await fetch(restUrl(`${table}${query ? `?${query}` : ""}`), {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`select ${table} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

export async function sbInsert<T>(table: string, row: unknown): Promise<T> {
  const res = await fetch(restUrl(table), {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert ${table} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as T[])[0];
}

export async function sbUpdate<T>(table: string, query: string, patch: unknown): Promise<T[]> {
  const res = await fetch(restUrl(`${table}?${query}`), {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update ${table} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

export async function sbDelete(table: string, query: string): Promise<void> {
  const res = await fetch(restUrl(`${table}?${query}`), {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`delete ${table} failed: ${res.status} ${await res.text()}`);
}

export async function sbUpsert<T>(table: string, row: unknown): Promise<T> {
  const res = await fetch(restUrl(table), {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`upsert ${table} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as T[])[0];
}

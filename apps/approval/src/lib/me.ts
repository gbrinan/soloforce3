"use client";

export interface MeInfo {
  email: string;
  displayName?: string;
  name?: string;
  picture?: string;
}

export async function fetchMe(): Promise<MeInfo | null> {
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<MeInfo>;
  } catch {
    return null;
  }
}

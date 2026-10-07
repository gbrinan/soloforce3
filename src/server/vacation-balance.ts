// Vacation balance ledger — per-user, per-year allowed/used tracking.
// Persistence: append-only JSONL (latest-wins by userId per file).
// Single-process assumption: no distributed locking.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

const BALANCES_DIR = join(HISTORY_DIR, "approval-balances");

export interface VacationBalance {
  userId: string;
  year: number;
  totalAllowed: number;
  used: number;
  remaining: number;
  updatedAt: string;
}

// Cache: year → userId → balance
const cache = new Map<number, Map<string, VacationBalance>>();
const loadedYears = new Set<number>();

function ensureDir(): void {
  if (!existsSync(BALANCES_DIR)) mkdirSync(BALANCES_DIR, { recursive: true });
}

function balanceFile(year: number): string {
  return join(BALANCES_DIR, `balances-${year}.jsonl`);
}

function loadYear(year: number): void {
  if (loadedYears.has(year)) return;
  ensureDir();
  const yearCache = new Map<string, VacationBalance>();
  cache.set(year, yearCache);
  const file = balanceFile(year);
  if (existsSync(file)) {
    try {
      const content = readFileSync(file, "utf-8");
      for (const raw of content.split("\n")) {
        if (!raw.trim()) continue;
        try {
          const entry = JSON.parse(raw) as { op: string; balance: VacationBalance };
          if (entry.op === "upsert" && entry.balance?.userId) {
            yearCache.set(entry.balance.userId, entry.balance);
          }
        } catch { /* skip */ }
      }
    } catch { /* empty */ }
  }
  loadedYears.add(year);
}

function persist(balance: VacationBalance): void {
  ensureDir();
  try {
    appendFileSync(balanceFile(balance.year), JSON.stringify({ op: "upsert", balance }) + "\n", "utf-8");
  } catch (err) {
    console.error("[vacation-balance] append error:", err);
  }
}

function defaultBalance(userId: string, year: number): VacationBalance {
  return { userId, year, totalAllowed: 15, used: 0, remaining: 15, updatedAt: new Date().toISOString() };
}

export function getBalance(userId: string, year: number): VacationBalance {
  loadYear(year);
  return cache.get(year)?.get(userId) ?? defaultBalance(userId, year);
}

export function listAllForYear(year: number): VacationBalance[] {
  loadYear(year);
  return Array.from(cache.get(year)?.values() ?? []).sort((a, b) => a.userId.localeCompare(b.userId));
}

export function setTotal(userId: string, year: number, totalAllowed: number, reason?: string): VacationBalance {
  loadYear(year);
  const existing = getBalance(userId, year);
  const updated: VacationBalance = {
    ...existing,
    totalAllowed,
    remaining: totalAllowed - existing.used,
    updatedAt: new Date().toISOString(),
  };
  cache.get(year)!.set(userId, updated);
  persist(updated);
  if (reason) console.log(`[vacation-balance] setTotal ${userId}/${year}: ${totalAllowed} (${reason})`);
  return updated;
}

export function decrement(userId: string, year: number, days: number, reason?: string): VacationBalance {
  loadYear(year);
  const existing = getBalance(userId, year);
  if (existing.remaining < days) throw new Error("INSUFFICIENT_BALANCE");
  const updated: VacationBalance = {
    ...existing,
    used: existing.used + days,
    remaining: existing.remaining - days,
    updatedAt: new Date().toISOString(),
  };
  cache.get(year)!.set(userId, updated);
  persist(updated);
  if (reason) console.log(`[vacation-balance] decrement ${userId}/${year}: -${days} (${reason})`);
  return updated;
}

export function increment(userId: string, year: number, days: number, reason?: string): VacationBalance {
  loadYear(year);
  const existing = getBalance(userId, year);
  const updated: VacationBalance = {
    ...existing,
    used: Math.max(0, existing.used - days),
    remaining: existing.remaining + days,
    updatedAt: new Date().toISOString(),
  };
  cache.get(year)!.set(userId, updated);
  persist(updated);
  if (reason) console.log(`[vacation-balance] increment ${userId}/${year}: +${days} (${reason})`);
  return updated;
}

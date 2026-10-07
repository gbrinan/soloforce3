import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// SQLite 단식부기 장부 — Actual Budget 스타일 최소 스키마 + Firefly Bill 패턴용 schedules.
// apps/finance/data/finance.sqlite (gitignored)에 저장. better-sqlite3 동기 API.

export type CategoryKind = "income" | "fixed" | "variable" | "subscription";
export const CATEGORY_KINDS: CategoryKind[] = ["income", "fixed", "variable", "subscription"];

export interface Account {
  id: string;
  name: string;
  type: string;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // KRW 정수
  account_id: string;
  category_id: string;
  payee: string;
  memo: string;
  schedule_id: string | null;
}

export interface Schedule {
  id: string;
  name: string;
  rule: string; // monthly:25 | yearly:03-15 | weekly:mon
  amount: number;
  category_id: string;
  payee: string;
  next_date: string;
  active: number; // 0 | 1
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  db = new Database(join(dataDir, "finance.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      type  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      kind  TEXT NOT NULL CHECK (kind IN ('income','fixed','variable','subscription'))
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id           TEXT PRIMARY KEY,
      date         TEXT NOT NULL,
      amount       INTEGER NOT NULL,
      account_id   TEXT NOT NULL REFERENCES accounts(id),
      category_id  TEXT NOT NULL REFERENCES categories(id),
      payee        TEXT NOT NULL DEFAULT '',
      memo         TEXT NOT NULL DEFAULT '',
      schedule_id  TEXT REFERENCES schedules(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_schedule ON transactions(schedule_id);
    CREATE TABLE IF NOT EXISTS schedules (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      rule         TEXT NOT NULL,
      amount       INTEGER NOT NULL,
      category_id  TEXT NOT NULL REFERENCES categories(id),
      payee        TEXT NOT NULL DEFAULT '',
      next_date    TEXT NOT NULL,
      active       INTEGER NOT NULL DEFAULT 1
    );
  `);

  seed(db);
  return db;
}

// 최초 실행 시 기본 계좌 1개 + 기본 카테고리 4종 시드.
function seed(d: Database.Database) {
  const accountCount = (d.prepare("SELECT COUNT(*) AS c FROM accounts").get() as { c: number }).c;
  if (accountCount === 0) {
    d.prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
      randomUUID(),
      "주계좌",
      "asset",
    );
  }
  const categoryCount = (d.prepare("SELECT COUNT(*) AS c FROM categories").get() as { c: number }).c;
  if (categoryCount === 0) {
    const ins = d.prepare("INSERT INTO categories (id, name, kind) VALUES (?, ?, ?)");
    const defaults: Array<[string, CategoryKind]> = [
      ["수입", "income"],
      ["고정비", "fixed"],
      ["변동비", "variable"],
      ["구독", "subscription"],
    ];
    for (const [name, kind] of defaults) ins.run(randomUUID(), name, kind);
  }
}

export function newId(): string {
  return randomUUID();
}

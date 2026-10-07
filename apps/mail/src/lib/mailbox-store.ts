import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Mailbox } from "@/types/mail";

const DATA_DIR = join(homedir(), ".config", "mycrew");
const FILE = join(DATA_DIR, "mail-mailboxes.json");

function getDefaultMailboxes(): Mailbox[] {
  return [
    {
      id: "default",
      email: "user@example.com",
      displayName: "User",
      createdAt: new Date().toISOString(),
    },
  ];
}

function load(): Mailbox[] {
  try {
    if (!existsSync(FILE)) return getDefaultMailboxes();
    return JSON.parse(readFileSync(FILE, "utf-8")) as Mailbox[];
  } catch {
    return getDefaultMailboxes();
  }
}

function save(mailboxes: Mailbox[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(mailboxes, null, 2));
}

export async function listMailboxes(): Promise<Mailbox[]> {
  return load();
}

export async function getMailbox(id: string): Promise<Mailbox | null> {
  return load().find((m) => m.id === id) ?? null;
}

export async function insertMailbox(mailbox: Mailbox): Promise<Mailbox> {
  const all = load();
  all.push(mailbox);
  save(all);
  return mailbox;
}

export async function updateMailbox(id: string, patch: Partial<Mailbox>): Promise<Mailbox | null> {
  const all = load();
  const idx = all.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch };
  save(all);
  return all[idx];
}

export async function deleteMailbox(id: string): Promise<void> {
  save(load().filter((m) => m.id !== id));
}

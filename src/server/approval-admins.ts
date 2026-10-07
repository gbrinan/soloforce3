// Approval admin registry — approvers, admins, HR roles for workflow approval system.
// Persistence: append-only JSONL (latest-wins by userId).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import type { WorkflowType } from "./workflow-approvals.js";

const ADMINS_DIR = join(HISTORY_DIR, "approval-admins");
const ADMINS_FILE = join(ADMINS_DIR, "admins.jsonl");

export interface ApprovalAdmin {
  userId: string;
  role: "approver" | "admin" | "hr";
  managedTypes?: WorkflowType[];
  createdAt: string;
}

// In-memory cache (latest-wins by userId)
let cache = new Map<string, ApprovalAdmin>();
let initialized = false;

function ensureDir(): void {
  if (!existsSync(ADMINS_DIR)) mkdirSync(ADMINS_DIR, { recursive: true });
}

function load(): void {
  if (initialized) return;
  ensureDir();
  if (existsSync(ADMINS_FILE)) {
    try {
      const content = readFileSync(ADMINS_FILE, "utf-8");
      for (const raw of content.split("\n")) {
        if (!raw.trim()) continue;
        try {
          const entry = JSON.parse(raw) as { op: string; admin: ApprovalAdmin };
          if (entry.op === "upsert" && entry.admin?.userId) {
            cache.set(entry.admin.userId, entry.admin);
          } else if (entry.op === "remove" && entry.admin?.userId) {
            cache.delete(entry.admin.userId);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* empty file */ }
  }
  // Bootstrap from env if first admin doesn't exist yet
  const initialAdmin = process.env.INITIAL_APPROVAL_ADMIN;
  if (initialAdmin && !cache.has(initialAdmin)) {
    const admin: ApprovalAdmin = { userId: initialAdmin, role: "admin", createdAt: new Date().toISOString() };
    cache.set(admin.userId, admin);
    appendLine("upsert", admin);
    console.log(`[approval-admins] bootstrapped admin: ${initialAdmin}`);
  }
  initialized = true;
}

function appendLine(op: "upsert" | "remove", admin: ApprovalAdmin): void {
  ensureDir();
  try {
    appendFileSync(ADMINS_FILE, JSON.stringify({ op, admin }) + "\n", "utf-8");
  } catch (err) {
    console.error("[approval-admins] append error:", err);
  }
}

export function listAdmins(): ApprovalAdmin[] {
  load();
  return Array.from(cache.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function upsertAdmin(input: Omit<ApprovalAdmin, "createdAt">): ApprovalAdmin {
  load();
  const existing = cache.get(input.userId);
  const admin: ApprovalAdmin = {
    ...input,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  cache.set(admin.userId, admin);
  appendLine("upsert", admin);
  return admin;
}

export function removeAdmin(userId: string): boolean {
  load();
  const existing = cache.get(userId);
  if (!existing) return false;
  cache.delete(userId);
  appendLine("remove", existing);
  return true;
}

export function isApprovalAdmin(userKey: string): boolean {
  load();
  return cache.has(userKey);
}

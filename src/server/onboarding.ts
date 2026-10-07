// Onboarding backend — workspace creation (slug), team invite tokens, onboarding progress.
// Persistence: history/onboarding/ (JSON files, last-write-wins — single-user-at-a-time safe).
// API contract: see history/outputs/linus/b2b-api-contract_linus_2026-06-26.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { HISTORY_DIR } from "../config.js";

const ONBOARDING_DIR = join(HISTORY_DIR, "onboarding");

function ensureDir(): void {
  if (!existsSync(ONBOARDING_DIR)) mkdirSync(ONBOARDING_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  const p = join(ONBOARDING_DIR, file);
  try { if (!existsSync(p)) return fallback; return JSON.parse(readFileSync(p, "utf-8")) as T; } catch { return fallback; }
}

function writeJson(file: string, data: unknown): void {
  ensureDir();
  writeFileSync(join(ONBOARDING_DIR, file), JSON.stringify(data, null, 2));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type OnboardingStep =
  | "workspace_created"
  | "profile_set"
  | "team_invited"
  | "first_agent"
  | "completed";

export interface WorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  ownerKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface InviteToken {
  token: string;
  workspaceId: string;
  inviterKey: string;
  email?: string;
  expiresAt: string;
  usedAt?: string;
}

export interface OnboardingProgress {
  userKey: string;
  workspaceId?: string;
  completedSteps: OnboardingStep[];
  currentStep: OnboardingStep;
  updatedAt: string;
}

// ── Workspace ─────────────────────────────────────────────────────────────────

const STEP_ORDER: OnboardingStep[] = [
  "workspace_created",
  "profile_set",
  "team_invited",
  "first_agent",
  "completed",
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

export function createWorkspace(
  name: string,
  ownerKey: string,
  customSlug?: string,
): { workspace: WorkspaceRecord } | { error: string } {
  ensureDir();
  const all = readJson<WorkspaceRecord[]>("workspaces.json", []);
  const slug = slugify(customSlug ?? name);
  if (!slug) return { error: "invalid workspace name" };
  if (all.some((w) => w.slug === slug)) return { error: `slug "${slug}" already taken` };
  const now = new Date().toISOString();
  const workspace: WorkspaceRecord = {
    id: randomUUID(),
    slug,
    name: name.trim(),
    ownerKey,
    createdAt: now,
    updatedAt: now,
  };
  all.push(workspace);
  writeJson("workspaces.json", all);
  return { workspace };
}

export function getWorkspace(id: string): WorkspaceRecord | null {
  return readJson<WorkspaceRecord[]>("workspaces.json", []).find((w) => w.id === id) ?? null;
}

export function getWorkspaceBySlug(slug: string): WorkspaceRecord | null {
  return readJson<WorkspaceRecord[]>("workspaces.json", []).find((w) => w.slug === slug) ?? null;
}

export function listWorkspaces(ownerKey: string): WorkspaceRecord[] {
  return readJson<WorkspaceRecord[]>("workspaces.json", []).filter((w) => w.ownerKey === ownerKey);
}

// ── Invite Tokens ─────────────────────────────────────────────────────────────

const INVITE_TTL_HOURS = 72;

export function generateInviteToken(workspaceId: string, inviterKey: string, email?: string): InviteToken {
  ensureDir();
  const all = readJson<InviteToken[]>("invites.json", []);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const invite: InviteToken = { token, workspaceId, inviterKey, expiresAt, ...(email ? { email } : {}) };
  all.push(invite);
  writeJson("invites.json", all);
  return invite;
}

export function validateInviteToken(token: string): InviteToken | null {
  const all = readJson<InviteToken[]>("invites.json", []);
  const invite = all.find((i) => i.token === token);
  if (!invite || invite.usedAt || new Date(invite.expiresAt) < new Date()) return null;
  return invite;
}

export function consumeInviteToken(token: string): InviteToken | null {
  const all = readJson<InviteToken[]>("invites.json", []);
  const invite = all.find((i) => i.token === token);
  if (!invite || invite.usedAt || new Date(invite.expiresAt) < new Date()) return null;
  invite.usedAt = new Date().toISOString();
  writeJson("invites.json", all);
  return invite;
}

// ── Onboarding Progress ───────────────────────────────────────────────────────

export function getOnboardingProgress(userKey: string): OnboardingProgress {
  const all = readJson<OnboardingProgress[]>("progress.json", []);
  return all.find((p) => p.userKey === userKey) ?? {
    userKey,
    completedSteps: [],
    currentStep: "workspace_created",
    updatedAt: new Date().toISOString(),
  };
}

export function advanceOnboardingStep(
  userKey: string,
  step: OnboardingStep,
  workspaceId?: string,
): OnboardingProgress {
  ensureDir();
  const all = readJson<OnboardingProgress[]>("progress.json", []);
  let prog = all.find((p) => p.userKey === userKey);
  if (!prog) {
    prog = { userKey, completedSteps: [], currentStep: "workspace_created", updatedAt: "" };
    all.push(prog);
  }
  if (!prog.completedSteps.includes(step)) prog.completedSteps.push(step);
  if (workspaceId) prog.workspaceId = workspaceId;
  const nextIdx = STEP_ORDER.indexOf(step) + 1;
  if (nextIdx < STEP_ORDER.length) prog.currentStep = STEP_ORDER[nextIdx];
  prog.updatedAt = new Date().toISOString();
  writeJson("progress.json", all);
  return prog;
}

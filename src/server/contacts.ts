// 마이크루 연락처 SSOT.
// 영속: history/contacts.json (mtime 캐시 + 원자적 쓰기 — partners.ts와 동일 패턴).
// 출처: 수동 입력(manual) / 카메라 캡처(camera) / 사진앱 OCR(photo).
// audit 이벤트: contact_created / updated / deleted / auto_added / favorite_toggled.

import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { HISTORY_DIR } from "../config.js";
import type { Contact, ContactDraft, ContactSource } from "../types.js";
import { auditEvent } from "./external-audit.js";

const CONTACTS_FILE = join(HISTORY_DIR, "contacts.json");

interface ContactsFile {
  version: number;
  contacts: Contact[];
}

let cache: Contact[] = [];
let lastMtime = 0;
let initialized = false;

function ensureDir(): void {
  const dir = dirname(CONTACTS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readDisk(): Contact[] {
  if (!existsSync(CONTACTS_FILE)) return [];
  try {
    const raw = readFileSync(CONTACTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as ContactsFile;
    return Array.isArray(parsed.contacts) ? parsed.contacts : [];
  } catch (err) {
    console.warn(`[Contacts] 파싱 실패, 캐시 유지: ${err instanceof Error ? err.message : err}`);
    return cache;
  }
}

function loadIfStale(): void {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(CONTACTS_FILE).mtimeMs;
  } catch {
    if (!initialized) {
      cache = [];
      initialized = true;
    }
    return;
  }
  if (initialized && mtimeMs === lastMtime) return;
  cache = readDisk();
  lastMtime = mtimeMs;
  initialized = true;
}

function persist(): void {
  ensureDir();
  const tmp = CONTACTS_FILE + ".tmp";
  const data: ContactsFile = { version: 1, contacts: cache };
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, CONTACTS_FILE);
  try {
    lastMtime = statSync(CONTACTS_FILE).mtimeMs;
  } catch { /* ignore */ }
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((v) => String(v).trim()).filter((v) => v.length > 0);
}

function normalizeDraft(d: ContactDraft): ContactDraft {
  const labels = normalizeStringArray(d.labels);
  const phones = normalizeStringArray(d.phones);
  const emails = normalizeStringArray(d.emails);
  return {
    name: (d.name ?? "").trim(),
    phone: d.phone?.trim() || undefined,
    phones: phones.length > 0 ? phones : undefined,
    email: d.email?.trim() || undefined,
    emails: emails.length > 0 ? emails : undefined,
    company: d.company?.trim() || undefined,
    department: d.department?.trim() || undefined,
    position: d.position?.trim() || undefined,
    address: d.address?.trim() || undefined,
    memo: d.memo?.trim() || undefined,
    labels: labels,
    favorite: !!d.favorite,
    source: d.source,
    sourcePhotoSha: d.sourcePhotoSha?.trim() || undefined,
    ocrConfidence: typeof d.ocrConfidence === "number" ? d.ocrConfidence : undefined,
  };
}

// 중복 판정: 같은 sourcePhotoSha 가 있는 OCR 결과면 동일로 본다.
// 같은 (name+phone) 또는 (name+email) 조합도 동일로 처리해 자동 추가 폭증 방지.
function findDuplicate(draft: ContactDraft): Contact | undefined {
  loadIfStale();
  if (draft.sourcePhotoSha) {
    const bySha = cache.find((c) => c.sourcePhotoSha && c.sourcePhotoSha === draft.sourcePhotoSha);
    if (bySha) return bySha;
  }
  const name = draft.name?.trim();
  if (!name) return undefined;
  const phone = draft.phone?.trim() || (draft.phones && draft.phones[0]);
  const email = draft.email?.trim() || (draft.emails && draft.emails[0]);
  return cache.find((c) => {
    if (c.name !== name) return false;
    if (phone && (c.phone === phone || (c.phones || []).includes(phone))) return true;
    if (email && (c.email === email || (c.emails || []).includes(email))) return true;
    return false;
  });
}

export function loadContacts(): void {
  ensureDir();
  loadIfStale();
}

export function listContacts(): Contact[] {
  loadIfStale();
  return cache.slice();
}

export function getContact(id: string): Contact | undefined {
  loadIfStale();
  return cache.find((c) => c.id === id);
}

export function createContact(draft: ContactDraft, opts?: { source?: ContactSource; auto?: boolean }): Contact {
  loadIfStale();
  const normalized = normalizeDraft(draft);
  if (!normalized.name) throw new Error("name 필수");
  const source: ContactSource = opts?.source ?? normalized.source ?? "manual";
  const dup = findDuplicate(normalized);
  if (dup) {
    // 중복: 비어있던 필드만 보강하고 기존 id 반환 (자동추가 시 폭증 방지)
    const patch: ContactDraft = {
      name: dup.name,
      phone: dup.phone ?? normalized.phone,
      phones: dup.phones && dup.phones.length > 0 ? dup.phones : normalized.phones,
      email: dup.email ?? normalized.email,
      emails: dup.emails && dup.emails.length > 0 ? dup.emails : normalized.emails,
      company: dup.company ?? normalized.company,
      department: dup.department ?? normalized.department,
      position: dup.position ?? normalized.position,
      address: dup.address ?? normalized.address,
      memo: dup.memo ?? normalized.memo,
      labels: dup.labels.length > 0 ? dup.labels : normalized.labels,
      favorite: dup.favorite,
      sourcePhotoSha: dup.sourcePhotoSha ?? normalized.sourcePhotoSha,
      ocrConfidence: dup.ocrConfidence ?? normalized.ocrConfidence,
    };
    const updated = updateContact(dup.id, patch);
    return updated ?? dup;
  }
  const now = nowIso();
  const contact: Contact = {
    id: randomUUID(),
    name: normalized.name,
    phone: normalized.phone,
    phones: normalized.phones,
    email: normalized.email,
    emails: normalized.emails,
    company: normalized.company,
    department: normalized.department,
    position: normalized.position,
    address: normalized.address,
    memo: normalized.memo,
    labels: normalized.labels ?? [],
    favorite: normalized.favorite ?? false,
    source,
    sourcePhotoSha: normalized.sourcePhotoSha,
    ocrConfidence: normalized.ocrConfidence,
    createdAt: now,
    updatedAt: now,
  };
  cache.push(contact);
  persist();
  auditEvent({
    type: opts?.auto ? "contact_auto_added" : "contact_created",
    detail: {
      id: contact.id,
      name: contact.name,
      source: contact.source,
      sourcePhotoSha: contact.sourcePhotoSha,
    },
  });
  return contact;
}

export function updateContact(id: string, patch: ContactDraft): Contact | undefined {
  loadIfStale();
  const c = cache.find((x) => x.id === id);
  if (!c) return undefined;
  const before = { ...c };
  if (patch.name !== undefined) c.name = patch.name.trim() || c.name;
  if (patch.phone !== undefined) c.phone = patch.phone?.trim() || undefined;
  if (patch.phones !== undefined) {
    const arr = normalizeStringArray(patch.phones);
    c.phones = arr.length > 0 ? arr : undefined;
  }
  if (patch.email !== undefined) c.email = patch.email?.trim() || undefined;
  if (patch.emails !== undefined) {
    const arr = normalizeStringArray(patch.emails);
    c.emails = arr.length > 0 ? arr : undefined;
  }
  if (patch.company !== undefined) c.company = patch.company?.trim() || undefined;
  if (patch.department !== undefined) c.department = patch.department?.trim() || undefined;
  if (patch.position !== undefined) c.position = patch.position?.trim() || undefined;
  if (patch.address !== undefined) c.address = patch.address?.trim() || undefined;
  if (patch.memo !== undefined) c.memo = patch.memo?.trim() || undefined;
  if (patch.labels !== undefined) c.labels = normalizeStringArray(patch.labels);
  if (patch.favorite !== undefined) c.favorite = !!patch.favorite;
  if (patch.source !== undefined) c.source = patch.source;
  if (patch.sourcePhotoSha !== undefined) c.sourcePhotoSha = patch.sourcePhotoSha?.trim() || undefined;
  if (patch.ocrConfidence !== undefined) c.ocrConfidence = patch.ocrConfidence;
  c.updatedAt = nowIso();
  persist();
  auditEvent({
    type: "contact_updated",
    detail: { id, before: { name: before.name }, after: { name: c.name } },
  });
  return c;
}

export function deleteContact(id: string): boolean {
  loadIfStale();
  const idx = cache.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  const removed = cache[idx];
  cache.splice(idx, 1);
  persist();
  auditEvent({ type: "contact_deleted", detail: { id, name: removed.name } });
  return true;
}

export function toggleFavorite(id: string): Contact | undefined {
  loadIfStale();
  const c = cache.find((x) => x.id === id);
  if (!c) return undefined;
  c.favorite = !c.favorite;
  c.updatedAt = nowIso();
  persist();
  auditEvent({ type: "contact_favorite_toggled", detail: { id, favorite: c.favorite } });
  return c;
}

// 검색 + 필터 + 정렬 통합. 클라이언트에서 UI 필터로 사용.
export interface ContactsQuery {
  q?: string;                    // 검색어 — name/phone/email/company 부분 일치
  label?: string;                // 라벨 정확 일치
  company?: string;              // 회사 부분 일치
  favoriteOnly?: boolean;        // 즐겨찾기만
  source?: ContactSource;        // 출처 필터
  sort?: "name" | "recent" | "company"; // 정렬 키 (기본 name)
}

export function queryContacts(opts: ContactsQuery = {}): Contact[] {
  loadIfStale();
  let result = cache.slice();
  if (opts.favoriteOnly) result = result.filter((c) => c.favorite);
  if (opts.label) result = result.filter((c) => c.labels.includes(opts.label!));
  if (opts.company) {
    const needle = opts.company.toLowerCase();
    result = result.filter((c) => (c.company ?? "").toLowerCase().includes(needle));
  }
  if (opts.source) result = result.filter((c) => c.source === opts.source);
  if (opts.q) {
    const needle = opts.q.toLowerCase();
    result = result.filter((c) => {
      if (c.name.toLowerCase().includes(needle)) return true;
      if ((c.company ?? "").toLowerCase().includes(needle)) return true;
      if ((c.phone ?? "").includes(needle)) return true;
      if ((c.phones ?? []).some((p) => p.includes(needle))) return true;
      if ((c.email ?? "").toLowerCase().includes(needle)) return true;
      if ((c.emails ?? []).some((e) => e.toLowerCase().includes(needle))) return true;
      if ((c.address ?? "").toLowerCase().includes(needle)) return true;
      if ((c.memo ?? "").toLowerCase().includes(needle)) return true;
      return false;
    });
  }
  const sort = opts.sort ?? "name";
  if (sort === "name") {
    result.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  } else if (sort === "recent") {
    result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else if (sort === "company") {
    result.sort((a, b) => {
      const ca = (a.company ?? "").localeCompare(b.company ?? "", "ko");
      if (ca !== 0) return ca;
      return a.name.localeCompare(b.name, "ko");
    });
  }
  return result;
}

// 라벨 집계 — 사이드바 필터용
export function listLabels(): Array<{ label: string; count: number }> {
  loadIfStale();
  const counts = new Map<string, number>();
  for (const c of cache) {
    for (const l of c.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
}

// 회사 집계 — 필터 UI 옵션
export function listCompanies(): Array<{ company: string; count: number }> {
  loadIfStale();
  const counts = new Map<string, number>();
  for (const c of cache) {
    if (!c.company) continue;
    counts.set(c.company, (counts.get(c.company) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([company, count]) => ({ company, count }))
    .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company, "ko"));
}

export function contactStats(): { total: number; favorites: number; bySource: Record<ContactSource, number> } {
  loadIfStale();
  const bySource: Record<ContactSource, number> = { manual: 0, camera: 0, photo: 0 };
  let favorites = 0;
  for (const c of cache) {
    bySource[c.source] = (bySource[c.source] ?? 0) + 1;
    if (c.favorite) favorites += 1;
  }
  return { total: cache.length, favorites, bySource };
}

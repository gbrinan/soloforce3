import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Mail, MailFolder } from "@/types/mail";

const DATA_DIR = join(homedir(), ".config", "mycrew");
const FILE = join(DATA_DIR, "mail-messages.json");

function getDefaultMails(): Mail[] {
  return [
    {
      id: "welcome-1",
      mailboxId: "default",
      folder: "inbox",
      from: { name: "MyCrew 팀", email: "team@mycrew.com" },
      to: [{ email: "hello@mycrew.com" }],
      subject: "MyMail에 오신 것을 환영합니다 👋",
      body: "안녕하세요!\n\nMyMail을 사용해 주셔서 감사합니다.\n\n메일 발송/수신 기능을 활성화하려면 Resend API 키와 Cloudflare Email Workers 설정이 필요합니다. 설정 방법은 관리자에게 문의해주세요.\n\n즐거운 하루 되세요!",
      bodyType: "text",
      read: false,
      starred: true,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];
}

function load(): Mail[] {
  try {
    if (!existsSync(FILE)) return getDefaultMails();
    return JSON.parse(readFileSync(FILE, "utf-8")) as Mail[];
  } catch {
    return getDefaultMails();
  }
}

function save(mails: Mail[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(mails, null, 2));
}

export async function listMails(mailboxId?: string, folder?: MailFolder): Promise<Mail[]> {
  return load()
    .filter((m) => !mailboxId || m.mailboxId === mailboxId)
    .filter((m) => !folder || m.folder === folder)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function getMail(id: string): Promise<Mail | null> {
  return load().find((m) => m.id === id) ?? null;
}

export async function insertMail(mail: Mail): Promise<Mail> {
  const all = load();
  all.push(mail);
  save(all);
  return mail;
}

export async function updateMail(id: string, patch: Partial<Mail>): Promise<Mail | null> {
  const all = load();
  const idx = all.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch };
  save(all);
  return all[idx];
}

export async function deleteMail(id: string): Promise<void> {
  save(load().filter((m) => m.id !== id));
}

export async function countUnread(mailboxId?: string): Promise<Record<MailFolder, number>> {
  const mails = await listMails(mailboxId);
  const counts: Record<MailFolder, number> = {
    inbox: 0, sent: 0, draft: 0, trash: 0, spam: 0, starred: 0,
  };
  for (const m of mails) {
    if (!m.read) counts[m.folder]++;
    if (!m.read && m.starred) counts.starred++;
  }
  return counts;
}

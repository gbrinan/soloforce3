export type MailFolder = "inbox" | "sent" | "draft" | "trash" | "spam" | "starred";

export type MailLabel = "newsletter" | "billing" | "reply-needed" | "normal";

export type MailImportance = "high" | "normal" | "low";

// AI 수신함 분류 카테고리 (업무|개인|뉴스레터|알림|스팸성 — UI에서 한글 표시)
export type MailCategory = "work" | "personal" | "newsletter" | "notification" | "spam";

export interface MailAddress {
  name?: string;
  email: string;
}

export interface MailAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url?: string;
}

export interface Mail {
  id: string;
  mailboxId: string;
  folder: MailFolder;
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  body: string;
  bodyType: "text" | "html";
  read: boolean;
  starred: boolean;
  attachments?: MailAttachment[];
  date: string;
  createdAt: string;
  // AI/rule classification (persisted after first classify)
  label?: MailLabel;
  importance?: MailImportance;
  // AI 카테고리 분류 캐시 (persisted after first categorize — 재분류 방지)
  category?: MailCategory;
  priority?: MailImportance;
  categoryReason?: string;
}

export interface Mailbox {
  id: string;
  email: string;
  displayName: string;
  forwardTo?: { type: "telegram" | "email"; value: string };
  createdAt: string;
}

export interface MailSettings {
  appName: string;
  defaultMailboxId: string | null;
  notifyNewMail: boolean;
  notifySound: boolean;
  showPreview: boolean;
  pageSize: number;
}

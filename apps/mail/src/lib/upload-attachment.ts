import { apiUrl } from "./api-url";
import type { MailAttachment } from "@/types/mail";

export async function uploadAttachment(file: File | Blob, filename?: string): Promise<MailAttachment> {
  const fd = new FormData();
  const name = filename || (file instanceof File ? file.name : "") || "file";
  fd.append("file", file, name);
  const res = await fetch(apiUrl("/api/mail/attachments"), { method: "POST", body: fd });
  if (!res.ok) throw new Error(`attachment upload failed (${res.status})`);
  return (await res.json()) as MailAttachment;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

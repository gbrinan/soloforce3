// 이력서(me.md) 발송 — 이력서 공유 시스템 v2 Phase 2 (F5).
// me.md를 attachment(base64)로 resume_share 메시지로 발송. 성공 시 resumeSharedAt 갱신.
// 별도 모듈로 분리: partners.ts가 external-client를 import하면 순환 의존이 되므로.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";
import { sendExternal } from "./external-client.js";
import { setResumeShared } from "./partners.js";
import { getGenieName } from "./chat.js";

const ME_RESUME_FILE = join(HISTORY_DIR, "external", "resumes", "me.md");

// me.md 첫 비어있지 않은 줄(제목)을 1줄 요약으로 사용
function resumeSummary(content: string): string {
  const firstLine = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "이력서";
  return firstLine.replace(/^#+\s*/, "").slice(0, 200);
}

export async function sendResume(partnerId: string): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(ME_RESUME_FILE)) {
    throw new Error("이력서(me.md)가 없습니다. 먼저 작성해 주세요.");
  }
  const content = readFileSync(ME_RESUME_FILE, "utf-8");
  if (!content.trim()) {
    throw new Error("이력서(me.md)가 비어 있습니다. 먼저 작성해 주세요.");
  }
  const size = statSync(ME_RESUME_FILE).size;
  const data = readFileSync(ME_RESUME_FILE).toString("base64");
  const result = await sendExternal(partnerId, "이력서를 공유합니다.", {
    messageType: "resume_share",
    ourLabel: getGenieName(),
    payload: { summary: resumeSummary(content) },
    attachments: [{ filename: "me.md", mimeType: "text/markdown", size, data }],
  });
  if (!result.ok) return { ok: false, error: result.errorReason };
  setResumeShared(partnerId, true); // resumeSharedAt = now + persist + audit
  return { ok: true };
}

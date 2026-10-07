import { NextRequest, NextResponse } from "next/server";
import { listMails, updateMail } from "@/lib/mail-store";
import { categorizeMails, MAX_BATCH_SIZE, type CategorizeResult } from "@/lib/mail-categorize";
import { claudeErrorDetail } from "@/lib/claude-cli";
import type { Mail } from "@/types/mail";

/**
 * POST /api/mail/categorize/batch
 * 미분류 수신함 메일을 일괄 분류한다 (호출당 최대 10건, Claude CLI 1회 호출).
 * - mailIds 지정 시 해당 메일만, 미지정 시 미분류 inbox 메일을 스캔.
 * - 이미 분류된 메일은 건너뜀 (캐시 — 재분류 방지).
 */

interface BatchRequest {
  mailIds?: string[];
  mailboxId?: string;
  limit?: number;
}

interface BatchItem extends CategorizeResult {
  id: string;
}

export async function POST(request: NextRequest) {
  let body: BatchRequest;
  try {
    body = (await request.json()) as BatchRequest;
  } catch {
    body = {};
  }

  const limit = Math.min(
    Math.max(1, typeof body.limit === "number" ? body.limit : MAX_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );

  const inbox = await listMails(body.mailboxId, "inbox");
  let targets: Mail[];
  if (Array.isArray(body.mailIds) && body.mailIds.length > 0) {
    const wanted = new Set(body.mailIds);
    targets = inbox.filter((m) => wanted.has(m.id) && !m.category);
  } else {
    targets = inbox.filter((m) => !m.category);
  }
  const remaining = Math.max(0, targets.length - limit);
  targets = targets.slice(0, limit);

  if (targets.length === 0) {
    return NextResponse.json({ classified: [], failed: 0, remaining: 0 });
  }

  try {
    const results = await categorizeMails(targets);
    const classified: BatchItem[] = [];
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const result = results[i];
      if (!result) {
        failed++;
        continue;
      }
      await updateMail(targets[i].id, {
        category: result.category,
        priority: result.priority,
        categoryReason: result.reason,
      });
      classified.push({ id: targets[i].id, ...result });
    }

    return NextResponse.json({ classified, failed, remaining });
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[categorize/batch] claude exec error:", detail);
    return NextResponse.json({ error: "Failed to categorize mails", detail }, { status: 500 });
  }
}

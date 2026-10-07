import { NextRequest, NextResponse } from "next/server";
import { getMail, updateMail } from "@/lib/mail-store";
import { categorizeMails } from "@/lib/mail-categorize";
import { claudeErrorDetail } from "@/lib/claude-cli";

/**
 * POST /api/mail/categorize
 * 메일 1건을 {category, priority, reason}으로 분류하고 메일 스토어에 캐시한다.
 * 이미 분류된 메일은 재분류하지 않고 캐시를 반환 (force: true로 강제 재분류).
 */

interface CategorizeRequest {
  mailId: string;
  force?: boolean;
}

export async function POST(request: NextRequest) {
  let body: CategorizeRequest;
  try {
    body = (await request.json()) as CategorizeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.mailId) {
    return NextResponse.json({ error: "Missing required field: mailId" }, { status: 400 });
  }

  const mail = await getMail(body.mailId);
  if (!mail) {
    return NextResponse.json({ error: "Mail not found" }, { status: 404 });
  }

  // 캐시 히트: 재분류 방지
  if (mail.category && !body.force) {
    return NextResponse.json({
      category: mail.category,
      priority: mail.priority ?? "normal",
      reason: mail.categoryReason ?? "",
      cached: true,
    });
  }

  try {
    const [result] = await categorizeMails([mail]);
    if (!result) {
      return NextResponse.json({ error: "Claude returned unparsable response" }, { status: 502 });
    }
    // 실패 시에는 저장하지 않음 — 다음 호출에서 재시도 가능
    await updateMail(mail.id, {
      category: result.category,
      priority: result.priority,
      categoryReason: result.reason,
    });
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    const detail = claudeErrorDetail(err);
    console.error("[categorize] claude exec error:", detail);
    return NextResponse.json({ error: "Failed to categorize mail", detail }, { status: 500 });
  }
}

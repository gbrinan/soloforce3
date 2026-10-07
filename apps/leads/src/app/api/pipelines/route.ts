import { NextRequest, NextResponse } from "next/server";
import { createPipeline, listPipelines } from "@/lib/leads-db";
import { isNonEmptyString, readJson } from "@/lib/validate";

export async function GET() {
  return NextResponse.json(listPipelines());
}

// 파이프라인 생성 — 기본 스테이지 4종(문의→미팅→견적→계약완료) 자동 생성.
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  if (!isNonEmptyString(body.name)) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const product = typeof body.product === "string" ? body.product.trim() : "";
  const pipeline = createPipeline(body.name.trim(), product);
  return NextResponse.json(pipeline, { status: 201 });
}

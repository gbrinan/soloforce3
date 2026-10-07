import { NextResponse } from "next/server";
import { listRottingLeads } from "@/lib/leads-db";

// GET /api/rotting — 전 파이프라인 rotting 리드 (lead-keeper 에이전트용).
export async function GET() {
  return NextResponse.json(listRottingLeads());
}

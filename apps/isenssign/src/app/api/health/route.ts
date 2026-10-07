import { NextResponse } from "next/server";

// 표준 헬스체크 — 다른 마이크루 앱들과 동일 경로(/api/health)로 통일 (2026-07-04).
export function GET() {
  return NextResponse.json({ ok: true, app: "sign" });
}

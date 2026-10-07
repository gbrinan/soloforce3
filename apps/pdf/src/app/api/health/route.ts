import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STIRLING = (process.env.STIRLING_PDF_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");

export function GET() {
  return NextResponse.json({
    ok: true,
    app: "pdf",
    stirling: STIRLING,
    ts: Date.now(),
  });
}

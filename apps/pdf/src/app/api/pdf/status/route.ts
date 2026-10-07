import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STIRLING = (process.env.STIRLING_PDF_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");

// Probes whether the Stirling-PDF backend is reachable. Treats any HTTP
// response (even non-2xx) from the root as "online" since the server is up.
export async function GET() {
  try {
    const res = await fetch(`${STIRLING}/`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    return NextResponse.json({ online: res.status > 0, stirling: STIRLING });
  } catch {
    return NextResponse.json({ online: false, stirling: STIRLING });
  }
}

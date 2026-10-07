import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STIRLING = (process.env.STIRLING_PDF_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");

// Same-origin proxy: forwards multipart/form-data to the Stirling-PDF v1 API.
// Client POSTs to /api/pdf/<endpoint> (e.g. /api/pdf/general/merge-pdfs);
// this forwards to ${STIRLING}/api/v1/<endpoint> and streams the binary result back.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const endpoint = (path || []).join("/");
  if (!endpoint) {
    return NextResponse.json({ error: "missing_endpoint" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected_multipart" }, { status: 400 });
  }

  const target = `${STIRLING}/api/v1/${endpoint}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(115_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "stirling_unreachable", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "stirling_error", status: upstream.status, detail: text.slice(0, 2000) },
      { status: upstream.status },
    );
  }

  const buf = await upstream.arrayBuffer();
  const headers: Record<string, string> = {
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
  };
  const cd = upstream.headers.get("content-disposition");
  if (cd) headers["content-disposition"] = cd;
  return new NextResponse(buf, { status: 200, headers });
}

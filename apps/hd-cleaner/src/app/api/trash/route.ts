export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { moveToTrash } from "@/lib/deleter/trash";
import { isTestMode, getPermissionGranted, getMockDeleteResult } from "@/lib/test-hooks";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const paths: string[] = Array.isArray(body?.paths) ? body.paths : [];
  const dryRun = Boolean(body?.dryRun);

  if (!paths.length) {
    return NextResponse.json({ ok: false, error: "paths required" }, { status: 400 });
  }

  if (isTestMode()) {
    if (!getPermissionGranted()) {
      return NextResponse.json({ ok: false, error: "permission denied (mocked)" }, { status: 403 });
    }
    const mocked = getMockDeleteResult();
    if (mocked === "failure") {
      return NextResponse.json({ ok: false, error: "delete failed (mocked)" }, { status: 500 });
    }
  }

  const result = await moveToTrash(paths, { dryRun });
  return NextResponse.json({ ok: true, dryRun, ...result });
}

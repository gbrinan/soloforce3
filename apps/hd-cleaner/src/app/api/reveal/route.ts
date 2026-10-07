export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { resolve, sep } from "node:path";
import os from "node:os";
import { isDenied } from "@/lib/safety";
import { isTestMode } from "@/lib/test-hooks";

const HOME = os.homedir();

// 파일 위치를 OS 파일 관리자에서 연다(reveal). 스캔이 노출한 홈 하위 실제 파일만 허용 —
// 임의 경로 실행/노출을 막기 위해 존재·홈 범위·시스템 보호경로 검증 후 execFile(shell 미경유)로 실행.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const raw = typeof body?.path === "string" ? body.path : "";
  if (!raw) return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });

  const p = resolve(raw);
  // 홈 디렉토리 하위만 허용 (스캔 범위와 동일)
  if (p !== HOME && !p.startsWith(HOME + sep)) {
    return NextResponse.json({ ok: false, error: "홈 디렉토리 밖 경로는 허용되지 않습니다" }, { status: 403 });
  }
  if (isDenied(p)) {
    return NextResponse.json({ ok: false, error: "시스템 보호 경로입니다" }, { status: 403 });
  }
  if (!existsSync(p)) {
    return NextResponse.json({ ok: false, error: "파일이 존재하지 않습니다 (이미 삭제/이동됨)" }, { status: 404 });
  }

  // 테스트 모드에선 실제 OS 명령을 실행하지 않고 성공만 반환(부작용 없는 검증).
  if (isTestMode()) return NextResponse.json({ ok: true, mocked: true });

  const isFile = (() => { try { return lstatSync(p).isFile(); } catch { return false; } })();

  const run = (cmd: string, args: string[]): Promise<{ ok: boolean; error?: string }> =>
    new Promise((res) => {
      execFile(cmd, args, { timeout: 5000 }, (err) => res(err ? { ok: false, error: err.message } : { ok: true }));
    });

  let result: { ok: boolean; error?: string };
  if (process.platform === "darwin") {
    // -R: Finder에서 해당 항목을 선택한 채로 폴더를 연다.
    result = await run("open", ["-R", p]);
  } else if (process.platform === "win32") {
    result = isFile
      ? await run("explorer", [`/select,${p}`])
      : await run("explorer", [p]);
  } else {
    // Linux: 파일 관리자는 폴더 단위 열기만 지원 — 상위 폴더를 연다.
    const dir = isFile ? p.slice(0, p.lastIndexOf(sep)) || "/" : p;
    result = await run("xdg-open", [dir]);
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: `열기 실패: ${result.error ?? "unknown"}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

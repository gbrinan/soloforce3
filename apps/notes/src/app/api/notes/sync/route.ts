import { NextResponse } from "next/server";

// 스텁: 클라이언트 IndexedDB 노트를 서버에 백업하는 훅. 현재는 수신만 확인하고
// 영속화하지 않는다(실 저장소 연결은 v1.6 이후 별도 발주 예정, §7.4 permissions에
// fs:~/.mycrew-notes/**만 명시되어 있고 DB 스키마는 아직 확정되지 않음).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, synced: false, reason: "not_implemented" });
}

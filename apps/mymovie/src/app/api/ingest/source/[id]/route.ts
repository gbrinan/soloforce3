// GET /api/ingest/source/[id]
// jobId로 ingest proxy 파일을 스트리밍한다 (원본 미리보기용).
// 보안: id 외 경로 입력 없음. job.proxyPath만 lookup, traversal 차단.
// Range(206) 지원: 모바일 사파리·iframe 임베드 환경에서 <video> 가 seek/buffering 을
// 정상 처리하려면 Accept-Ranges + 206 Partial Content 응답이 필요하다.

import { NextResponse } from "next/server";
import { existsSync, statSync, createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { getJob } from "@/lib/ingest/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toWebStream(nodeStream: ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        const buf =
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        controller.enqueue(buf);
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || typeof id !== "string" || /[/\\]/.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  }

  const proxyPath = job.proxyPath;
  if (!proxyPath || !existsSync(proxyPath)) {
    return NextResponse.json(
      { ok: false, error: "proxy file not available" },
      { status: 404 },
    );
  }

  const size = statSync(proxyPath).size;
  const rangeHeader = req.headers.get("range");

  // Single-range Range request (RFC 7233). HTML5 <video> never asks for
  // multipart byteranges, so we only handle `bytes=start-end` / `bytes=start-`
  // / `bytes=-suffix`.
  if (rangeHeader && /^bytes=/.test(rangeHeader)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      const startRaw = m[1];
      const endRaw = m[2];
      let start: number;
      let end: number;
      if (startRaw === "" && endRaw !== "") {
        // suffix: last N bytes
        const suffix = Number(endRaw);
        start = Math.max(0, size - suffix);
        end = size - 1;
      } else if (startRaw !== "" && endRaw === "") {
        start = Number(startRaw);
        end = size - 1;
      } else {
        start = Number(startRaw);
        end = Number(endRaw);
      }
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end >= size ||
        start > end
      ) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
        });
      }
      const chunkSize = end - start + 1;
      const nodeStream = createReadStream(proxyPath, { start, end });
      return new Response(toWebStream(nodeStream), {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }
  }

  // No Range — declare Range support so the browser can issue subsequent
  // seek requests via Range. Full body stream.
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Content-Length": String(size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
  const nodeStream: ReadStream = createReadStream(proxyPath);
  return new Response(toWebStream(nodeStream), { status: 200, headers });
}

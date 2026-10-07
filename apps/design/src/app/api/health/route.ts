import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    app: "design",
    director: {
      run: "/api/design/run",
      image: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
    },
    ts: Date.now(),
  });
}

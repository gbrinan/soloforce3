/**
 * Template Folders API
 * GET  /api/v1/folders - 폴더 목록 조회
 * POST /api/v1/folders - 새 폴더 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

// 폴더 생성 스키마
const CreateFolderSchema = z.object({
  name: z.string().min(1, "폴더 이름은 필수입니다"),
  parentFolderId: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const folders = await prisma.templateFolder.findMany({
      where: {
        accountId,
        archivedAt: null,
      },
      include: {
        _count: { select: { templates: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ data: folders });
  } catch (error) {
    console.error("폴더 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "폴더 목록을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateFolderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { id: userId, accountId } = session.user;

    const folder = await prisma.templateFolder.create({
      data: {
        name: parsed.data.name,
        parentFolderId: parsed.data.parentFolderId,
        authorId: userId,
        accountId,
      },
    });

    return NextResponse.json({ data: folder }, { status: 201 });
  } catch (error) {
    console.error("폴더 생성 실패:", error);
    return NextResponse.json(
      { error: "폴더를 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * Template Detail API
 * GET    /api/v1/templates/:id - 단일 템플릿 조회
 * DELETE /api/v1/templates/:id - 템플릿 삭제
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;

    const template = await prisma.template.findFirst({
      where: { id, accountId },
      include: {
        author: { select: { id: true, firstName: true, email: true } },
        folder: { select: { id: true, name: true } },
        _count: { select: { submissions: true } },
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: template });
  } catch (error) {
    console.error("템플릿 조회 실패:", error);
    return NextResponse.json(
      { error: "템플릿을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;
    const body = await request.json();

    const template = await prisma.template.findFirst({
      where: { id, accountId },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const updated = await prisma.template.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.documents !== undefined && { documents: body.documents }),
        ...(body.schema !== undefined && { schema: body.schema }),
        ...(body.preferences !== undefined && { preferences: body.preferences }),
      },
      include: {
        author: { select: { id: true, firstName: true, email: true } },
        folder: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("템플릿 수정 실패:", error);
    return NextResponse.json(
      { error: "템플릿을 수정하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const { id } = await params;

    const template = await prisma.template.findFirst({
      where: { id, accountId },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    await prisma.template.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("템플릿 삭제 실패:", error);
    return NextResponse.json(
      { error: "템플릿을 삭제하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

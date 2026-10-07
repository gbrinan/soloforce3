/**
 * Templates API
 * GET  /api/v1/templates - 템플릿 목록 조회
 * POST /api/v1/templates - 새 템플릿 생성
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

// 템플릿 생성 스키마
const CreateTemplateSchema = z.object({
  name: z.string().min(1, "템플릿 이름은 필수입니다"),
  folderId: z.string().optional().transform(v => v || undefined),
  source: z.enum(["NATIVE", "API", "IMPORT"]).optional().default("NATIVE"),
  schema: z.any().optional().default([]),
  documents: z.any().optional().default([]),
  preferences: z.any().optional().default({}),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || "";
    const folderId = searchParams.get("folderId");
    const archived = searchParams.get("archived") === "true";

    const where: Record<string, unknown> = {
      accountId,
      ...(archived
        ? { archivedAt: { not: null } }
        : { archivedAt: null }),
      ...(search && {
        name: { contains: search, mode: "insensitive" as const },
      }),
      ...(folderId && { folderId }),
    };

    const [templates, total] = await Promise.all([
      prisma.template.findMany({
        where,
        include: {
          author: { select: { id: true, firstName: true, email: true } },
          folder: { select: { id: true, name: true } },
          _count: { select: { submissions: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.template.count({ where }),
    ]);

    return NextResponse.json({
      data: templates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("템플릿 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "템플릿 목록을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { id: userId, accountId } = session.user;

    const template = await prisma.template.create({
      data: {
        name: parsed.data.name,
        source: parsed.data.source,
        schema: parsed.data.schema,
        documents: parsed.data.documents,
        preferences: parsed.data.preferences,
        folderId: parsed.data.folderId || undefined,
        authorId: userId,
        accountId,
      },
      include: {
        author: { select: { id: true, firstName: true, email: true } },
        folder: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (error) {
    console.error("템플릿 생성 실패:", error);
    return NextResponse.json(
      { error: "템플릿을 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

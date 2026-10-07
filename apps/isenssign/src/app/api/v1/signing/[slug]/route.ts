/**
 * Public Signing API (인증 불필요)
 * GET  /api/v1/signing/:slug - 서명 페이지 데이터 조회 (submitter slug 기준)
 * POST /api/v1/signing/:slug - 서명 제출
 * PATCH /api/v1/signing/:slug - 서명 거절
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

// ---------------------------------------------------------------------------
// GET — 서명 페이지에 필요한 데이터 반환
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const submitter = await prisma.submitter.findUnique({
      where: { slug },
      include: {
        submission: {
          include: {
            template: {
              select: {
                id: true,
                name: true,
                schema: true,
                documents: true,
              },
            },
            createdBy: {
              select: { firstName: true, email: true },
            },
          },
        },
      },
    });

    if (!submitter) {
      return NextResponse.json(
        { error: "서명 요청을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const { submission } = submitter;

    // 만료 확인
    if (submission.expiresAt && new Date(submission.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "서명 요청이 만료되었습니다" },
        { status: 410 }
      );
    }

    // 이미 완료/거절된 경우
    if (submitter.status === "COMPLETED") {
      return NextResponse.json(
        { error: "이미 서명이 완료되었습니다", status: submitter.status },
        { status: 409 }
      );
    }
    if (submitter.status === "DECLINED") {
      return NextResponse.json(
        { error: "이미 서명이 거절되었습니다", status: submitter.status },
        { status: 409 }
      );
    }

    // openedAt 업데이트 (첫 열람 시)
    if (!submitter.openedAt) {
      await prisma.submitter.update({
        where: { id: submitter.id },
        data: {
          openedAt: new Date(),
          status: "OPENED",
        },
      });
      // submitter event
      await prisma.submitterEvent.create({
        data: {
          submitterId: submitter.id,
          eventType: "opened",
        },
      });
    }

    // 서명 필드 (template.schema에서 이 submitter의 role에 해당하는 것만)
    const allFields = Array.isArray(submission.template.schema)
      ? (submission.template.schema as Record<string, unknown>[])
      : [];
    const myFields = allFields.filter(
      (f) => !f.signerRole || f.signerRole === submitter.role
    );

    // 기존에 입력한 값
    const values = (submitter.values ?? {}) as Record<string, unknown>;

    return NextResponse.json({
      data: {
        submitter: {
          id: submitter.id,
          name: submitter.name,
          email: submitter.email,
          role: submitter.role,
          status: submitter.status,
          verificationMethod: submitter.verificationMethod,
        },
        submission: {
          id: submission.id,
          status: submission.status,
          expiresAt: submission.expiresAt,
        },
        template: {
          name: submission.template.name,
          documents: submission.template.documents,
        },
        sender: {
          name: submission.createdBy.firstName ?? submission.createdBy.email,
        },
        fields: myFields,
        values,
      },
    });
  } catch (error) {
    console.error("서명 페이지 조회 실패:", error);
    return NextResponse.json(
      { error: "서명 페이지를 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — 서명 제출
// ---------------------------------------------------------------------------

const SubmitSigningSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const parsed = SubmitSigningSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다" },
        { status: 400 }
      );
    }

    const submitter = await prisma.submitter.findUnique({
      where: { slug },
      include: {
        submission: {
          include: {
            submitters: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!submitter) {
      return NextResponse.json(
        { error: "서명 요청을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    if (submitter.status === "COMPLETED" || submitter.status === "DECLINED") {
      return NextResponse.json(
        { error: "이미 처리된 서명 요청입니다" },
        { status: 409 }
      );
    }

    // submitter 업데이트
    await prisma.submitter.update({
      where: { id: submitter.id },
      data: {
        values: parsed.data.values as Record<string, string>,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    // submitter event
    await prisma.submitterEvent.create({
      data: {
        submitterId: submitter.id,
        eventType: "signed",
        data: { fieldCount: Object.keys(parsed.data.values).length },
      },
    });

    // 모든 서명자 완료 확인 → submission 완료 처리
    const allSubmitters = submitter.submission.submitters;
    const othersCompleted = allSubmitters
      .filter((s) => s.id !== submitter.id)
      .every((s) => s.status === "COMPLETED");

    if (othersCompleted) {
      await prisma.submission.update({
        where: { id: submitter.submission.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
      await prisma.submissionEvent.create({
        data: {
          submissionId: submitter.submission.id,
          eventType: "completed",
        },
      });
    } else {
      // 아직 미완료 서명자 있으면 ACTIVE로 업데이트
      if (submitter.submission.status === "PENDING") {
        await prisma.submission.update({
          where: { id: submitter.submission.id },
          data: { status: "ACTIVE" },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "서명이 완료되었습니다",
    });
  } catch (error) {
    console.error("서명 제출 실패:", error);
    return NextResponse.json(
      { error: "서명을 제출하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — 서명 거절
// ---------------------------------------------------------------------------

const DeclineSchema = z.object({
  reason: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const parsed = DeclineSchema.safeParse(body);

    const submitter = await prisma.submitter.findUnique({
      where: { slug },
      include: { submission: true },
    });

    if (!submitter) {
      return NextResponse.json(
        { error: "서명 요청을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    if (submitter.status === "COMPLETED" || submitter.status === "DECLINED") {
      return NextResponse.json(
        { error: "이미 처리된 서명 요청입니다" },
        { status: 409 }
      );
    }

    await prisma.submitter.update({
      where: { id: submitter.id },
      data: {
        status: "DECLINED",
        declinedAt: new Date(),
        metadata: {
          ...(submitter.metadata as Record<string, unknown>),
          declineReason: parsed.success ? parsed.data.reason : undefined,
        },
      },
    });

    await prisma.submitterEvent.create({
      data: {
        submitterId: submitter.id,
        eventType: "declined",
        data: { reason: parsed.success ? parsed.data.reason : undefined },
      },
    });

    return NextResponse.json({
      success: true,
      message: "서명이 거절되었습니다",
    });
  } catch (error) {
    console.error("서명 거절 실패:", error);
    return NextResponse.json(
      { error: "서명을 거절하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

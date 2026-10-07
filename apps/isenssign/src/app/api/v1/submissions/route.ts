/**
 * Submissions API
 * GET  /api/v1/submissions - 서명 요청 목록 조회
 * POST /api/v1/submissions - 새 서명 요청 생성 + 알림 발송
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const CreateSubmissionSchema = z.object({
  templateId: z.string().min(1),
  submitterOrder: z.enum(["RANDOM", "SEQUENTIAL"]).default("RANDOM"),
  expiresAt: z.string().datetime().optional(),
  submitters: z.array(
    z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      name: z.string().min(1, "서명자 이름은 필수입니다"),
      role: z.string().default("Signer"),
      notificationChannel: z.enum(["email", "kakao", "sms"]).default("email"),
      verificationMethod: z
        .enum(["NONE", "EMAIL", "SMS", "KAKAO_CERT", "NAVER_CERT", "TOSS_CERT"])
        .default("NONE"),
    })
  ).min(1, "최소 1명의 서명자가 필요합니다"),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { accountId } = session.user;

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {
      accountId,
      ...(status && status !== "ALL" && { status }),
    };

    const [submissions, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        include: {
          template: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, email: true } },
          submitters: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              status: true,
              completedAt: true,
              verificationMethod: true,
              verifiedAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.submission.count({ where }),
    ]);

    return NextResponse.json({
      data: submissions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("서명 요청 목록 조회 실패:", error);
    return NextResponse.json(
      { error: "서명 요청 목록을 불러오는데 실패했습니다" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateSubmissionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { templateId, submitterOrder, expiresAt, submitters } = parsed.data;

    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const { id: userId, accountId } = session.user;

    // 템플릿 존재 확인 (same account only)
    const template = await prisma.template.findFirst({
      where: { id: templateId, accountId },
    });

    if (!template) {
      return NextResponse.json(
        { error: "템플릿을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // 서명 요청 + 서명자 일괄 생성
    const submission = await prisma.submission.create({
      data: {
        templateId,
        submitterOrder,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        accountId,
        createdById: userId,
        submitters: {
          create: submitters.map((s) => ({
            name: s.name,
            email: s.email,
            phone: s.phone,
            role: s.role,
            verificationMethod: s.verificationMethod as never,
          })),
        },
        submissionEvents: {
          create: {
            eventType: "created",
            data: { submitterCount: submitters.length },
          },
        },
      },
      include: {
        template: { select: { id: true, name: true } },
        submitters: true,
      },
    });

    // TODO: 각 서명자에게 알림 발송 (이메일 or 카카오 알림톡)
    // for (const submitter of submission.submitters) {
    //   const signingUrl = `${process.env.NEXTAUTH_URL}/s/${submitter.slug}`;
    //   const channel = submitters.find(s => s.name === submitter.name)?.notificationChannel;
    //   if (channel === 'kakao' && submitter.phone) {
    //     await alimtalkClient.sendSigningRequest(submitter.phone, ...);
    //   } else if (submitter.email) {
    //     await sendSigningRequestEmail({ to: submitter.email, ... });
    //   }
    // }

    return NextResponse.json({ data: submission }, { status: 201 });
  } catch (error) {
    console.error("서명 요청 생성 실패:", error);
    return NextResponse.json(
      { error: "서명 요청을 생성하는데 실패했습니다" },
      { status: 500 }
    );
  }
}

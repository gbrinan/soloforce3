/**
 * Registration API
 * POST /api/auth/register
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const RegisterSchema = z.object({
  firstName: z.string().min(1, "이름은 필수입니다"),
  email: z.string().email("유효한 이메일 주소를 입력해주세요"),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { firstName, email, password } = parsed.data;

    // Lazy imports to avoid build-time errors
    const { getPrisma } = await import("@/lib/db");
    const bcrypt = await import("bcryptjs");

    const prisma = getPrisma();

    // Check for duplicate email
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "이미 사용 중인 이메일입니다" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create Account, User, and default TemplateFolder in a transaction
    const result = await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      const account = await tx.account.create({
        data: {
          name: `${firstName}의 워크스페이스`,
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          firstName,
          passwordHash,
          accountId: account.id,
          role: "ADMIN",
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          role: true,
          accountId: true,
          createdAt: true,
        },
      });

      await tx.templateFolder.create({
        data: {
          name: "Default",
          accountId: account.id,
          authorId: user.id,
        },
      });

      return user;
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    console.error("회원가입 실패:", error);
    return NextResponse.json(
      { error: "회원가입에 실패했습니다" },
      { status: 500 }
    );
  }
}

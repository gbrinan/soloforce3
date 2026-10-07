/**
 * NextAuth.js configuration
 * CredentialsProvider with JWT session strategy
 */
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// Extend NextAuth types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      accountId: string;
      role: string;
    };
  }

  interface User {
    id: string;
    email: string;
    firstName: string;
    accountId: string;
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    accountId: string;
    role: string;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        ssoToken: { label: "SSO Token", type: "text" },
      },
      async authorize(credentials) {
        // Lazy imports to avoid build-time errors
        const { getPrisma } = await import("@/lib/db");

        // SSO token flow — verify with host and auto-login
        if (credentials?.ssoToken) {
          try {
            const hostUrl = process.env.MYCREW_HOST_URL || "http://localhost:3457";
            const verifyRes = await fetch(`${hostUrl}/api/sso/verify-token`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: credentials.ssoToken }),
            });

            if (!verifyRes.ok) {
              console.error("[SSO] Token verification failed:", verifyRes.status);
              return null;
            }

            const verifyData = await verifyRes.json();
            if (!verifyData.valid || !verifyData.email) {
              return null;
            }

            // JIT Provisioning: SSO 검증 통과 = 신뢰된 호스트 사용자
            // → 첫 로그인 시 자동 user 생성 (default account에 귀속)
            const prisma = getPrisma();

            let defaultAccount = await prisma.account.findFirst({
              orderBy: { createdAt: "asc" },
            });
            if (!defaultAccount) {
              defaultAccount = await prisma.account.create({
                data: { name: "Default" },
              });
            }

            const emailLocal = verifyData.email.split("@")[0] || "user";
            const fallbackFirstName = verifyData.name || emailLocal;

            const user = await prisma.user.upsert({
              where: { email: verifyData.email },
              update: {},
              create: {
                email: verifyData.email,
                firstName: fallbackFirstName,
                role: "MEMBER",
                accountId: defaultAccount.id,
              },
              select: {
                id: true,
                email: true,
                firstName: true,
                accountId: true,
                role: true,
              },
            });

            return {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              accountId: user.accountId,
              role: user.role,
            };
          } catch (err) {
            console.error("[SSO] Authorization error:", err);
            return null;
          }
        }

        // Standard email/password flow
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const bcrypt = await import("bcryptjs");
        const prisma = getPrisma();
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          select: {
            id: true,
            email: true,
            firstName: true,
            passwordHash: true,
            accountId: true,
            role: true,
          },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          accountId: user.accountId,
          role: user.role,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.accountId = user.accountId;
        token.role = user.role;
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.userId,
        accountId: token.accountId,
        role: token.role,
      };
      return session;
    },
  },

  pages: {
    signIn: "/ko/login",
    error: "/ko/login",
  },

  secret: process.env.NEXTAUTH_SECRET,
};

/**
 * Auth guard helpers for API routes
 */
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

/**
 * Get the current auth session (or null if not authenticated).
 */
export async function getAuthSession() {
  return getServerSession(authOptions);
}

/**
 * Require authentication. Returns the session or throws a 401 NextResponse.
 * Usage:
 *   const session = await requireAuth();
 *   if (session instanceof NextResponse) return session;
 */
export async function requireAuth() {
  const session = await getAuthSession();

  if (!session?.user) {
    return NextResponse.json(
      { error: "인증이 필요합니다" },
      { status: 401 }
    );
  }

  return session;
}

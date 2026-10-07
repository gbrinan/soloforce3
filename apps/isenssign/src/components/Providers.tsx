"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  // 호스트 iframe은 이 앱을 same-origin 프록시(/api/apps/sign/proxy/)로 임베드한다.
  // NextAuth v4 클라이언트는 Next basePath를 자동 상속하지 않으므로, SessionProvider
  // basePath를 프록시 프리픽스에 맞춰야 signIn/signOut/useSession 요청이
  // /api/apps/sign/proxy/api/auth/* 로 나간다. 미설정 시 /api/auth/* (호스트 루트)로
  // 빠져 404 → 세션 조회 실패로 앱이 떴다가 인증 깨짐. (NEXT_PUBLIC_BASE_PATH는 빌드 인라인)
  const authBasePath = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`;
  return <SessionProvider basePath={authBasePath}>{children}</SessionProvider>;
}

"use client";

import { useEffect, useRef } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

/**
 * SSOReceiver — iframe 내에서 호스트의 SSO 토큰을 받아 자동 로그인
 * AppHostFrame에서 postMessage로 전달한 auth.token을 수신
 */
export default function SSOReceiver() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const readySentRef = useRef(false);

  // 무한 루프 방지: 이미 로그인된 상태면 토큰 수신 무시
  useEffect(() => {
    if (status !== "unauthenticated") return;

    const handler = async (e: MessageEvent) => {
      // Origin 검증 — 호스트(부모 창)로부터만 허용
      const allowedOrigins = [
        "http://localhost:3457",
        "https://mycrew.doitspace.com",
        window.location.origin, // Same-origin proxy 경우
      ];

      if (!allowedOrigins.includes(e.origin)) {
        return;
      }

      const data = e.data;
      if (!data || data.source !== "mycrew-host") return;
      if (data.type !== "auth.token") return;

      // 호스트(AppHostFrame)는 payload로 { ssoToken, googleIdToken } 객체를 보낸다.
      // (구버전 호환: 문자열로 온 경우도 그대로 토큰으로 취급)
      const raw = data.payload;
      const ssoToken = typeof raw === "string" ? raw : raw?.ssoToken;
      if (typeof ssoToken !== "string" || !ssoToken) {
        console.warn("[SSOReceiver] Invalid SSO token payload");
        return;
      }

      console.log("[SSOReceiver] Received SSO token, attempting auto-login...");

      try {
        const result = await signIn("credentials", {
          ssoToken,
          redirect: false,
        });

        if (result?.ok) {
          console.log("[SSOReceiver] Auto-login successful");
          router.refresh();
        } else {
          console.error("[SSOReceiver] Auto-login failed:", result?.error);
        }
      } catch (err) {
        console.error("[SSOReceiver] signIn error:", err);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [status, router]);

  // 호스트에 ready 신호 전송 (인증 안 된 상태에서만, 1회만)
  useEffect(() => {
    if (status === "loading" || readySentRef.current) return;
    if (status === "authenticated") return;

    const sendReady = () => {
      if (window.parent && window.parent !== window) {
        const hostOrigin = process.env.NEXT_PUBLIC_MYCREW_HOST_ORIGIN || document.referrer.split("/").slice(0, 3).join("/") || "http://localhost:3457";
        window.parent.postMessage(
          { source: "mycrew-isenssign", type: "app.ready" },
          hostOrigin
        );
        readySentRef.current = true;
      }
    };

    if (document.readyState === "complete") {
      sendReady();
    } else {
      window.addEventListener("load", sendReady);
      return () => window.removeEventListener("load", sendReady);
    }
  }, [status]);

  return null;
}

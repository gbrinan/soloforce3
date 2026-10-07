"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { ApiError } from "@/lib/api";

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  refetch: () => void;
}

/**
 * Generic hook for API calls.
 *
 * @param fetcher - Async function that returns data.
 * @param deps - Primitive dependency values that trigger a refetch when changed.
 *
 * @example
 * ```tsx
 * const { data, loading, error, refetch } = useApi(
 *   () => fetchTemplates({ search }),
 *   [search]
 * );
 * ```
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = []
): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  // iframe SSO 자동 로그인 레이스 방지 — 세션 확인 중에는 페치를 보류하고(첫 화면에
  // 401 에러 대신 스켈레톤 유지), 자동 로그인으로 인증 상태가 되면 자동 재페치한다.
  const { status: sessionStatus } = useSession();
  const sessionLoading = sessionStatus === "loading";
  const authed = sessionStatus === "authenticated";

  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const authedRef = useRef(authed);
  authedRef.current = authed;
  const authWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const execute = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetcherRef
      .current()
      .then((data) => {
        if (authWaitTimerRef.current) {
          clearTimeout(authWaitTimerRef.current);
          authWaitTimerRef.current = null;
        }
        if (mountedRef.current) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        // SSO 자동 로그인 완료 전의 401은 에러로 확정하지 않고 로딩을 유지한다
        // (로그인되면 자동 재페치). 8초 내 로그인이 안 되면 실제 에러로 표시.
        if (err instanceof ApiError && err.status === 401 && !authedRef.current) {
          if (!authWaitTimerRef.current) {
            authWaitTimerRef.current = setTimeout(() => {
              if (mountedRef.current && !authedRef.current) {
                setState({ data: null, loading: false, error: err });
              }
            }, 8000);
          }
          return;
        }
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    // 인증 전환(자동 로그인 완료) 시 execute 정체성이 바뀌어 자동 재페치된다.
  }, [...deps, authed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    if (!sessionLoading) execute();
    return () => {
      mountedRef.current = false;
      if (authWaitTimerRef.current) {
        clearTimeout(authWaitTimerRef.current);
        authWaitTimerRef.current = null;
      }
    };
  }, [execute, sessionLoading]);

  return { ...state, refetch: execute };
}

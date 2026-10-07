import { useEffect, useRef, useCallback } from 'react';

type SSEHandler = (data: any) => void;

export function useSSE(handlers: Record<string, SSEHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const es = new EventSource('/api/events');

    const onEvent = (type: string) => (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        handlersRef.current[type]?.(data);
      } catch { /* skip */ }
    };

    const eventTypes = [
      'connected', 'chat-stream', 'chat', 'chat-update', 'notification',
      'job-update', 'job-complete-toast', 'job-log', 'todo-update',
      'approval-request', 'approval-resolved', 'approval-opinion', 'tool-approval',
      'genie-status', 'genie-progress', 'genie-queue', 'owner-away', 'staff-change', 'stream-restore',
      'external-message', 'human-chat', 'workflow-approval',
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, onEvent(type));
    }

    es.onerror = () => {
      handlersRef.current['error']?.({});
      // SSE 연결 실패 시 세션 만료 여부 확인 — 401 + { login } 이면 재로그인 유도
      fetch('/auth/me').then(async (res) => {
        if (res.status === 401) {
          try {
            const body = await res.json();
            if (body?.login) {
              window.location.href = body.login;
            }
          } catch { /* body 파싱 실패 무시 */ }
        }
      }).catch(() => { /* 네트워크 오류 — 무시 */ });
    };

    return () => es.close();
  }, []);
}

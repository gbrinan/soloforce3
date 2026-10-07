import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage } from '../utils/api';
import { fetchChatHistory, sendChatMessage, uploadFiles } from '../utils/api';

export interface StreamState {
  active: boolean;
  completed: boolean;
  text: string;
  progress: string;
  startTime: number;
}

export function useChat(browserId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState<StreamState>({
    active: false, completed: false, text: '', progress: '', startTime: 0,
  });
  const streamTextRef = useRef('');
  // messagesRef: 폴링 fallback에서 의존성 [] useEffect로 최신 길이 비교용 (P2-1).
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const loadHistory = useCallback(async () => {
    const msgs = await fetchChatHistory();
    setMessages(msgs.filter(m => !m.content.includes('<!--RECONNECTING-->')));
    // 히스토리 로드 후 하단 스크롤 (렌더링 완료 보장)
    const scrollToEnd = () => {
      const el = document.querySelector('.chat');
      if (el) el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(() => {
      scrollToEnd();
      // 마크다운 렌더링/이미지 로드로 높이 변경될 수 있어 2차 스크롤
      setTimeout(scrollToEnd, 300);
    });
  }, []);

  const handleStreamChunk = useCallback((data: { chunk: string; browserId?: string }) => {
    if (data.browserId && data.browserId !== browserId) return;

    const chunk = data.chunk;
    // 태그 필터링
    const visible = chunk.replace(/<!--[\s\S]*?-->/g, '');
    if (!visible) return;

    // CHECKIN 부산물 필터링
    if (/^[\s.!?,;:·무시정상진행대기]+$/.test(visible)) return;

    // 🔧 progress 분리 — 라인별 순차 처리 (텍스트→🔧 순서 보장)
    const wrench = '🔧';
    if (visible.includes(wrench)) {
      const lines = visible.split('\n');
      let latestProgress = '';

      for (const line of lines) {
        if (line.includes(wrench)) {
          latestProgress = line.trim();
          // 도구 호출 감지 → 이전 세그먼트 확정은 서버 chat emit(draftMsg.id)이 담당한다.
          // 여기서 로컬 random-id로 append하면 SSE chat과 이중 표시되므로,
          // 라이브 버퍼만 비운다 (단일 진실원: SSE chat).
          if (streamTextRef.current.trim()) {
            streamTextRef.current = '';
          }
        } else if (line) {
          // 텍스트 라인 → 즉시 streamTextRef에 누적 (🔧 전에 반영)
          streamTextRef.current += (streamTextRef.current ? '\n' : '') + line;
        }
      }

      setStream(prev => ({
        ...prev,
        active: true,
        text: streamTextRef.current,
        ...(latestProgress ? { progress: latestProgress } : {}),
      }));
      return;
    } else {
      streamTextRef.current += visible;
    }

    setStream(prev => ({
      ...prev,
      active: true,
      text: streamTextRef.current,
    }));
  }, [browserId]);

  // SSE 연결/재연결 시 진행 중인 스트림 복원
  // 확정된 중간 메시지는 히스토리(messages)에 이미 있으므로, 현재 세그먼트(마지막 🔧 이후)만 복원
  const handleStreamRestore = useCallback((data: { chunks: string[]; startTime: number }) => {
    if (stream.active) return;
    streamTextRef.current = '';

    const wrench = '🔧';
    for (const chunk of data.chunks) {
      const visible = chunk.replace(/<!--[\s\S]*?-->/g, '');
      if (!visible) continue;
      if (/^[\s.!?,;:·무시정상진행대기]+$/.test(visible)) continue;

      if (visible.includes(wrench)) {
        // 🔧 이전 텍스트는 서버가 히스토리에 저장 완료 → 버림
        streamTextRef.current = '';
      } else {
        streamTextRef.current += visible;
      }
    }

    setStream({
      active: true,
      completed: false,
      text: streamTextRef.current,
      progress: '',
      startTime: data.startTime,
    });
  }, [stream.active]);

  const handleChatEvent = useCallback((data: { id?: string; role: string; content: string; jobs?: any[]; timestamp?: string; browserId?: string; attachments?: string[]; pending?: boolean }) => {
    // user 메시지는 send()에서 optimistic으로 이미 화면에 추가되고
    // POST 응답(queued ack)이 optimistic id를 서버 id로 교체한다.
    // SSE chat이 ack보다 먼저 도착하면 서버 id로 dedup이 실패해 append → 중복 표시.
    // 자기 브라우저가 보낸 user 메시지에 한해 SSE chat 이벤트를 무시한다.
    // (genie 답변은 자기 브라우저도 SSE로 받아야 한다 — 78ed5f2의 의도 유지)
    if (data.role === 'user' && data.browserId && data.browserId === browserId) return;
    // SSE chat 이벤트를 단일 진실원으로 사용한다 (서버가 부여한 id 기준).
    // 같은 id가 이미 있으면 (POST 응답이 먼저 넣었거나 중복 emit) 내용/jobs만 reconcile, 없으면 append.
    const msg: ChatMessage = {
      id: data.id || crypto.randomUUID(),
      role: data.role as 'user' | 'genie',
      content: data.content,
      timestamp: data.timestamp || new Date().toISOString(),
      jobs: data.jobs,
      attachments: data.attachments,
      ...(data.pending ? { pending: true } : {}),
    };
    setMessages(prev => {
      // RECONNECTING indicator 제거 (마이크루 응답 도착 시)
      const base = data.role === 'genie'
        ? prev.filter(m => !m.content.includes('<!--RECONNECTING-->'))
        : prev;
      // id dedup: 이미 존재하면 갱신(중복 표시 방지), 없으면 append
      const idx = data.id ? base.findIndex(m => m.id === data.id) : -1;
      if (idx >= 0) {
        const next = base.slice();
        next[idx] = { ...next[idx], ...msg };
        return next;
      }
      return [...base, msg];
    });
  }, [browserId]);

  // RECONNECTING indicator를 messages에서 제거 (재연결 성공 시 호출)
  const clearReconnecting = useCallback(() => {
    setMessages(prev => prev.filter(m => !m.content.includes('<!--RECONNECTING-->')));
  }, []);

  // 큐 처리 시 사전 등록된 user msg의 pending 해제 등 message 갱신용.
  const handleChatUpdate = useCallback((data: { id?: string; timestamp?: string; pending?: boolean }) => {
    setMessages(prev => prev.map(m => {
      const match = data.id ? m.id === data.id : m.timestamp === data.timestamp;
      return match ? { ...m, ...(data.pending !== undefined ? { pending: data.pending } : {}) } : m;
    }));
  }, []);

  const send = useCallback(async (message: string, files?: File[]) => {
    if (!message.trim() && (!files || !files.length)) return;
    setLoading(true);

    // YouTube URL 감지 → 즉시 로딩 카드 표시 후 API 응답 시 교체 (30초 timeout)
    const ytMatch = message.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (ytMatch) {
      const loadingMsgId = crypto.randomUUID();
      setMessages(prev => [...prev, {
        id: loadingMsgId,
        role: 'genie' as const,
        content: `<!--VIDEO_SUMMARY:${JSON.stringify({ url: ytMatch[0], loading: true })}-->`,
        timestamp: new Date().toISOString(),
      }]);
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 30000);
      void fetch('/api/video/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ytMatch[0] }),
        signal: controller.signal,
      }).then(r => r.json() as Promise<{ videoId?: string; shortSummary?: string; transcript?: string; hasTranscript?: boolean; error?: string }>).then((data) => {
        clearTimeout(tid);
        setMessages(prev => prev.map(m => m.id === loadingMsgId ? {
          ...m,
          content: `<!--VIDEO_SUMMARY:${JSON.stringify({ url: ytMatch[0], videoId: data.videoId, shortSummary: data.shortSummary ?? '', transcript: data.transcript ?? '', hasTranscript: data.hasTranscript ?? false })}-->`,
        } : m));
      }).catch((e) => {
        clearTimeout(tid);
        const isAbort = e instanceof Error && e.name === 'AbortError';
        setMessages(prev => prev.map(m => m.id === loadingMsgId ? {
          ...m,
          content: `<!--VIDEO_SUMMARY:${JSON.stringify({ url: ytMatch[0], hasTranscript: false, error: isAbort ? 'timeout' : 'fetch_failed' })}-->`,
        } : m));
      });
    }

    let attachments: string[] | undefined;
    if (files?.length) {
      try {
        attachments = await uploadFiles(files);
      } catch {
        // 업로드 실패 시 메시지만 전송
      }
    }

    // 사용자 메시지 즉시 표시
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      attachments,
    };
    // 새 전송 시작 — 이전 실패로 남은 RECONNECTING 마커도 함께 제거
    setMessages(prev => [...prev.filter(m => !m.content.includes('<!--RECONNECTING-->')), userMsg]);

    // 스트리밍 시작
    streamTextRef.current = '';
    setStream({ active: true, completed: false, text: '', progress: '', startTime: Date.now() });

    try {
      const reply = await sendChatMessage(message, attachments, browserId);

      // 큐잉 ack
      if ((reply as ChatMessage & { queued?: boolean }).queued) {
        setMessages(prev => prev
          .filter(m => !m.content.includes('<!--RECONNECTING-->'))
          .map(m => m.id === userMsg.id ? { ...m, id: reply.id, pending: true } : m)
        );
        setStream({ active: false, completed: false, text: '', progress: '', startTime: 0 });
        streamTextRef.current = '';
        setLoading(false);
        return;
      }

      // 최종 응답 추가 — 이전 실패로 남은 RECONNECTING 마커도 함께 제거
      const finalContent = streamTextRef.current || reply.content || '';
      if (finalContent.trim()) {
        const finalMsg: ChatMessage = {
          id: reply.id || crypto.randomUUID(),
          role: 'genie' as const,
          content: finalContent.trim(),
          timestamp: reply.timestamp,
          jobs: reply.jobs,
        };
        // SSE chat(genieMsg.id)과 reply.id가 동일하므로 양방향 경쟁 발생 가능.
        // id dedup: 이미 SSE가 넣었으면 갱신, 아니면 append (중복 표시 방지).
        setMessages(prev => {
          const base = prev.filter(m => !m.content.includes('<!--RECONNECTING-->'));
          const idx = reply.id ? base.findIndex(m => m.id === reply.id) : -1;
          if (idx >= 0) {
            const next = base.slice();
            next[idx] = { ...next[idx], ...finalMsg };
            return next;
          }
          return [...base, finalMsg];
        });
      } else {
        // 콘텐츠 없는 성공(스트림 전달 완료 등)에서도 RECONNECTING 마커 정리
        setMessages(prev => prev.filter(m => !m.content.includes('<!--RECONNECTING-->')));
      }
      setStream({ active: false, completed: false, text: '', progress: '', startTime: 0 });
      streamTextRef.current = '';
      setLoading(false);
    } catch {
      // 연결 오류 — 에러 텍스트 대신 디스코드 스타일 typing indicator로 표시(ChatBubble에서 감지).
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'genie' as const,
        content: '<!--RECONNECTING-->',
        timestamp: new Date().toISOString(),
      }]);
      setStream({ active: false, completed: false, text: '', progress: '', startTime: 0 });
      streamTextRef.current = '';
      setLoading(false);
    }
  }, [browserId]);

  // 도구 호출 감지(genie-progress) 시 라이브 스트림 버퍼를 비운다.
  // 세그먼트 확정(messages 반영)은 서버 chat emit(draftMsg.id)이 단일 진실원으로 담당하므로
  // 여기서 로컬 random-id append를 하면 이중 표시된다 → 버퍼/라이브 텍스트만 초기화.
  const flushStreamText = useCallback(() => {
    if (streamTextRef.current.trim()) {
      streamTextRef.current = '';
      setStream(prev => ({ ...prev, text: '' }));
    }
  }, []);

  return {
    messages,
    messagesRef,
    loading,
    stream,
    loadHistory,
    send,
    handleStreamChunk,
    handleStreamRestore,
    handleChatEvent,
    handleChatUpdate,
    flushStreamText,
    clearReconnecting,
    setMessages,
    setStream,
  };
}

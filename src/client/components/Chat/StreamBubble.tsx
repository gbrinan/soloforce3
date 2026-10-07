import React, { useEffect, useMemo, useState } from 'react';
import type { StreamState } from '../../hooks/useChat';
import { renderMarkdown } from '../../utils/markdown';
import { formatTime } from '../../utils/format';
import MarkdownContent from './MarkdownContent';

interface Props {
  stream: StreamState;
}

export default function StreamBubble({ stream }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const html = useMemo(() => renderMarkdown(stream.text), [stream.text]);

  useEffect(() => {
    if (!stream.active || stream.completed) return;
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - stream.startTime) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [stream.active, stream.startTime, stream.completed]);

  useEffect(() => {
    if (stream.completed) {
      const el = document.querySelector('.chat');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [stream.completed]);

  if (!stream.active) return null;
  // 텍스트 없거나 progress 표시 중이면 숨김 (progress = 도구 호출 중 → 텍스트는 이미 메시지로 저장됨)
  if (!stream.text || stream.progress) return null;

  return (
    <>
      {stream.text ? (
        <div className="msg-wrap msg-wrap-genie">
          <div className="msg msg-genie md">
            <MarkdownContent html={html} />
          </div>
          {!stream.completed && (
            <span className="msg-time">
              {elapsed}s{stream.progress ? ` · ${stream.progress}` : ''}
            </span>
          )}
          {stream.completed && <span className="msg-time">{formatTime(new Date())}</span>}
        </div>
      ) : null}
    </>
  );
}

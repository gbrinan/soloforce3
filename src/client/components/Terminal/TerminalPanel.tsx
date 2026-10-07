import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getApprovalToken, loadApprovalToken } from '../../utils/api';
import type { ChatMessage } from '../../utils/api';
import { renderMarkdown } from '../../utils/markdown';
import { useT } from '../../i18n/I18nProvider';

// 로그 블록용 정리: HTML 주석 마커 + 🔧 진행 라인 제거
function cleanForLog(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => !l.includes('🔧'))
    .join('\n')
    .trim();
}

const LogItem = React.memo(function LogItem({ m }: { m: ChatMessage }) {
  const isGenie = m.role === 'genie';
  const clean = useMemo(() => cleanForLog(m.content), [m.content]);
  const html = useMemo(() => (isGenie ? renderMarkdown(clean) : ''), [clean, isGenie]);
  if (!clean) return null;
  if (isGenie) {
    return (
      <div style={{ display: 'flex', gap: 7, marginBottom: 10, fontSize: 'var(--font-m)', color: 'var(--text-secondary)' }}>
        <span style={{ flexShrink: 0 }}>⏺</span>
        <div className="md" style={{ flex: 1, minWidth: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }
  return (
    <div
      style={{
        marginBottom: 10,
        background: 'var(--bg-elevated)',
        borderRadius: 4,
        padding: '5px 9px',
        fontSize: 'var(--font-m)',
        color: 'var(--text-secondary)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {clean}
    </div>
  );
});

export default function TerminalPanel({
  wsPath = '/ws/terminal',
  fontSize,
  messages,
  readOnly = false,
}: {
  wsPath?: string;
  fontSize?: number;
  messages?: ChatMessage[];
  readOnly?: boolean;
}) {
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [logOpen, setLogOpen] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    // 터미널 글자 크기를 코드/메타 토큰(--font-s=12px)에 바인딩한다.
    // 터미널 출력은 본질적으로 코드/로그성이라 --font-s가 의미상 맞다.
    // prop으로 명시 지정 시 그 값 우선, 토큰을 못 읽으면 12px 폴백.
    const termFontSize = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--font-s'),
      10,
    );
    const resolvedFontSize = fontSize ?? (Number.isFinite(termFontSize) ? termFontSize : 12);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: resolvedFontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      // xterm 테마는 CSS 변수를 못 받으므로 마이크루 통합 토큰의 hex를 직접 매핑한다.
      // (기존 Neovim 팔레트 → 영업부 다크: --bg-card/#070D1A, dark.1/#E4E4E4, jarvis.4/#818CF8, elevated/#1B2740)
      theme: {
        background: '#070D1A',
        foreground: '#E4E4E4',
        cursor: '#818CF8',
        selectionBackground: '#1B2740',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    let unmounted = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (unmounted) return;
      let token = getApprovalToken();
      if (!token) {
        await loadApprovalToken();
        token = getApprovalToken();
      }
      if (unmounted) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const ws = new WebSocket(`${proto}//${location.host}${wsPath}${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts = 0;
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (e) => {
        term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer));
      };

      ws.onclose = () => {
        if (unmounted) return;
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;
        const sec = Math.round(delay / 1000);
        term.write(`\r\n\x1b[90m[${tRef.current('terminal.reconnectMsg', { sec })}]\x1b[0m\r\n`);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* */ }
      };
    }

    connect();

    term.onData((data) => {
      if (readOnly) return;  // 읽기 전용(워커 터미널) — 키입력 전송 안 함
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const keepaliveTimer = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20_000);

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    return () => {
      unmounted = true;
      clearInterval(keepaliveTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      observer.disconnect();
      const ws = wsRef.current;
      if (ws) ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, []);

  // 새 메시지 도착 시 로그 블록 맨 아래로 스크롤
  useEffect(() => {
    if (logOpen && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages?.length, logOpen]);

  const xterm = (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        padding: '4px 4px 4px 16px',
        boxSizing: 'border-box',
      }}
    />
  );

  // messages 미전달(예: StaffPanel 임베드) — 기존 동작 그대로
  if (!messages) {
    return (
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {xterm}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div
        style={{
          flex: logOpen ? '0 0 38%' : '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <div
          onClick={() => setLogOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 12px 7px 16px',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            background: 'var(--bg-surface)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, color: 'var(--text-primary)' }}>
            {logOpen ? '▾' : '▸'}
          </span>
          <span>{t('terminal.chatLog', { n: messages.length })}</span>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--font-s)', fontWeight: 500, color: 'var(--text-muted)' }}>
            {logOpen ? t('common.collapse') : t('common.expand')}
          </span>
        </div>
        {logOpen && (
          <div
            ref={logRef}
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 8px' }}
          >
            {messages.map((m) => <LogItem key={m.id} m={m} />)}
          </div>
        )}
      </div>
      {xterm}
    </div>
  );
}

import React, { useCallback, useRef, useState } from 'react';
import { Modal, Stack, Group, Text, TextInput, ActionIcon, Badge, Loader, Tooltip } from '@mantine/core';
import { IconSparkles, IconSend, IconFileText, IconBook2 } from '@tabler/icons-react';
import { renderMarkdown } from '../utils/markdown';
import { useT } from '../i18n/I18nProvider';

// Ask MyCrew (P0-①) — 자료실·위키 하이브리드 검색 결과를 근거로 답하는 전역 Q&A.
// 답변은 /api/ai/ask SSE 스트리밍(P0-②)으로 실시간 표시된다.

interface AskSource {
  source: 'library' | 'wiki' | 'corpus';
  title: string;
  snippet: string;
  base?: string;
  relpath?: string;
  locator?: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
}

export default function AskMyCrew({ opened, onClose }: Props) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<AskSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setAnswer('');
    setSources([]);
    setError(null);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let ev: { sources?: AskSource[]; delta?: string; done?: boolean; error?: string };
          try { ev = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          if (ev.sources) setSources(ev.sources);
          if (ev.delta) setAnswer((prev) => prev + ev.delta);
          if (ev.error) setError(ev.error);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [question, loading]);

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      size="lg"
      radius="lg"
      title={
        <Group gap="xs">
          <IconSparkles size={16} color="var(--ring)" />
          <Text fw={600}>{t('ask.title')}</Text>
        </Group>
      }
    >
      <Stack gap="md">
        <TextInput
          size="md"
          placeholder={t('ask.placeholder')}
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void ask(); }}
          rightSection={
            loading
              ? <Loader size={16} />
              : (
                <ActionIcon variant="subtle" onClick={() => void ask()} disabled={!question.trim()} aria-label={t('ask.send')}>
                  <IconSend size={16} />
                </ActionIcon>
              )
          }
          data-autofocus
        />

        {error && <Text size="sm" c="red">{error}</Text>}

        {(answer || loading) && (
          <div
            className="md"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              padding: '10px 14px',
              minHeight: 48,
              maxHeight: '45vh',
              overflowY: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(answer || '…') }}
          />
        )}

        {sources.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={600} c="dimmed">{t('ask.sources')}</Text>
            {sources.map((s, i) => (
              <Group key={i} gap={6} wrap="nowrap">
                {s.source === 'library' ? <IconFileText size={13} /> : <IconBook2 size={13} />}
                <Text size="xs" truncate style={{ flex: 1 }} title={s.locator ?? s.relpath ?? s.title}>{s.title}{s.locator ? ` · ${s.locator}` : ''}</Text>
                <Badge size="xs" variant="outline" color="gray">
                  {s.source === 'corpus' ? '등록 자료' : s.source === 'library' ? t('ask.sourceLibrary') : t('ask.sourceWiki')}
                </Badge>
              </Group>
            ))}
          </Stack>
        )}

        <Text size="xs" c="dimmed">{t('ask.hint')}</Text>
      </Stack>
    </Modal>
  );
}

// 헤더용 버튼 — App.tsx에서 사용
export function AskMyCrewButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <Tooltip label={t('ask.title')} withArrow>
      <button
        type="button"
        onClick={onClick}
        aria-label={t('ask.title')}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-default)',
          borderRadius: 8,
          padding: '4px 8px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--text-primary)',
        }}
      >
        <IconSparkles size={16} />
      </button>
    </Tooltip>
  );
}

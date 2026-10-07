import React, { useState, useEffect, useRef } from 'react';
import { Modal, Text, Group, Stack, ScrollArea, Divider } from '@mantine/core';
import { fetchJob } from '../../utils/api';
import type { Job } from '../../utils/api';
import { timeAgo } from '../../utils/format';
import CopyButton from '../CopyButton';
import UrlPreviewList from '../UrlPreview/UrlPreviewList';
import ReportViewer from '../ReportViewer/ReportViewer';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  jobId: string | null;
  onClose: () => void;
}

export default function JobResultModal({ jobId, onClose }: Props) {
  const t = useT();
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!jobId) { setJob(null); setNotFound(false); return; }
    setLoading(true);
    setNotFound(false);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    fetch(`/api/jobs/${jobId}`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then(data => {
        if (data && !ctrl.signal.aborted) { setJob(data); setLoading(false); }
      })
      .catch(() => { if (!ctrl.signal.aborted) setLoading(false); });

    return () => ctrl.abort();
  }, [jobId]);

  const getResultText = (j: Job): string => {
    if (j.fullResult) return j.fullResult;
    const resultLine = j.logs.find(l => l.startsWith('[결과]'));
    if (resultLine) return resultLine.replace(/^\[결과\]\s*/, '');
    const last = j.logs[j.logs.length - 1] || '';
    return last.replace(/^\[.*?\]\s*/, '') || j.error || t('job.noResult');
  };

  const dlFile = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFileClick = async (fp: string, fn: string) => {
    const histIdx = fp.indexOf('history/outputs/');
    const projIdx = fp.indexOf('agentTeam/');
    const dlUrl = histIdx >= 0
      ? '/api/files/download/history/' + fp.slice(histIdx + 'history/outputs/'.length)
      : projIdx >= 0
        ? '/api/files/download/projects/' + fp.slice(projIdx)
        : null;
    if (!dlUrl) return;
    if (fp.endsWith('.md') || fp.endsWith('.txt')) {
      try {
        const res = await fetch(dlUrl);
        if (!res.ok) return;
        const text = await res.text();
        setJob(prev => prev ? { ...prev, fullResult: text } : prev);
      } catch { /* */ }
    } else {
      dlFile(dlUrl, fn);
    }
  };

  const titleText = loading
    ? t('job.loading')
    : notFound
      ? t('job.cleaned')
      : (job?.request || '').slice(0, 100);

  return (
    <Modal
      opened={!!jobId}
      onClose={onClose}
      title={titleText}
      size="auto"
      centered
      scrollAreaComponent={ScrollArea.Autosize}
      classNames={{ content: 'modal-resizable' }}
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      <div className="md">
        {loading && <Text c="dimmed">{t('job.loading')}</Text>}
        {notFound && (
          <Text c="dimmed">
            {t('job.cleanedDesc')}
          </Text>
        )}
        {job && !loading && (
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              {job.agent && <span>{job.agent} · </span>}
              <span>{job.status === 'failed' ? t('job.statusFailed') : job.status === 'completed' ? t('job.statusCompleted') : job.status}</span>
              {job.completedAt && <span> · {timeAgo(job.completedAt)}</span>}
            </Text>
            <Divider />
            <ReportViewer raw={getResultText(job)} fontSize="s" />
            <UrlPreviewList text={getResultText(job)} />
            {job.outputFiles?.length ? (
              <Group gap="xs" wrap="wrap" pt="sm" style={{ borderTop: '1px solid var(--border-default)' }}>
                {job.outputFiles.map((fp, i) => {
                  const fn = fp.split('/').pop() || fp;
                  return (
                    <Group key={i} gap={4} wrap="nowrap">
                      <span
                        style={{ cursor: 'pointer', color: 'var(--accent-info)', fontSize: 'var(--font-s)' }}
                        onClick={() => handleFileClick(fp, fn)}
                      >
                        📥 {fn}
                      </span>
                      <CopyButton text={fp} />
                    </Group>
                  );
                })}
              </Group>
            ) : null}
          </Stack>
        )}
      </div>
    </Modal>
  );
}

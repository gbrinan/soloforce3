import React from 'react';
import { Card, Group, Stack, Text, Button } from '@mantine/core';
import { IconCircleCheckFilled, IconCircleXFilled, IconFileDownload } from '@tabler/icons-react';
import CopyButton from '../CopyButton';
import { useT } from '../../i18n/I18nProvider';

interface ToastData {
  id: string;
  status: string;
  request: string;
  preview?: string;
  error?: string;
  outputFiles?: string[];
}

// Output artifacts live under history/outputs/ and are served inline via the
// existing /api/files/download/history/* route. Image artifacts render as an
// inline preview (like the video card) instead of a bare filename link.
function toImagePreviewUrl(fp: string): string | null {
  if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(fp)) return null;
  const m = fp.match(/\/history\/outputs\/(.+)$/);
  if (!m) return null;
  return '/api/files/download/history/' + m[1].split('/').map(encodeURIComponent).join('/');
}

interface Props {
  data: ToastData;
  onResultClick: (jobId: string) => void;
  onFileClick?: (path: string) => void;
}

export default function CompleteToast({ data, onResultClick, onFileClick }: Props) {
  const t = useT();
  const isFailed = data.status === 'failed';
  const statusText = isFailed ? t('job.statusFailed') : t('job.statusCompleted');
  const accent = isFailed ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-green-6)';

  return (
    <Card
      withBorder
      padding="md"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '90%',
        flexShrink: 0,
        padding: '14px 16px',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <Stack gap="sm">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          {isFailed ? (
            <IconCircleXFilled size={20} style={{ color: accent, flexShrink: 0 }} />
          ) : (
            <IconCircleCheckFilled size={20} style={{ color: accent, flexShrink: 0 }} />
          )}
          <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600} lineClamp={3} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {data.request} — {statusText}
            </Text>
            {data.preview && (
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto' }}>
                {data.preview}
              </Text>
            )}
            {data.outputFiles?.length ? (
              <Stack gap={8} mt={4}>
                {data.outputFiles.map((fp, i) => {
                  const imgUrl = toImagePreviewUrl(fp);
                  return (
                    <Stack key={i} gap={4}>
                      {imgUrl && (
                        <div className="image-zoomable">
                          <img
                            src={imgUrl}
                            alt={fp.split('/').pop() || ''}
                            loading="lazy"
                            style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 10, cursor: 'zoom-in', display: 'block' }}
                          />
                        </div>
                      )}
                      <Group gap={4} wrap="nowrap">
                        <span
                          style={{ cursor: 'pointer', color: 'var(--mantine-color-jarvis-4)', fontSize: 'var(--font-s)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          onClick={(e) => { e.stopPropagation(); onFileClick?.(fp); }}
                        >
                          <IconFileDownload size={14} stroke={1.5} />
                          {fp.split('/').pop()}
                        </span>
                        <CopyButton text={fp} />
                      </Group>
                    </Stack>
                  );
                })}
              </Stack>
            ) : null}
          </Stack>
        </Group>
        <Group justify="flex-end">
          <Button size="xs" onClick={() => onResultClick(data.id)}>
            {t('job.viewResult')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

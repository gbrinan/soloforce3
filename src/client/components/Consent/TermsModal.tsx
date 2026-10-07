import React, { useEffect, useState } from 'react';
import { Modal, ScrollArea, Button, Group, Text, Box } from '@mantine/core';
import { useI18n } from '../../i18n/I18nProvider';

// 약관 본문은 서버 단일 소스(/api/consent/policies/:type, SSO 게이트 면제 GET)에서 가져온다.
export type PolicyDocType = 'terms' | 'privacy' | 'marketing_privacy' | 'marketing_ads';

const TITLE_KEYS: Record<PolicyDocType, string> = {
  terms: 'consent.doc.terms',
  privacy: 'consent.doc.privacy',
  marketing_privacy: 'consent.doc.marketingPrivacy',
  marketing_ads: 'consent.doc.marketingAds',
};

interface Props {
  type: PolicyDocType | null;
  onClose: () => void;
  onAgree: (type: PolicyDocType) => void;
}

export default function TermsModal({ type, onClose, onAgree }: Props) {
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!type) return;
    let cancelled = false;
    setLoading(true);
    setContent('');
    (async () => {
      try {
        const res = await fetch(`/api/consent/policies/${type}`);
        const body = await res.json();
        if (cancelled) return;
        setContent(body.content || body.summary || t('consent.loadFailed'));
        setVersion(body.version || '');
      } catch {
        if (!cancelled) setContent(t('consent.loadFailedNetwork'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [type, t]);

  return (
    <Modal
      opened={type !== null}
      onClose={onClose}
      title={<Text fw={700} size="lg">{type ? t(TITLE_KEYS[type] as Parameters<typeof t>[0]) : ''}</Text>}
      size="lg"
      radius="md"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {version && (
        <Box
          p="xs"
          mb="sm"
          style={{
            background: 'var(--bg-muted)',
            borderRadius: 6,
            fontSize: 'var(--font-s)',
            color: 'var(--text-muted)',
          }}
        >
          {t('consent.versionInfo', { version })}
        </Box>
      )}

      <ScrollArea h={360} style={{ fontSize: 'var(--font-s)', lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
        {loading ? t('consent.loading') : content}
      </ScrollArea>

      <Group justify="flex-end" mt="md">
        <Button variant="subtle" color="gray" onClick={onClose}>{t('common.close')}</Button>
        {type && (
          <Button color="jarvis" onClick={() => onAgree(type)}>{t('consent.agreeAndClose')}</Button>
        )}
      </Group>
    </Modal>
  );
}

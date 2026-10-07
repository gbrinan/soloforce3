import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Text, Group, Button, Card, Badge, Anchor,
} from '@mantine/core';
import { useI18n } from '../../i18n/I18nProvider';
import { CONSENT_VERSION } from '../../utils/consent';

// 별도 약관 화면(서버 정책 문서)이 있는 항목 — 새창 뷰 링크를 노출한다.
const POLICY_DOC_TYPES = new Set<ConsentType>(['terms', 'privacy', 'marketing_privacy', 'marketing_ads']);

// 회원가입 동의 체계와 동일한 8항목 (개인정보 보호법 §15·§22·§22조의2, 정보통신망법 §50)
type ConsentType =
  | 'age' | 'terms' | 'privacy'
  | 'marketing_privacy' | 'marketing_ads' | 'marketing_ads_sms' | 'marketing_ads_push' | 'marketing_ads_email';

const TYPES: ConsentType[] = [
  'age', 'terms', 'privacy', 'marketing_privacy', 'marketing_ads', 'marketing_ads_sms', 'marketing_ads_push', 'marketing_ads_email',
];

const REQUIRED: ConsentType[] = ['age', 'terms', 'privacy'];

const LABEL_KEYS: Record<ConsentType, string> = {
  age: 'settings.consent.age',
  terms: 'settings.consent.terms',
  privacy: 'settings.consent.privacy',
  marketing_privacy: 'settings.consent.marketingPrivacy',
  marketing_ads: 'settings.consent.marketingAds',
  marketing_ads_sms: 'settings.consent.marketingAdsSms',
  marketing_ads_push: 'settings.consent.marketingAdsPush',
  marketing_ads_email: 'settings.consent.marketingAdsEmail',
};

interface ConsentItemStatus {
  agreed: boolean;
  agreedAt?: string;
  version?: string;
}

interface HistoryRecord {
  recordedAt: string;
  items: Array<{ type: string; version: string; agreed: boolean }>;
}

type StatusMap = Partial<Record<ConsentType, ConsentItemStatus>>;

export default function ConsentSettingsPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusMap>({});
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);

  // 항목별 최신 동의 상태·일시: 이력(최신순)에서 타입별 첫 등장 레코드를 취한다.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/consent/history');
      if (!res.ok) return;
      const records = (await res.json()) as HistoryRecord[];
      const next: StatusMap = {};
      for (const rec of records) {
        for (const item of rec.items ?? []) {
          const type = item.type as ConsentType;
          if (!TYPES.includes(type) || next[type]) continue;
          next[type] = { agreed: item.agreed, agreedAt: rec.recordedAt, version: item.version };
        }
      }
      setStatus(next);
    } catch { /* offline */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const getItem = (type: ConsentType): ConsentItemStatus => status[type] ?? { agreed: false };

  // 선택 동의 토글 — 전 항목 스냅샷으로 기록해 레코드 단위 완결성 유지(allRequiredAgreed 판정 보존).
  // 광고성 수신 상위·하위 연동은 가입 화면(ConsentSection)과 동일 규칙.
  const toggleOptional = async (type: ConsentType, agreed: boolean) => {
    const next: Record<ConsentType, boolean> = Object.fromEntries(
      TYPES.map((k) => [k, getItem(k).agreed]),
    ) as Record<ConsentType, boolean>;
    next[type] = agreed;
    if (type === 'marketing_ads') {
      next.marketing_ads_sms = agreed;
      next.marketing_ads_push = agreed;
      next.marketing_ads_email = agreed;
    }
    if (type === 'marketing_ads_sms' || type === 'marketing_ads_push' || type === 'marketing_ads_email') {
      next.marketing_ads = next.marketing_ads_sms || next.marketing_ads_push || next.marketing_ads_email;
    }
    setActionPending(true);
    try {
      const res = await fetch('/api/consent/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: TYPES.map((k) => ({ type: k, version: CONSENT_VERSION, agreed: next[k] })),
        }),
      });
      if (res.ok) await load();
    } catch { /* offline */ } finally {
      setActionPending(false);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  };

  if (loading) return null;

  return (
    <Stack gap="xl">
      <Text size="md" fw={700}>{t('settings.privacy.title')}</Text>

      {/* 동의 현황 — 약관별 동의 여부·동의 일자·버전 */}
      <Stack gap="sm">
        <Text size="sm" fw={600} c="dimmed">{t('settings.privacy.consentStatus')}</Text>

        {TYPES.map((type) => {
          const item = getItem(type);
          const isRequired = REQUIRED.includes(type);
          const isChannel = type === 'marketing_ads_sms' || type === 'marketing_ads_push' || type === 'marketing_ads_email';

          return (
            <Card
              key={type}
              radius="sm"
              p="sm"
              withBorder
              style={{ borderColor: 'var(--border-default)', marginLeft: isChannel ? 20 : 0 }}
            >
              <Group justify="space-between" align="center">
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    <Text span size="xs" fw={600} c={isRequired ? 'red' : 'indigo'} mr={6}>
                      {isRequired ? t('settings.consent.required') : t('settings.consent.optional')}
                    </Text>
                    {POLICY_DOC_TYPES.has(type) ? (
                      <Anchor
                        href={`/api/consent/policies/${type}/view`}
                        target="_blank"
                        rel="noreferrer"
                        underline="hover"
                        c="inherit"
                        style={{ fontWeight: 500 }}
                      >
                        {t(LABEL_KEYS[type] as any)}
                        <Text span c="dimmed" ml={4} aria-hidden>↗</Text>
                      </Anchor>
                    ) : (
                      t(LABEL_KEYS[type] as any)
                    )}
                  </Text>
                  {item.agreed && item.agreedAt ? (
                    <Text size="xs" c="dimmed">
                      {t('settings.privacy.agreed')} · {formatDate(item.agreedAt)}{item.version ? ` · v${item.version}` : ''}
                    </Text>
                  ) : (
                    <Text size="xs" c="dimmed">{t('settings.privacy.notAgreed')}</Text>
                  )}
                </Stack>

                <Group gap="xs" align="center">
                  {item.agreed ? (
                    <>
                      <Badge color="green" variant="light" size="sm">
                        {t('settings.privacy.agreed')}
                      </Badge>
                      {!isRequired && (
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          loading={actionPending}
                          onClick={() => void toggleOptional(type, false)}
                        >
                          {t('settings.privacy.withdraw')}
                        </Button>
                      )}
                    </>
                  ) : (
                    !isRequired && (
                      <Button
                        size="xs"
                        variant="outline"
                        color="jarvis"
                        loading={actionPending}
                        onClick={() => void toggleOptional(type, true)}
                      >
                        {t('settings.privacy.agreeNow')}
                      </Button>
                    )
                  )}
                </Group>
              </Group>
            </Card>
          );
        })}
      </Stack>
    </Stack>
  );
}

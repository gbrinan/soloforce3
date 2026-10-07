import React, { useState } from 'react';
import { Checkbox, Divider, Stack, Text } from '@mantine/core';
import TermsModal, { type PolicyDocType } from './TermsModal';
import { useI18n } from '../../i18n/I18nProvider';

// 국내법 기준 동의 항목 (개인정보 보호법 §15·§22·§22조의2, 정보통신망법 §50)
export interface ConsentState {
  age: boolean;               // [필수] 만 14세 이상
  terms: boolean;             // [필수] 서비스 이용약관
  privacy: boolean;           // [필수] 개인정보 수집·이용
  marketingPrivacy: boolean;  // [선택] 마케팅 목적 개인정보 수집·이용
  marketingAds: boolean;      // [선택] 마케팅·광고성 정보 수신
  adsSms: boolean;            //   └ 문자/카카오 알림톡
  adsPush: boolean;           //   └ 앱 푸시
  adsEmail: boolean;          //   └ 이메일
}

export const EMPTY_CONSENT: ConsentState = {
  age: false, terms: false, privacy: false,
  marketingPrivacy: false, marketingAds: false, adsSms: false, adsPush: false, adsEmail: false,
};

export function allRequiredAgreed(v: ConsentState): boolean {
  return v.age && v.terms && v.privacy;
}

interface Props {
  value: ConsentState;
  onChange: (v: ConsentState) => void;
}

const LABEL_STYLE: React.CSSProperties = { fontSize: 'var(--font-s)', color: 'var(--text-primary)' };

function RequiredTag() {
  const { t } = useI18n();
  return <span style={{ color: 'var(--accent-danger)', fontWeight: 600, marginRight: 4 }}>{t('consent.requiredTag')}</span>;
}
function OptionalTag() {
  const { t } = useI18n();
  return <span style={{ color: 'var(--color-point-1)', fontWeight: 600, marginRight: 4 }}>{t('consent.optionalTag')}</span>;
}

export default function ConsentSection({ value, onChange }: Props) {
  const { t } = useI18n();
  const [modal, setModal] = useState<PolicyDocType | null>(null);

  const allChecked = Object.values(value).every(Boolean);

  const handleAll = (checked: boolean) => {
    onChange({
      age: checked, terms: checked, privacy: checked,
      marketingPrivacy: checked, marketingAds: checked, adsSms: checked, adsPush: checked, adsEmail: checked,
    });
  };

  const set = (patch: Partial<ConsentState>) => {
    const next = { ...value, ...patch };
    // 광고성 수신 상위·하위 연동: 상위 토글 → 채널 일괄, 채널 토글 → 상위는 채널 OR
    if ('marketingAds' in patch) {
      next.adsSms = next.marketingAds;
      next.adsPush = next.marketingAds;
      next.adsEmail = next.marketingAds;
    }
    if ('adsSms' in patch || 'adsPush' in patch || 'adsEmail' in patch) {
      next.marketingAds = next.adsSms || next.adsPush || next.adsEmail;
    }
    onChange(next);
  };

  const viewLink = (doc: PolicyDocType) => (
    <span
      style={{ color: 'var(--color-point-1)', marginLeft: 'auto', cursor: 'pointer', textDecoration: 'underline', fontSize: 'var(--font-s)', flexShrink: 0 }}
      onClick={(e) => { e.preventDefault(); setModal(doc); }}
    >{t('consent.viewDetails')}</span>
  );

  const row = (checkbox: React.ReactNode, view?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{checkbox}</div>
      {view}
    </div>
  );

  return (
    <>
      <Text fw={700} size="md" style={{ color: 'var(--text-primary)', marginBottom: 4 }}>{t('consent.sectionTitle')}</Text>
      <Stack gap={8} style={{ marginBottom: 12 }}>
        <Checkbox
          checked={allChecked}
          indeterminate={allRequiredAgreed(value) && !allChecked}
          onChange={(e) => handleAll(e.currentTarget.checked)}
          label={<span style={{ fontWeight: 600, fontSize: 'var(--font-m)', color: 'var(--text-primary)' }}>{t('consent.agreeAll')}</span>}
          color="jarvis"
        />
        <Divider color="var(--border-default)" />
        <Checkbox
          checked={value.age}
          onChange={(e) => set({ age: e.currentTarget.checked })}
          color="jarvis"
          label={<span style={LABEL_STYLE}><RequiredTag />{t('consent.age')}</span>}
        />
        {row(
          <Checkbox
            checked={value.terms}
            onChange={(e) => set({ terms: e.currentTarget.checked })}
            color="jarvis"
            label={<span style={LABEL_STYLE}><RequiredTag />{t('consent.termsAgree')}</span>}
          />,
          viewLink('terms'),
        )}
        {row(
          <Checkbox
            checked={value.privacy}
            onChange={(e) => set({ privacy: e.currentTarget.checked })}
            color="jarvis"
            label={<span style={LABEL_STYLE}><RequiredTag />{t('consent.privacyAgree')}</span>}
          />,
          viewLink('privacy'),
        )}
        {row(
          <Checkbox
            checked={value.marketingPrivacy}
            onChange={(e) => set({ marketingPrivacy: e.currentTarget.checked })}
            color="jarvis"
            label={<span style={LABEL_STYLE}><OptionalTag />{t('consent.marketingPrivacyAgree')}</span>}
          />,
          viewLink('marketing_privacy'),
        )}
        {row(
          <Checkbox
            checked={value.marketingAds}
            onChange={(e) => set({ marketingAds: e.currentTarget.checked })}
            color="jarvis"
            label={<span style={LABEL_STYLE}><OptionalTag />{t('consent.marketingAdsAgree')}</span>}
          />,
          viewLink('marketing_ads'),
        )}
        <div style={{ paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Checkbox
            checked={value.adsSms}
            onChange={(e) => set({ adsSms: e.currentTarget.checked })}
            color="jarvis"
            size="xs"
            label={<span style={{ ...LABEL_STYLE, color: 'var(--text-secondary)' }}>{t('consent.channelSms')}</span>}
          />
          <Checkbox
            checked={value.adsPush}
            onChange={(e) => set({ adsPush: e.currentTarget.checked })}
            color="jarvis"
            size="xs"
            label={<span style={{ ...LABEL_STYLE, color: 'var(--text-secondary)' }}>{t('consent.channelPush')}</span>}
          />
          <Checkbox
            checked={value.adsEmail}
            onChange={(e) => set({ adsEmail: e.currentTarget.checked })}
            color="jarvis"
            size="xs"
            label={<span style={{ ...LABEL_STYLE, color: 'var(--text-secondary)' }}>{t('consent.channelEmail')}</span>}
          />
        </div>
      </Stack>

      <TermsModal
        type={modal}
        onClose={() => setModal(null)}
        onAgree={(type) => {
          if (type === 'terms') set({ terms: true });
          else if (type === 'privacy') set({ privacy: true });
          else if (type === 'marketing_privacy') set({ marketingPrivacy: true });
          else if (type === 'marketing_ads') set({ marketingAds: true, adsSms: true, adsPush: true, adsEmail: true });
          setModal(null);
        }}
      />
    </>
  );
}

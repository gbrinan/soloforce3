import React, { useEffect, useState } from 'react';
import { Modal, Button, Stack, Group, Text } from '@mantine/core';
import type { PartnerRequest, PartnerRequestRejectReason, PartnerScope } from '../../utils/api';
import { approvePartnerRequest, rejectPartnerRequest, resendPartnerRequestCallback } from '../../utils/api';
import { uiConfirm } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/messages';
import { btn } from '../../ui/controls';

interface Props {
  request: PartnerRequest;
  onAfterAction: () => Promise<void> | void;
}

const REJECT_REASONS: { value: PartnerRequestRejectReason; labelKey: MessageKey }[] = [
  { value: 'out_of_scope', labelKey: 'friend.rejectOutOfScope' },
  { value: 'unknown_company', labelKey: 'friend.rejectUnknownCompany' },
  { value: 'suspicious', labelKey: 'friend.rejectSuspicious' },
  { value: 'scope_too_broad', labelKey: 'friend.rejectScopeBroad' },
  { value: 'other', labelKey: 'friend.rejectOther' },
];

export default function PartnerRequestCard({ request, onAfterAction }: Props) {
  const t = useT();
  const [scope, setScope] = useState<PartnerScope>(request.body.scope ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState<PartnerRequestRejectReason>('out_of_scope');
  const [rejectText, setRejectText] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const updateScope = (patch: Partial<PartnerScope>) => setScope((s) => ({ ...s, ...patch }));

  const remainingMs = new Date(request.expiresAt).getTime() - now;
  const remainingHours = Math.max(0, Math.floor(remainingMs / 1000 / 60 / 60));
  const remainingMin = Math.max(0, Math.floor((remainingMs / 1000 / 60) % 60));

  const onApprove = async () => {
    if (!(await uiConfirm({
      title: t('friend.approveReqConfirm'),
      description: t('friend.approveReqDesc'),
      confirmLabel: t('friend.approve'),
    }))) return;
    setBusy(true); setError(null);
    try {
      const r = await approvePartnerRequest(request.id, scope);
      if (!r.ok) throw new Error(r.error ?? 'approve failed');
      await onAfterAction();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRejectConfirm = async () => {
    setBusy(true); setError(null);
    try {
      const text = rejectReason === 'other' ? rejectText.slice(0, 64) : undefined;
      const r = await rejectPartnerRequest(request.id, rejectReason, text);
      if (!r.ok) throw new Error(r.error ?? 'reject failed');
      setRejectOpen(false);
      await onAfterAction();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setBusy(true); setError(null);
    try {
      const r = await resendPartnerRequestCallback(request.id);
      if (!r.ok) throw new Error(r.error ?? 'resend failed');
      await onAfterAction();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showResend = (request.resultDeliveryAttempts ?? 0) > 0 && request.status === 'pending';

  return (
    <div className="partner-request-card" style={{ padding: 16, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-m)', fontWeight: 600 }}>{t('friend.tradeRequestTitle', { company: request.body.companyName, contact: request.body.contactName })}</h3>
        <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>
          {t('friend.receivedExpiry', { date: new Date(request.receivedAt).toLocaleString(), h: remainingHours, m: remainingMin })}
        </span>
      </div>
      <div style={{ background: 'var(--bg-canvas)', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 'var(--font-s)' }}>
        <div>{t('friend.companyLabel', { value: request.body.companyName })}</div>
        <div>{t('friend.contactLabel', { value: `${request.body.contactName}${request.body.contactEmail ? ` (${request.body.contactEmail})` : ''}` })}</div>
        <div style={{ wordBreak: 'break-all' }}>API URL: {request.body.apiUrl}</div>
        <div>{t('friend.sourceIp', { value: request.sourceIp })}</div>
        <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          {t('friend.statusLabel')}: <strong>{request.status}</strong>
          {request.resultDeliveryAttempts ? t('friend.callbackAttempts', { n: request.resultDeliveryAttempts }) : ''}
        </div>
      </div>

      {request.body.message && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', marginBottom: 4 }}>{t('friend.messageLabel')}</div>
          <pre style={{
            background: 'var(--bg-canvas)', padding: 10, borderRadius: 6, fontSize: 'var(--font-s)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto', margin: 0,
          }}>{request.body.message}</pre>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', marginBottom: 4 }}>{t('friend.scopeAdjust')}</div>
        <div style={{ display: 'flex', gap: 12, fontSize: 'var(--font-s)' }}>
          <label><input type="checkbox" checked={!!scope.canDelegate} onChange={(e) => updateScope({ canDelegate: e.target.checked })} /> {t('friend.canDelegate')}</label>
          <label><input type="checkbox" checked={!!scope.canAccessFiles} onChange={(e) => updateScope({ canAccessFiles: e.target.checked })} /> {t('friend.canShare')}</label>
        </div>
      </div>

      {error && <div style={{ color: 'var(--accent-danger)', fontSize: 'var(--font-s)', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {showResend && (
          <button className="action-btn" style={btn('sm', 'neutral')} disabled={busy} onClick={onResend}>{t('friend.resendCallback')}</button>
        )}
        <button className="action-btn danger" style={btn('sm', 'dangerSubtle')} disabled={busy} onClick={() => setRejectOpen(true)}>{t('friend.rejectBtn')}</button>
        <button className="action-btn primary" style={btn('sm', 'primary')} disabled={busy} onClick={onApprove}>{t('friend.approveBtn')}</button>
      </div>

      <Modal
        opened={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('friend.rejectReasonTitle')}
        size="sm"
        centered
        overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
      >
        <Stack gap="sm">
          <select
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value as PartnerRequestRejectReason)}
            style={{
              width: '100%',
              padding: 8,
              background: 'var(--mantine-color-body)',
              color: 'var(--mantine-color-text)',
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 4,
            }}
          >
            {REJECT_REASONS.map((r) => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
          </select>
          {rejectReason === 'other' && (
            <input
              value={rejectText}
              onChange={(e) => setRejectText(e.target.value)}
              placeholder={t('friend.otherReasonPlaceholder')}
              maxLength={64}
              style={{
                width: '100%',
                padding: 8,
                background: 'var(--mantine-color-body)',
                color: 'var(--mantine-color-text)',
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 4,
              }}
            />
          )}
          <Text size="xs" c="dimmed">
            {t('friend.rejectBlacklist')}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" disabled={busy} onClick={() => setRejectOpen(false)}>{t('common.cancel')}</Button>
            <Button color="jarvis.7" disabled={busy} onClick={onRejectConfirm}>{t('friend.confirmReject')}</Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

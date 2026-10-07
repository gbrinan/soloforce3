import React, { useEffect, useState } from 'react';
import { Modal, Button, Stack, Group, Text } from '@mantine/core';
import type { Partner, CreatePartnerInput } from '../../utils/api';
import { uiConfirm } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';
import {
  createPartner,
  updatePartner,
  deletePartner,
  setPartnerActive,
  rotatePartnerInboundToken,
  rotatePartnerOutboundToken,
} from '../../utils/api';
import { btn } from '../../ui/controls';

interface Props {
  partner: Partner | null;
  onClose: () => void;
  onSaved: (partner: Partner) => void;
  onDeleted?: (id: string) => void;
}

export default function PartnerModal({ partner, onClose, onSaved, onDeleted }: Props) {
  const t = useT();
  const isEdit = !!partner;
  const [form, setForm] = useState<CreatePartnerInput>({
    companyName: partner?.companyName ?? '',
    department: partner?.department ?? '',
    contactName: partner?.contactName ?? '',
    secretaryName: partner?.secretaryName ?? '',
    contactEmail: partner?.contactEmail ?? '',
    contactPhone: partner?.contactPhone ?? '',
    apiUrl: partner?.apiUrl ?? '',
    scope: partner?.scope ?? { canDelegate: false, canAccessFiles: false },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plaintextTokens, setPlaintextTokens] = useState<{ inbound?: string; outbound?: string } | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const update = (patch: Partial<CreatePartnerInput>) => setForm((f) => ({ ...f, ...patch }));
  const updateScope = (patch: Partial<NonNullable<CreatePartnerInput['scope']>>) =>
    setForm((f) => ({ ...f, scope: { ...(f.scope ?? {}), ...patch } }));

  const [saved, setSaved] = useState(false);
  const onSubmit = async () => {
    setBusy(true); setError(null);
    try {
      if (isEdit && partner) {
        const updated = await updatePartner(partner.id, form);
        onSaved(updated);
        setSaved(true);
        setTimeout(() => onClose(), 1000);
      } else {
        const result = await createPartner(form);
        setPlaintextTokens({ inbound: result.inboundToken, outbound: result.outboundToken });
        onSaved(result.partner);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!partner) return;
    if (!(await uiConfirm({
      title: t('partner.deleteConfirm', { name: partner.companyName }),
      variant: 'danger',
      confirmLabel: t('partner.delete'),
    }))) return;
    setBusy(true); setError(null);
    try {
      await deletePartner(partner.id);
      onDeleted?.(partner.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onToggleActive = async () => {
    if (!partner) return;
    setBusy(true); setError(null);
    try {
      const updated = await setPartnerActive(partner.id, !partner.active);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRotateInbound = async () => {
    if (!partner) return;
    if (!(await uiConfirm({
      title: t('partner.rotateInboundTitle'),
      description: t('partner.rotateInboundDesc'),
      variant: 'danger',
      confirmLabel: t('partner.reissue'),
    }))) return;
    setBusy(true); setError(null);
    try {
      const result = await rotatePartnerInboundToken(partner.id);
      onSaved(result.partner);
      setPlaintextTokens((prev) => ({ ...(prev ?? {}), inbound: result.inboundToken }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRotateOutbound = async (notify: boolean) => {
    if (!partner) return;
    if (!(await uiConfirm({
      title: t('partner.rotateOutboundTitle'),
      description: notify ? t('partner.notifyOn') : t('partner.notifyOff'),
      variant: 'danger',
      confirmLabel: t('partner.reissue'),
    }))) return;
    setBusy(true); setError(null);
    try {
      const result = await rotatePartnerOutboundToken(partner.id, { notify });
      onSaved(result.partner);
      setPlaintextTokens((prev) => ({ ...(prev ?? {}), outbound: result.outboundToken }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={isEdit ? t('partner.editTitle') : t('partner.createTitle')}
      size="md"
      centered
      classNames={{ content: 'partner-modal' }}
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      <Stack gap="sm">
          <Field label={t('partner.fieldCompany')}>
            <input value={form.companyName} onChange={(e) => update({ companyName: e.target.value })} placeholder={t('partner.phCompany')} />
          </Field>
          <Field label={t('partner.fieldDepartment')}>
            <input value={form.department ?? ''} onChange={(e) => update({ department: e.target.value })} placeholder={t('partner.phDepartment')} />
          </Field>
          <Field label={t('partner.fieldContact')}>
            <input value={form.contactName} onChange={(e) => update({ contactName: e.target.value })} placeholder={t('partner.phContact')} />
          </Field>
          <Field label={t('partner.fieldSecretary')}>
            <input value={form.secretaryName ?? ''} onChange={(e) => update({ secretaryName: e.target.value })} placeholder={t('partner.phSecretary')} />
          </Field>
          <Field label={t('partner.fieldEmail')}>
            <input value={form.contactEmail ?? ''} onChange={(e) => update({ contactEmail: e.target.value })} placeholder={t('partner.phEmail')} />
          </Field>
          <Field label={t('partner.fieldPhone')}>
            <input value={form.contactPhone ?? ''} onChange={(e) => update({ contactPhone: e.target.value })} />
          </Field>
          <Field label={t('partner.fieldApiUrl')}>
            <input value={form.apiUrl} onChange={(e) => update({ apiUrl: e.target.value })} placeholder="https://partner.example.com" />
          </Field>
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <label style={{ fontSize: 'var(--font-s)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={!!form.scope?.canDelegate} onChange={(e) => updateScope({ canDelegate: e.target.checked })} />
              {t('partner.allowDelegate')}
            </label>
            <label style={{ fontSize: 'var(--font-s)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={!!form.scope?.canAccessFiles} onChange={(e) => updateScope({ canAccessFiles: e.target.checked })} />
              {t('partner.allowShare')}
            </label>
            <label style={{ fontSize: 'var(--font-s)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={!!form.scope?.allowExternalShelfShare} onChange={(e) => updateScope({ allowExternalShelfShare: e.target.checked })} />
              {t('partner.allowExternalShelfShare')}
            </label>
          </div>

          {plaintextTokens && (plaintextTokens.inbound || plaintextTokens.outbound) && (
            <div className="token-warn">
              <div style={{ fontSize: 'var(--font-s)', fontWeight: 600, color: 'var(--accent-warning)', marginBottom: 4 }}>{t('partner.tokenOnce')}</div>
              {plaintextTokens.inbound && <TokenRow label={t('partner.tokenInbound')} token={plaintextTokens.inbound} />}
              {plaintextTokens.outbound && <TokenRow label={t('partner.tokenOutbound')} token={plaintextTokens.outbound} />}
            </div>
          )}

          {isEdit && partner && (
            <div className="token-section">
              <div style={{ fontSize: 'var(--font-s)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>{t('partner.tokenMasked')}</div>
              <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{t('partner.inboundShort')}: {partner.inboundToken}</div>
              <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{t('partner.outboundShort')}: {partner.outboundToken}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="action-btn" disabled={busy} onClick={onRotateInbound}>{t('partner.rotateInboundBtn')}</button>
                <button className="action-btn" disabled={busy} onClick={() => onRotateOutbound(true)}>{t('partner.rotateOutboundNotifyBtn')}</button>
                <button className="action-btn" disabled={busy} onClick={() => onRotateOutbound(false)} title={t('partner.rotateOutboundOnlyTitle')}>{t('partner.rotateOutboundOnlyBtn')}</button>
              </div>
              {partner.tokenHistory.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>
                  {t('partner.recentRotation')}: {partner.tokenHistory.slice(-3).reverse().map((h, i) => (
                    <div key={i}>{h.field} ({h.rotatedBy}) — {new Date(h.rotatedAt).toLocaleString()}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <Text size="xs" c="jarvis.7">{error}</Text>}
          {saved && <Text size="xs" c="jarvis.5">{t('partner.savedFull')}</Text>}
          <Group justify="space-between" mt="md" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            <Group gap="xs">
              {isEdit && (
                <>
                  <Button variant="default" disabled={busy} onClick={onToggleActive}>
                    {partner?.active ? t('partner.block') : t('partner.unblock')}
                  </Button>
                  <Button color="jarvis.7" disabled={busy} onClick={onDelete}>{t('partner.delete')}</Button>
                </>
              )}
            </Group>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>{t('common.close')}</Button>
              <Button
                color={saved ? 'jarvis.5' : 'jarvis'}
                disabled={busy || saved || !form.companyName.trim() || !form.contactName.trim() || !form.apiUrl.trim()}
                onClick={onSubmit}
              >
                {saved ? t('partner.saved') : busy ? t('partner.saving') : (isEdit ? t('partner.save') : t('partner.create'))}
              </Button>
            </Group>
          </Group>
      </Stack>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  );
}

function TokenRow({ label, token }: { label: string; token: string }) {
  const t = useT();
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <code style={{ flex: 1, fontSize: 'var(--font-s)', background: 'var(--bg-canvas)', padding: 4, borderRadius: 4, overflowWrap: 'anywhere' }}>{token}</code>
        <button onClick={() => { navigator.clipboard?.writeText(token); }} style={btn('sm', 'neutral', { flexShrink: 0 })}>{t('partner.copy')}</button>
      </div>
    </div>
  );
}

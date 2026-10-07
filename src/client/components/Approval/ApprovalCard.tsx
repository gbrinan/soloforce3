import React, { useState, useEffect } from 'react';
import { Group, Text } from '@mantine/core';
import type { ApprovalRequest } from '../../utils/api';
import { resolveApproval } from '../../utils/api';
import { PermissionBadge } from '../Staff/PermissionBadge';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  id: string;
  pending: Map<string, number>;
  resolved: Map<string, ApprovalRequest>;
  opinions: Map<string, { allow: boolean; reason?: string }>;
  onResolve: (id: string, allow: boolean) => void;
  genieName?: string;
  ownerName?: string;
}

export default function ApprovalCard({ id, pending, resolved, opinions, onResolve, genieName, ownerName }: Props) {
  const t = useT();
  const effectiveGenieName = genieName || t('approval.defaultGenieName');
  const effectiveOwnerName = ownerName || t('approval.defaultOwnerName');
  const resolvedReq = resolved.get(id);
  const opinion = opinions.get(id);
  const [createdAt, setCreatedAt] = useState(() => pending.get(id) || Date.now());
  const [countdown, setCountdown] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [fetchedReq, setFetchedReq] = useState<ApprovalRequest | null>(null);
  const [approvalData, setApprovalData] = useState<ApprovalRequest | null>(null);
  const effectiveResolved = resolvedReq ?? fetchedReq;

  // 마운트 시 1회 status fetch — 결과 표시 + createdAt 동기화
  useEffect(() => {
    if (resolvedReq) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/approvals/${id}/status`);
        if (!res.ok) return;
        const data = await res.json() as ApprovalRequest;
        if (cancelled) return;
        if (data.createdAt) setCreatedAt(data.createdAt);
        setApprovalData(data);
        if (data.status !== 'pending_chat') {
          setFetchedReq(data);
        }
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [id, resolvedReq]);

  useEffect(() => {
    if (effectiveResolved) return;
    const update = () => {
      const elapsed = Math.round((Date.now() - createdAt) / 1000);
      setCountdown(Math.max(55 - elapsed, 0));
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [createdAt, effectiveResolved]);

  // 카운트다운 만료 후 폴링 (SSE 누락 대비)
  useEffect(() => {
    if (effectiveResolved || countdown > 0) return;
    let pollCount = 0;
    const pollIv = setInterval(async () => {
      pollCount++;
      if (pollCount > 24) { clearInterval(pollIv); return; } // 2분 제한
      try {
        const res = await fetch(`/api/approvals/${id}/status`);
        if (!res.ok) { clearInterval(pollIv); return; }
        const data = await res.json();
        if (data.status !== 'pending_chat') {
          clearInterval(pollIv);
          onResolve(id, data.status === 'allowed');
        }
      } catch { clearInterval(pollIv); }
    }, 5000);
    return () => clearInterval(pollIv);
  }, [countdown, effectiveResolved, id, onResolve]);

  const handleClick = async (allow: boolean) => {
    setResolving(true);
    try {
      await resolveApproval(id, allow);
      onResolve(id, allow);
    } catch {
      setResolving(false);
    }
  };

  // 마이크루 의견 표시
  const opinionEl = opinion ? (
    <div className="genie-opinion">
      <span style={{ fontWeight: 600, color: 'var(--accent-info)' }}>{t('approval.opinionLabel', { name: effectiveGenieName })}</span>{' '}
      <span style={{ fontWeight: 600, color: opinion.allow ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
        {opinion.allow ? t('approval.recommendApprove') : t('approval.recommendDeny')}
      </span>
      {opinion.reason && ` — ${opinion.reason}`}
    </div>
  ) : null;

  const displayData = effectiveResolved ?? approvalData;
  const agentInfoEl = displayData?.agentRole ? (
    <Group gap={4} mb={4} align="center">
      <Text size="sm" c="dimmed">{displayData.agentRole}</Text>
      {displayData.permissionLevel && (
        <PermissionBadge level={displayData.permissionLevel} />
      )}
    </Group>
  ) : null;

  if (effectiveResolved) {
    const status = effectiveResolved.status || 'timeout';
    const verb = status === 'allowed' ? t('approval.statusApproved') : status === 'denied' ? t('approval.statusRejected') : t('approval.statusTimeout');
    const src = effectiveResolved.decisionSource;
    const actor = src === 'user' || src === 'dashboard' ? t('approval.byUser', { name: effectiveOwnerName }) : src === 'genie' || src === 'chat' ? t('approval.byActor', { name: effectiveGenieName }) : '';
    const statusClass = status === 'allowed' ? 'allowed' : status === 'denied' ? 'denied' : 'timeout';
    return (
      <>
        {agentInfoEl}
        {opinionEl}
        <div className={`approval-result approval-result-${statusClass}`}>
          {verb}{actor}
        </div>
      </>
    );
  }

  return (
    <>
      {agentInfoEl}
      <div style={{ fontSize: 'var(--font-s)', color: countdown <= 10 ? 'var(--accent-danger)' : 'var(--text-muted)', marginBottom: 6 }}>
        {countdown > 0 ? t('approval.countdownPending', { n: countdown }) : t('approval.systemPending')}
      </div>
      {opinionEl}
      <div className="approval-btns">
        <button className="approval-btn approval-btn-deny" disabled={resolving} onClick={() => handleClick(false)}>{t('approval.deny')}</button>
        <button className="approval-btn approval-btn-allow" disabled={resolving} onClick={() => handleClick(true)}>{t('approval.approve')}</button>
      </div>
    </>
  );
}

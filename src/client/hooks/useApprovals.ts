import { useState, useCallback } from 'react';
import type { ApprovalRequest } from '../utils/api';
import { fetchPendingApprovals, fetchResolvedApprovals } from '../utils/api';

interface GenieOpinion {
  allow: boolean;
  reason?: string;
}

export function useApprovals() {
  const [pending, setPending] = useState<Map<string, number>>(new Map());
  const [resolved, setResolved] = useState<Map<string, ApprovalRequest>>(new Map());
  const [opinions, setOpinions] = useState<Map<string, GenieOpinion>>(new Map());

  const load = useCallback(async () => {
    const [pendingRes, resolvedRes] = await Promise.all([
      fetchPendingApprovals(),
      fetchResolvedApprovals(500),
    ]);
    const pMap = new Map<string, number>();
    const rMap = new Map<string, ApprovalRequest>();
    const oMap = new Map<string, GenieOpinion>();

    for (const req of pendingRes) {
      pMap.set(req.id, req.createdAt);
      if (req.genieOpinion) oMap.set(req.id, req.genieOpinion);
    }
    for (const req of resolvedRes) {
      rMap.set(req.id, req);
      if (req.genieOpinion) oMap.set(req.id, req.genieOpinion);
    }

    setPending(pMap);
    setResolved(rMap);
    setOpinions(oMap);
  }, []);

  // 새 pending approval 발생 시 pending Map 등록 (App.tsx 'approval-request' SSE 핸들러에서 호출).
  // 이게 없으면 ApprovalCard.createdAt이 Date.now()로 폴백되어 카운트다운 부정확.
  const handleRequest = useCallback((req: ApprovalRequest) => {
    setPending(prev => {
      if (prev.has(req.id)) return prev;
      return new Map(prev).set(req.id, req.createdAt);
    });
    if (req.genieOpinion) {
      const opinion = req.genieOpinion;
      setOpinions(prev => new Map(prev).set(req.id, opinion));
    }
  }, []);

  const handleResolved = useCallback((req: ApprovalRequest) => {
    setPending(prev => { const m = new Map(prev); m.delete(req.id); return m; });
    setResolved(prev => new Map(prev).set(req.id, req));
  }, []);

  const handleOpinion = useCallback((data: { id: string; allow: boolean; reason?: string }) => {
    setOpinions(prev => new Map(prev).set(data.id, { allow: data.allow, reason: data.reason }));
  }, []);

  return { pending, resolved, opinions, load, handleRequest, handleResolved, handleOpinion };
}

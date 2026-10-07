import React from 'react';
import { Button } from '@mantine/core';
import { uiConfirm } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  onCancel: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  label?: string;     // 버튼 텍스트. 기본 '취소'.
  h?: number;         // 버튼 높이 (기존 호출부 호환).
}

// TaskCard·TodoPanel 곳곳에 반복되던 "취소 확인 → fetch → reload" 패턴 공용 컴포넌트.
// 실제 fetch는 onCancel에 위임 (URL이 todo/job/task로 다름).
export default function CancelButton({
  onCancel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  label,
  h = 22,
}: Props) {
  const t = useT();
  const confirmLbl = confirmLabel ?? t('common.cancel');
  const cancelLbl = cancelLabel ?? t('todo.continueWork');
  const lbl = label ?? t('common.cancel');
  return (
    <Button
      size="compact-xs"
      color="jarvis.7"
      radius="sm"
      h={h}
      className="cancel-btn-emphasis"
      onClick={async (e) => {
        e.stopPropagation();
        if (!(await uiConfirm({
          title,
          description,
          variant: 'danger',
          confirmLabel: confirmLbl,
          cancelLabel: cancelLbl,
        }))) return;
        try { await onCancel(); } catch { /* */ }
      }}
    >
      {lbl}
    </Button>
  );
}

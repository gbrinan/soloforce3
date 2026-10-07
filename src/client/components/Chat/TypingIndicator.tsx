import React from 'react';
import { useT } from '../../i18n/I18nProvider';

// 연결 오류/재연결 중 표시 — 에러 텍스트 대신 디스코드 스타일 typing indicator.
// 점 3개가 0.3초 간격으로 순차 bounce(styles.css의 @keyframes typing-bounce).
// 색상은 var(--text-muted)로 다크/라이트 모두 자동 대응.
export default function TypingIndicator() {
  const t = useT();
  return (
    <div className="msg-wrap msg-wrap-genie" style={{ gap: 6 }}>
      <div
        className="msg msg-genie"
        role="status"
        aria-label={t('chat.reconnecting')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <span className="typing-indicator" aria-hidden="true">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </span>
        <span style={{ fontSize: 'var(--font-s)', color: 'var(--text-muted)' }}>{t('chat.reconnecting')}</span>
      </div>
    </div>
  );
}

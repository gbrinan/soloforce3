// internal 응답 SSE 발화 결정 — chat.ts:_sendMessageImpl 마무리 분기에서 사용.
// [NOTIFY] 또는 [REPORT] 마커가 있는 internal 응답만 emit, 마커 없으면 skip + warn.
// env INTERNAL_REPLY_NOTIFY_ONLY=false 시 옛 동작 복귀 (안전망).

const MARKER_RE = /^\[(NOTIFY|REPORT)\]\s*/im;
const REPLY_BLOCK_RE = /\[REPLY_TO_PARTNER\s+[^\]]*\][\s\S]*?\[\/REPLY_TO_PARTNER\]\s*/g;
// 깨진 마커도 잡기: messageId= 포함 또는 _PARTNER, /REPLY 등 부분 매칭
const REPLY_FRAGMENT_RE = /\[?\/?(?:REPLY_TO_)?_?PARTNER\s*(?:messageId=[^\]]*\])?\s*/gi;

function cleanContent(raw: string): string {
  // [REPLY_TO_PARTNER ...] ... [/REPLY_TO_PARTNER] 블록 제거
  let cleaned = raw.replace(REPLY_BLOCK_RE, '');
  // 깨진 마커 잔여물 제거
  cleaned = cleaned.replace(REPLY_FRAGMENT_RE, '');
  return cleaned.trim();
}

export interface InternalEmitDecision {
  emit: boolean;
  emitContent: string;
  warn: boolean;
}

export function decideInternalEmit(
  content: string,
  isInternal: boolean,
  notifyOnly: boolean,
): InternalEmitDecision {
  if (!isInternal) return { emit: true, emitContent: content, warn: false };
  const m = content.match(MARKER_RE);
  if (m) {
    const marker = m[1].toUpperCase();
    const icon = marker === 'REPORT' ? '📋 ' : '🔔 ';
    const cleaned = cleanContent(content.slice(m[0].length));
    return { emit: true, emitContent: icon + cleaned, warn: false };
  }
  if (!notifyOnly) return { emit: true, emitContent: content, warn: false };
  return { emit: false, emitContent: content, warn: true };
}

export function notifyOnlyFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.INTERNAL_REPLY_NOTIFY_ONLY ?? "true") === "true";
}

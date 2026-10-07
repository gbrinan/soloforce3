import { describe, it, expect } from 'vitest';
import { isCancelCommand } from './voiceMetrics';

describe('음성 취소 명령 판별 (J-R)', () => {
  it.each(['취소', '방금 거 취소', '방금거 취소', '아니야', '그만', '스톱', '중지', '취소.'])(
    '취소로 인식: %s', (t) => expect(isCancelCommand(t)).toBe(true));
  it.each(['취소해줘 어제 주문', '방금 보고 다시 말해줘', '그만큼만 해줘', '아니야 대신 이렇게 해줘', '스톱워치 켜줘'])(
    '지시로 통과: %s', (t) => expect(isCancelCommand(t)).toBe(false));
});

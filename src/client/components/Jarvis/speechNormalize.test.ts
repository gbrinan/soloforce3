import { describe, it, expect } from 'vitest';
import { normalizeForSpeech } from '../../../server/speech-normalize';

describe('한국어 TTS 발음 정규화 (2026-08-26 왕복 실측 기반)', () => {
  it('소수점을 읽는다 — 3.14 → "3.24" 오발음 방지', () => {
    expect(normalizeForSpeech('3.14입니다')).toContain('삼 점 일사');
  });
  it('버전 표기 — v0.2.33 → "배웜" 오발음 방지', () => {
    const r = normalizeForSpeech('v0.2.33 배포');
    expect(r).toContain('버전');
    expect(r).not.toMatch(/v0/i);
  });
  it('점 3개 버전 1.2.3', () => {
    expect(normalizeForSpeech('1.2.3 릴리즈')).toBe('일 점 이 점 삼 릴리즈');
  });
  it('시각 14:30 → 14시 30분', () => {
    expect(normalizeForSpeech('14:30 미팅')).toBe('14시 30분 미팅');
  });
  it('단위 — GB/ms/%', () => {
    expect(normalizeForSpeech('3.2GB')).toContain('기가바이트');
    expect(normalizeForSpeech('150ms')).toContain('밀리초');
    expect(normalizeForSpeech('85%')).toContain('퍼센트');
  });
  it('문장을 끊던 기호 정리 — 대시·중점·따옴표·괄호', () => {
    const r = normalizeForSpeech('테스트 — 괄호(하나) 「따옴표」 ·중점· ~물결~');
    expect(r).not.toMatch(/[—「」·~()]/);
    expect(r).toContain('괄호');
    expect(r).toContain('따옴표');
  });
  it('영문 약어 음차', () => {
    expect(normalizeForSpeech('API와 TTS')).toBe('에이피아이와 티티에스');
  });
  it('일반 한국어 문장은 변형하지 않는다', () => {
    const s = '오늘 일정 세 건을 확인했습니다.';
    expect(normalizeForSpeech(s)).toBe(s);
  });
  it('연도는 그대로 둔다', () => {
    expect(normalizeForSpeech('2026년 8월 26일')).toBe('2026년 8월 26일');
  });
});

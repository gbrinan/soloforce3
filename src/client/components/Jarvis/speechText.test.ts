import { describe, it, expect } from 'vitest';
import { segmentSentences, stripNonSpeech, summarizePreview, createSentenceStream } from './speechText';

describe('stripNonSpeech', () => {
  it('완결된 코드펜스를 안내 문구로 치환한다', () => {
    const input = '설명입니다.\n```ts\nconst a = 1;\n```\n끝났습니다.';
    const out = stripNonSpeech(input);
    expect(out).toContain('코드는 화면에 표시했습니다.');
    expect(out).not.toContain('const a');
  });

  it('마크다운 표를 안내 문구로 치환한다', () => {
    const input = '결과:\n| a | b |\n|---|---|\n| 1 | 2 |\n이상입니다.';
    const out = stripNonSpeech(input);
    expect(out).toContain('표는 화면에 표시했습니다.');
    expect(out).not.toContain('| a | b |');
  });

  it('헤더/강조/링크 마크다운을 제거하고 텍스트는 보존한다', () => {
    const input = '# 제목\n**중요**한 내용과 _강조_된 [링크](https://example.com)입니다.';
    const out = stripNonSpeech(input);
    expect(out).not.toMatch(/^#/m);
    expect(out).toContain('중요한');
    expect(out).toContain('강조된');
    expect(out).toContain('링크입니다');
    expect(out).not.toContain('https://example.com');
  });

  it('HTML 주석과 진행 로그(도구 호출) 라인을 제거한다', () => {
    const input = '<!-- 내부 메모 -->시작.\n\u{1F527} 파일을 읽는 중...\n완료.';
    const out = stripNonSpeech(input);
    expect(out).not.toContain('내부 메모');
    expect(out).not.toContain('\u{1F527}');
  });

  it('이모지를 제거한다', () => {
    const input = '오늘 날씨 좋네요 \u2600\uFE0F\u{1F600}\u{1F389} 정말요!';
    const out = stripNonSpeech(input);
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('idempotent — 두 번 적용해도 결과가 같다', () => {
    const input = '# 헤더\n**굵게** [링크](https://a.com) 코드:\n```js\nx()\n```\n표:\n| a | b |\n|---|---|\n끝.';
    const once = stripNonSpeech(input);
    const twice = stripNonSpeech(once);
    expect(twice).toBe(once);
  });
});

describe('segmentSentences — 경계 규칙', () => {
  it('마침표/느낌표/물음표/한국어 어미로 문장을 나눈다', () => {
    const text = '오늘은 날씨가 좋습니다. 정말 그런가요? 네 맞아요! 좋은 하루 되세요.';
    const { sentences } = segmentSentences(text + ' ');
    // '네 맞아요!'는 10자 미만이라 다음 문장과 합쳐 발화된다.
    expect(sentences).toEqual([
      '오늘은 날씨가 좋습니다.',
      '정말 그런가요? 네 맞아요!',
      '좋은 하루 되세요.',
    ]);
  });

  it('소수점(3.14)에서 분리하지 않는다', () => {
    const text = '원주율은 3.14 근처의 값을 가지는 숫자입니다. 다음 문장입니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences.some((s) => s.includes('3.14'))).toBe(true);
    expect(sentences.some((s) => s === '3.14')).toBe(false);
  });

  it('버전 번호(v0.2.33)에서 분리하지 않는다', () => {
    const text = '이번 릴리즈는 v0.2.33 버전으로 배포되었습니다. 확인 부탁드립니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0]).toContain('v0.2.33');
  });

  it('단위가 붙은 소수(1.5초)에서 분리하지 않는다', () => {
    const text = '응답 시간은 1.5초 이내여야 정상입니다. 초과 시 재시도합니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0]).toContain('1.5초');
  });

  it('URL(www.example.com) 안에서 분리하지 않는다', () => {
    const text = '자세한 내용은 www.example.com 에서 확인하세요. 감사합니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0]).toContain('www.example.com');
  });

  it('파일 경로/줄번호(src/index.ts:417)에서 분리하지 않는다', () => {
    const text = '오류는 src/index.ts:417 위치에서 발생했습니다. 수정이 필요합니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0]).toContain('src/index.ts:417');
  });

  it('말줄임표(...)에서 분리하지 않는다', () => {
    const text = '생각을 해보면... 그럴 수도 있겠네요. 다음 이야기입니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences.some((s) => s.includes('생각을 해보면...'))).toBe(true);
  });

  it('Node.js 같은 고유명사에서 분리하지 않는다', () => {
    const text = 'Node.js 런타임을 사용해 서버를 구성했습니다. 다음 단계로 넘어갑니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0]).toContain('Node.js');
  });

  it('빈 줄로 문단 경계를 만든다', () => {
    const text = '첫 문단입니다\n\n둘째 문단입니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences.some((s) => s.includes('첫 문단입니다'))).toBe(true);
  });
});

describe('segmentSentences — 최소/최대 길이', () => {
  it('10자 미만 짧은 문장은 다음 문장과 합쳐 발화한다', () => {
    const text = '네. 알겠습니다, 바로 진행하도록 하겠습니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences.some((s) => s === '네.')).toBe(false);
    expect(sentences[0]).toContain('네.');
    expect(sentences[0]).toContain('알겠습니다');
  });

  it('짧아도 빈 줄이 뒤따르면 즉시 방출한다', () => {
    const text = '네.\n\n다음 내용을 이어서 설명드리겠습니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0].trim()).toBe('네.');
  });

  it('약 180자를 넘는 런온 문장은 가장 가까운 쉼표에서 강제로 끊는다', () => {
    const clause = '이것은 매우 길게 이어지는 설명 문장의 한 부분으로서 계속해서 내용이 추가되고 있습니다';
    const longText = Array.from({ length: 6 }, () => clause).join(', ') + '. 짧은 다음 문장.';
    const { sentences } = segmentSentences(longText + ' ');
    expect(sentences.length).toBeGreaterThan(1);
    for (const s of sentences) {
      expect(s.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('segmentSentences — 코드/표/인용 내부 보호', () => {
  it('인라인 코드(`...`) 안의 마침표에서 분리하지 않는다', () => {
    const text = '설정값은 `a.b.c` 형태의 경로입니다. 참고하세요.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0]).toContain('`a.b.c`');
  });

  it('대괄호 인용([1]) 안에서 분리하지 않는다', () => {
    const text = '이 주장은 검증되었습니다[출처 1. 추가 설명]. 다음 문장입니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences[0]).toContain('[출처 1. 추가 설명]');
  });

  it('열린 코드펜스는 완결될 때까지 remainder로 보류한다', () => {
    const text = '지금까지의 설명은 이것으로 충분합니다.\n```ts\nconst a = 1;\n아직 안닫힘';
    const { sentences, remainder } = segmentSentences(text);
    expect(sentences[0]).toContain('지금까지의 설명은 이것으로 충분합니다.');
    expect(remainder).toContain('```ts');
  });


  it('마크다운 표(| a | b |) 안에서 마침표로 분리하지 않는다', () => {
    const text = '결과표:\n| 항목 | 값 |\n|---|---|\n| a | 1.0 |\n\n이상입니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences.some((s) => s.includes('표는 화면에 표시했습니다.'))).toBe(true);
  });
});

describe('summarizePreview', () => {
  it('앞 1~2문장만 취하고 220자를 넘으면 단어 중간을 자르지 않고 말줄임표를 붙인다', () => {
    const long = '이것은 첫 번째 문장으로 상당히 길게 작성되어 있으며 계속해서 내용이 이어집니다. '.repeat(4) + '두 번째 문장입니다.';
    const preview = summarizePreview(long);
    expect(preview.length).toBeLessThanOrEqual(220);
    if (preview.endsWith('\u2026')) {
      const before = preview.slice(0, -1);
      expect(before.endsWith(' ')).toBe(false);
    }
  });

  it('마크다운/이모지를 제거한 뒤 요약한다', () => {
    const preview = summarizePreview('**작업 완료** \u2705 파일을 생성했습니다. 추가로 확인이 필요합니다.');
    expect(preview).not.toContain('**');
    expect(preview).not.toMatch(/[\u{2700}-\u{27BF}]/u);
    expect(preview).toContain('작업 완료');
  });

  it('빈 입력에는 빈 문자열을 반환한다', () => {
    expect(summarizePreview('')).toBe('');
  });
});

describe('스트리밍 안전성 — 문자 단위 프리픽스 불변식', () => {
  const paragraph = [
    '안녕하세요, 오늘은 프로젝트 진행 상황을 공유드리겠습니다.',
    '먼저 백엔드 작업은 v0.2.33 버전으로 배포되었고, 응답 시간은 1.5초 이내로 측정되었습니다.',
    '자세한 로그는 src/index.ts:417 부근을 참고하시면 됩니다.',
    '관련 문서는 www.example.com 에서 확인하실 수 있습니다.',
    '음, 그런데... 몇 가지 이슈가 남아있습니다.',
    '네.',
    '우선순위가 높은 항목부터 처리하도록 하겠습니다.',
  ].join(' ');

  function normalize(s: string): string {
    return s.replace(/\s+/g, '');
  }

  it('한 글자씩 push()해도 문장이 중복/유실 없이 원문 내용을 보존한다', () => {
    const stream = createSentenceStream();
    const emitted: string[] = [];
    for (const ch of paragraph) {
      const fresh = stream.push(ch);
      emitted.push(...fresh);
    }
    const finalFresh = stream.flush();
    emitted.push(...finalFresh);

    // 중복 없음: 같은 문장 텍스트가 이상하게 반복되지 않아야 한다 (완전 동일 문장 재방출 금지)
    const seen = new Set<string>();
    for (const s of emitted) {
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }

    // 유실 없음: 방출된 모든 문장을 이어 붙이면 원문의 공백-무시 내용과 일치해야 한다
    const combined = normalize(emitted.join(' '));
    expect(combined).toBe(normalize(paragraph));
  });

  it('growing prefix에 대해 segmentSentences가 이미 반환한 문장을 절대 바꾸지 않는다', () => {
    let prevSentences: string[] = [];
    for (let i = 1; i <= paragraph.length; i++) {
      const prefix = paragraph.slice(0, i);
      const { sentences } = segmentSentences(prefix);
      for (let j = 0; j < prevSentences.length; j++) {
        expect(sentences[j]).toBe(prevSentences[j]);
      }
      prevSentences = sentences;
    }
  });
});

describe('혼합 한국어/영어 및 실전 어시스턴트 응답', () => {
  it('영어 단어가 섞인 문장을 올바르게 분리한다', () => {
    const text = 'TypeScript로 작성된 코드입니다. React 19의 use 훅을 활용했습니다. 확인 부탁드립니다.';
    const { sentences } = segmentSentences(text + ' ');
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    expect(sentences[1]).toContain('React 19');
  });

  it('코드펜스 + 표 + URL + 소수점이 섞인 복합 응답을 처리한다', () => {
    const text = [
      '작업 결과를 보고드립니다.',
      '',
      '```ts',
      'const ratio = 3.14;',
      '```',
      '',
      '성능 결과표:',
      '| 지표 | 값 |',
      '|---|---|',
      '| 응답시간 | 1.5초 |',
      '',
      '자세한 내용은 www.example.com 에서 확인하세요.',
      '작업은 v0.2.33 버전 기준입니다.',
    ].join('\n');
    const { sentences } = segmentSentences(text + ' ');
    const joined = sentences.join(' ');
    expect(joined).toContain('코드는 화면에 표시했습니다.');
    expect(joined).toContain('표는 화면에 표시했습니다.');
    expect(joined).toContain('www.example.com');
    expect(joined).toContain('v0.2.33');
    expect(joined).not.toContain('const ratio');
    expect(joined).not.toContain('| 응답시간 |');
  });
});

// ── JarvisView 확정메시지 경로 회귀 방지 ────────────────────────────────
// sentences만 취하고 remainder를 버리면 10자 미만 종결 문장이 영구 누락된다.
// (2026-08-25 실측 재현: "배포를 완료했습니다. 헬스체크도 정상입니다. 네." → 마지막 "네." 손실)
describe('확정 메시지 발화 — remainder 포함 규칙', () => {
  function speakAll(content: string, alreadySpoken = 0): string {
    const seg = segmentSentences(stripNonSpeech(content) + ' ');
    const parts = seg.sentences.slice(alreadySpoken);
    const tail = seg.remainder.trim();
    if (tail) parts.push(tail);
    return parts.join(' ').trim();
  }

  it('마지막 짧은 문장도 발화 대상에 포함된다', () => {
    const msg = '배포를 완료했습니다. 헬스체크도 정상입니다. 네.';
    expect(speakAll(msg)).toContain('네.');
  });

  it('확정 메시지의 모든 내용이 빠짐없이 발화된다', () => {
    const msg = '배포를 완료했습니다. 헬스체크도 정상입니다. 네.';
    expect(speakAll(msg).replace(/\s+/g, '')).toBe(msg.replace(/\s+/g, ''));
  });

  it('이미 스트리밍으로 발화한 문장은 중복되지 않는다', () => {
    const msg = '첫 번째 문장입니다. 두 번째 문장입니다. 넵.';
    const spokenCount = segmentSentences(msg).sentences.length;
    const rest = speakAll(msg, spokenCount);
    expect(rest).not.toContain('첫 번째');
  });
});

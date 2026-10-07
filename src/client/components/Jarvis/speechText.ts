// 자비스뷰 발화 세그먼테이션 유틸 — chat-stream 텍스트를 문장 단위로 잘라 TTS 큐에 넣는다.
//
// 설계 원칙:
//  - segmentSentences()는 순수 함수다. 같은 접두사(prefix)에 대해서는 항상 같은 위치에서
//    문장을 자르므로, 누적 텍스트가 자라나도 이미 반환된 문장이 재발화(중복)되거나
//    사라지지 않는다 (스트리밍 안전성). 자세한 증명은 speechText.test.ts 참고.
//  - 마침표/물음표/느낌표가 숫자·URL·코드·버전 표기 안에 있을 때는 문장 경계로 보지 않는다.
//  - 너무 짧은 문장(<10자)은 다음 조각과 합쳐 발화하되, 빈 줄이 뒤따르면 즉시 방출한다.
//  - 너무 긴 문장(>180자)은 가장 가까운 쉼표에서 강제로 끊는다.

export interface SegmentResult {
  sentences: string[];
  remainder: string;
}

const TERMINATORS = new Set(['.', '!', '?', '\u3002']); // . ! ? 。
const MAX_SENTENCE_LENGTH = 180;
const MIN_SENTENCE_LENGTH = 10;

/** 이모지 및 결합용 변형 선택자(VS16, ZWJ) 범위. */
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/gu;
const VARIATION_SELECTOR_RE = /[\uFE0F\u200D]/g;

/** 텍스트 안의 URL(http(s):// 또는 www.) 구간을 찾는다. */
function findUrlSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

function isInSpans(spans: Array<[number, number]>, idx: number): boolean {
  for (const [s, e] of spans) {
    if (idx >= s && idx < e) return true;
  }
  return false;
}

/** 마크다운 표(연속 2줄 이상의 파이프 라인)를 안내 문구로 치환한다. */
function replaceMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) j++;
      if (j - i >= 2) {
        result.push(' 표는 화면에 표시했습니다. ');
        i = j;
        continue;
      }
    }
    result.push(lines[i]);
    i++;
  }
  return result.join('\n');
}

/**
 * 마크다운/이모지/코드펜스/표/HTML 주석/진행 로그를 제거해 순수 발화용 텍스트로 만든다.
 * 여러 번 적용해도 결과가 같다 (idempotent).
 */
export function stripNonSpeech(text: string): string {
  let out = text;

  // HTML 주석 제거
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');

  // 진행 로그(🔧) 라인 제거
  out = out
    .split('\n')
    .filter((line) => !line.trim().startsWith('\u{1F527}'))
    .join('\n');

  // 완결된 코드펜스를 안내 문구로 치환
  out = out.replace(/```[\s\S]*?```/g, ' 코드는 화면에 표시했습니다. ');

  // 마크다운 표를 안내 문구로 치환
  out = replaceMarkdownTables(out);

  // 헤더(#) 마커 제거 (내용은 보존)
  out = out.replace(/^#{1,6}\s+/gm, '');

  // 강조 마커 제거 (내용은 보존, URL/식별자 오탐 방지를 위해 단어 경계 체크)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  out = out.replace(/__([^_\n]+)__/g, '$1');
  out = out.replace(/~~([^~\n]+)~~/g, '$1');
  out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1');
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1');

  // 마크다운 링크는 텍스트만 남기고 URL 제거
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // 이모지 및 변형 선택자 제거
  out = out.replace(EMOJI_RE, '');
  out = out.replace(VARIATION_SELECTOR_RE, '');

  // 중복 공백 정리 (개행은 문단 경계 판단에 쓰이므로 유지)
  out = out.replace(/[ \t]{2,}/g, ' ');

  return out;
}

/** 열린 코드펜스(``` 홀수 개)가 있으면 그 지점부터 remainder(heldTail)로 보류한다. */
function stripFences(text: string): { workable: string; heldTail: string } {
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    const idx = text.lastIndexOf('```');
    return { workable: text.slice(0, idx), heldTail: text.slice(idx) };
  }
  return { workable: text, heldTail: '' };
}

interface RawCut {
  /** 이 조각이 끝나는 위치(제외, buf 기준) */
  end: number;
  /** 이 경계 직후 빈 줄이 이어지는지 여부 — 짧은 문장이라도 즉시 방출한다. */
  blankLineAfter: boolean;
}

function findNearestComma(buf: string, start: number, end: number): number {
  const limit = Math.min(end, buf.length);
  for (let i = limit - 1; i > start; i--) {
    if (buf[i] === ',' || buf[i] === '\u3001') return i;
  }
  return -1;
}

/** 자연 경계 없이 문장이 너무 길어지면 ~180자 근처 쉼표에서 강제로 끊는다. */
function enforceMaxLength(buf: string, cuts: RawCut[]): RawCut[] {
  const result: RawCut[] = [];
  let prev = 0;
  for (const cut of cuts) {
    let start = prev;
    while (cut.end - start > MAX_SENTENCE_LENGTH) {
      const windowEnd = start + MAX_SENTENCE_LENGTH;
      const commaIdx = findNearestComma(buf, start, windowEnd);
      const splitAt = commaIdx !== -1 ? commaIdx + 1 : windowEnd;
      result.push({ end: splitAt, blankLineAfter: false });
      start = splitAt;
    }
    result.push(cut);
    prev = cut.end;
  }
  // 마지막(아직 경계 없는) 꼬리도 너무 길면 강제 분할한다.
  let start = prev;
  while (buf.length - start > MAX_SENTENCE_LENGTH) {
    const windowEnd = start + MAX_SENTENCE_LENGTH;
    const commaIdx = findNearestComma(buf, start, windowEnd);
    const splitAt = commaIdx !== -1 ? commaIdx + 1 : windowEnd;
    result.push({ end: splitAt, blankLineAfter: false });
    start = splitAt;
  }
  return result;
}

/**
 * 처리된(stripNonSpeech 적용 후) 텍스트에서 원시 문장 경계 후보들을 찾는다.
 * 인라인 코드(`...`), 대괄호 인용([...]), 표 행(|...|) 내부와
 * 소수점/버전 번호/URL/말줄임표(...) 안의 마침표는 경계로 보지 않는다.
 */
function findRawCuts(buf: string): RawCut[] {
  const cuts: RawCut[] = [];
  const urlSpans = findUrlSpans(buf);
  let backtick = false;
  let bracket = 0;

  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];

    if (c === '`') { backtick = !backtick; continue; }
    if (backtick) continue;
    if (c === '[') { bracket++; continue; }
    if (c === ']') { if (bracket > 0) bracket--; continue; }
    if (bracket > 0) continue;

    const lineStart = buf.lastIndexOf('\n', i - 1) + 1;
    const lineEndCandidate = buf.indexOf('\n', i);
    const line = buf.slice(lineStart, lineEndCandidate === -1 ? buf.length : lineEndCandidate);
    const isTableRow = /^\s*\|/.test(line);

    if (c === '\n') {
      if (buf[i + 1] === '\n') {
        cuts.push({ end: i + 2, blankLineAfter: true });
        i += 1; // 두 번째 개행은 건너뛴다
        continue;
      }
      if (!isTableRow) {
        cuts.push({ end: i + 1, blankLineAfter: false });
      }
      continue;
    }

    if (isTableRow) continue;
    if (!TERMINATORS.has(c)) continue;
    if (isInSpans(urlSpans, i)) continue;

    // 말줄임표(...) 는 문장 종결로 보지 않는다
    if (buf[i + 1] === '.') continue;
    if (buf[i - 1] === '.') continue;

    // 소수점/버전 번호 (3.14, v0.2.33) 보호
    if (c === '.' && /[0-9]/.test(buf[i - 1] || '') && /[0-9]/.test(buf[i + 1] || '')) continue;
    // 버퍼 끝(next === undefined)에서는 경계를 확정하지 않는다 — 스트리밍 중에는 이어지는
    // 문자가 아직 도착하지 않았을 뿐일 수 있다 (예: "v0." 다음에 "2.33"이 이어지는 경우).
    // 완결된 입력은 항상 호출부에서 trailing whitespace를 붙여 넘기므로 안전하다.
    const next = buf[i + 1];
    if (next === undefined || !/\s/.test(next)) continue;

    const blankLineAfter = next === '\n' && buf[i + 2] === '\n';
    cuts.push({ end: i + 1, blankLineAfter });
  }

  return enforceMaxLength(buf, cuts);
}

/** 최소 길이 미만인 문장은 다음 경계와 합쳐 발화한다 (빈 줄이 뒤따르면 즉시 방출). */
function mergeCuts(buf: string, cuts: RawCut[]): SegmentResult {
  const sentences: string[] = [];
  let pendingStart = 0;

  for (const cut of cuts) {
    const candidate = buf.slice(pendingStart, cut.end);
    const trimmed = candidate.trim();
    if (trimmed.length >= MIN_SENTENCE_LENGTH || cut.blankLineAfter) {
      if (trimmed) sentences.push(trimmed);
      pendingStart = cut.end;
    }
  }

  return { sentences, remainder: buf.slice(pendingStart) };
}

/**
 * 누적된 텍스트에서 완결된 문장들을 추출하고 나머지를 remainder로 반환한다.
 * 순수 함수이며, 같은 접두사에 대해서는 항상 동일한 위치에서 문장을 잘라내므로
 * 스트리밍 중 반복 호출해도 이미 반환된 문장이 재발화되거나 유실되지 않는다.
 */
export function segmentSentences(accumulated: string): SegmentResult {
  const { workable, heldTail } = stripFences(accumulated);
  const buf = stripNonSpeech(workable);
  const cuts = findRawCuts(buf);
  const { sentences, remainder } = mergeCuts(buf, cuts);
  return { sentences, remainder: remainder + heldTail };
}

/** job-complete-toast preview 텍스트에서 앞 1~2문장, 최대 maxChars자로 잘라 발화용 요약을 만든다. */
export function summarizePreview(preview: string, maxSentences = 2, maxChars = 220): string {
  const clean = stripNonSpeech(preview || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const { sentences } = segmentSentences(clean + ' ');
  let picked = sentences.slice(0, maxSentences).join(' ').trim();
  if (!picked) picked = clean;
  if (picked.length > maxChars) {
    let cut = picked.slice(0, maxChars - 1);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 0) cut = cut.slice(0, lastSpace); // 단어 중간에서 자르지 않는다
    picked = cut.trim() + '\u2026';
  }
  return picked;
}

/** 문장 스트림을 증분(incremental) 처리하기 위한 상태 저장 헬퍼. */
export interface SentenceStream {
  /** 새 텍스트 조각을 밀어넣고, 이번에 새로 완결된 문장들을 반환한다. */
  push(chunk: string): string[];
  /** 스트림 종료를 알리고, 남아 있는 텍스트를 마지막 문장(들)으로 방출한다. */
  flush(): string[];
  /** 지금까지 누적된 원문 텍스트를 반환한다. */
  getBuffer(): string;
}

/**
 * segmentSentences()를 감싸 push/flush 형태의 증분 스트림 API를 제공한다.
 * push()는 절대 이미 방출한 문장을 다시 반환하지 않으며, flush() 이후에는
 * 누적 버퍼 전체가 sentences로 소진된다 (remainder 유실 없음).
 */
export function createSentenceStream(): SentenceStream {
  let buffer = '';
  let emittedCount = 0;

  const push = (chunk: string): string[] => {
    buffer += chunk;
    const { sentences } = segmentSentences(buffer);
    const fresh = sentences.slice(emittedCount);
    emittedCount = sentences.length;
    return fresh;
  };

  const flush = (): string[] => {
    const fresh = push('');
    const { sentences, remainder } = segmentSentences(buffer);
    const tail = remainder.trim();
    if (tail) {
      emittedCount = sentences.length + 1;
      return [...fresh, tail];
    }
    emittedCount = sentences.length;
    return fresh;
  };

  return { push, flush, getBuffer: () => buffer };
}

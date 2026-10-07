const LEGACY_FAIL_VERDICT_RE = /\[결과\]\s*FAIL(?:\.|\b)/i;
const FAIL_SUMMARY_RE = /^\s*FAIL\.(?:\s|$)/i;

export function isQaFailVerdict(content: string | undefined, summary: string | undefined): boolean {
  return [content, summary].some((value) =>
    !!value && (LEGACY_FAIL_VERDICT_RE.test(value) || FAIL_SUMMARY_RE.test(value))
  );
}

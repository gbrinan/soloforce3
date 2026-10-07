// 공용 AI 클라이언트로 통합됨 (packages/ai-client). runClaude/extractJson/
// claudeErrorDetail/DEFAULT_TIMEOUT_MS 는 공용 패키지에서 재export 하고,
// 앱 고유 헬퍼(clipMiddle)만 이 파일에 유지한다.
// 기존 import 경로(@/lib/claude-cli)는 그대로 두어 호출부 변경 없이 동작한다.
export { runClaude, extractJson, claudeErrorDetail, DEFAULT_TIMEOUT_MS } from "@mycrew/ai-client";

/**
 * Clip long document text to maxChars, keeping head and tail around a marker
 * so both the opening context and closing sections survive truncation.
 */
export function clipMiddle(text: string, maxChars = 30_000): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n\n...[중략: 문서가 길어 일부 생략됨]...\n\n${text.slice(-tail)}`;
}

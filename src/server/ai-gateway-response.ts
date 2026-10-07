/** Structured CLI output is a separate envelope field, never inferred from prose. */
export function gatewayResponseText(envelope: { result?: string; structured_output?: unknown; is_error?: boolean }, structured: boolean): string {
  if (envelope.is_error) throw new Error('claude_response_error');
  if (!structured) return (envelope.result ?? '').trim();
  if (!envelope.structured_output || typeof envelope.structured_output !== 'object' || Array.isArray(envelope.structured_output)) {
    throw new Error('claude_structured_output_missing');
  }
  return JSON.stringify(envelope.structured_output);
}

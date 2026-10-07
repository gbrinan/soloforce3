import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
// Transport schemas only; all authorization, revision and file checks run in the host.
const scope = z.object({ orgId: z.string(), projectId: z.string() });
const ref = z.object({ scope, id: z.string(), revision: z.number().int().positive() });
export function registerWikiTools(server: McpServer, base?: string, token?: string): void {
  if (!base || !token) return;
  const call = async (route: string, input: unknown) => {
    try {
      const response = await fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
      return { isError: !response.ok, content: [{ type: 'text' as const, text: await response.text() }] };
    } catch { return { isError: true, content: [{ type: 'text' as const, text: 'wiki_host_unavailable: completion not confirmed; retry the same request' }] }; }
  };
  server.tool('WikiSearch', 'Find reviewed Wiki knowledge in an explicit scope. Read mandatory constraints and unknowns independently of ranking.',
    { scope, query: z.string(), limit: z.number().optional() }, input => call('search', input));
  server.tool('WikiRead', 'Read a specific current knowledge revision with full conditions, source evidence and citation. Changed revisions require a fresh read.',
    ref.shape, input => call('read', input));
  server.tool('WikiHandoff', 'Delegate with host-verified Wiki references. Requires delegation permission; returns ACK, not completion. corpus-keeper requires join_aggregate.',
    { refs: z.array(ref), agent: z.string(), request: z.string(), purpose: z.enum(['analysis', 'document', 'development', 'join_aggregate']) }, input => call('handoff', input));
  server.tool('WikiRecordUsage', 'Verify citations in your saved Markdown/text output and record knowledge revisions and file hash. Does not prove semantic correctness.',
    { refs: z.array(ref), outputPath: z.string() }, input => call('usage', input));
}

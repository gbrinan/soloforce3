import { createHash } from 'node:crypto';
import type { CorpusChunk, CorpusSnapshot, SourceUnit } from '../../shared/corpus.js';

export function sourceUnit(text: string, locator: string, kind: SourceUnit['kind'], cells?: string[], headingPath: string[] = [], contextStatus: SourceUnit['contextStatus'] = kind === 'table' ? 'row_with_header' : 'block'): SourceUnit {
  return { id: `u-${createHash('sha256').update(JSON.stringify({ text, locator, kind, headingPath, cells })).digest('hex').slice(0, 24)}`,
    text, locator, kind, headingPath, contextStatus, ...(cells ? { cells } : {}) };
}

/** Keep the whole Markdown section, including later exceptions; never use search windows as sections. */
export function markdownSections(text: string): { text: string; headingPath: string[]; line: number }[] {
  const sections: { text: string; headingPath: string[]; line: number }[] = [];
  let body: string[] = []; let headings: string[] = []; let start = 1; let fence = '';
  const flush = () => { if (body.join('\n').trim()) sections.push({ text: body.join('\n'), headingPath: [...headings], line: start }); body = []; };
  text.split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = ''; }
    const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { flush(); headings = headings.slice(0, heading[1].length - 1); headings[heading[1].length - 1] = heading[2]; start = index + 1; }
    body.push(line);
  });
  flush(); return sections;
}

export function unitText(unit: SourceUnit): string {
  return unit.headingPath.length ? `${unit.headingPath.join(' > ')}\n\n${unit.text}` : unit.text;
}

/** Expansion is explicit. An over-budget unit remains marked incomplete rather than silently trimmed. */
export function readChunkContext(snapshot: CorpusSnapshot, chunk: CorpusChunk, maxBytes = 64 * 1024): NonNullable<import('../../shared/corpus.js').CorpusHit['context']> {
  const unit = snapshot.units?.find(item => item.id === chunk.unitId);
  if (!unit) return { unitId: chunk.id, locator: chunk.locator, text: chunk.text, complete: false, reason: 'legacy_source_requires_reimport' };
  const text = unitText(unit);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { unitId: unit.id, locator: unit.locator, text: chunk.text, complete: false, reason: 'source_unit_exceeds_context_budget' };
  return { unitId: unit.id, locator: unit.locator, text, complete: true };
}

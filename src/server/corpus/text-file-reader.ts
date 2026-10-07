import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type { CorpusProfile, SourceUnit } from '../../shared/corpus.js';
import { CorpusError, parseDelimited } from './extract.js';
import { sourceUnit } from './source-reader.js';

async function* lines(path: string): AsyncGenerator<string> {
  let decoder: TextDecoder | undefined; let pending = '';
  for await (const raw of createReadStream(path)) {
    const bytes = raw as Buffer;
    decoder ??= new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8', { fatal: true });
    pending += decoder.decode(bytes, { stream: true });
    if (pending.includes('\0')) throw new CorpusError('unsupported_text_encoding');
    let end: number;
    while ((end = pending.indexOf('\n')) >= 0) { yield pending.slice(0, end + 1); pending = pending.slice(end + 1); }
    if (pending.length > 2_000_000) throw new CorpusError('source_unit_requires_subdivision', 413);
  }
  if (decoder) pending += decoder.decode();
  if (pending) yield pending;
}

/** Stream CSV records / Markdown sections. Prefix parsing can repeat on resume, but saved units never do. */
export async function extractTextFile(path: string, name: string, mime: string, startUnit: number, unitLimit: number, onUnit: (unit: SourceUnit, ordinal: number) => void): Promise<{ profile: CorpusProfile; progress: { cursor: number; complete: boolean } }> {
  const csv = ['.csv', '.tsv'].includes(extname(name).toLowerCase());
  let seen = 0; let written = 0; let cursor = startUnit;
  const profile: CorpusProfile = { format: csv ? 'csv' : extname(name).toLowerCase() === '.md' ? 'markdown' : 'text', mime,
    evidence: ['streamed-text-decoder'], warnings: [], routes: [] };
  const emit = (unit: SourceUnit): boolean => {
    if (!unit.text.trim()) return true;
    if (++seen <= startUnit) return true;
    if (written === unitLimit) return false;
    if (unit.text.length > 2_000_000) throw new CorpusError('source_unit_requires_subdivision', 413);
    onUnit(unit, seen); written++; cursor = seen; return true;
  };
  let complete = true;
  if (csv) {
    let record = ''; let quoted = false; let header: string[] | undefined; let row = 0;
    for await (const line of lines(path)) {
      record += line;
      if (record.length > 2_000_000) throw new CorpusError('source_unit_requires_subdivision', 413);
      if ((line.match(/"/g)?.length ?? 0) % 2) quoted = !quoted;
      if (quoted) continue;
      const records = parseDelimited(record, extname(name).toLowerCase() === '.tsv' ? '\t' : ','); record = '';
      for (const cells of records) {
        header ??= cells; row++;
        if (!emit(sourceUnit(`${row > 1 ? `열: ${header.join(' | ')}\n` : ''}${cells.join(' | ')}`, `CSV 행 ${row}`, 'table', cells))) { complete = false; break; }
      }
      if (!complete) break;
    }
    if (complete && (quoted || record)) throw new CorpusError('unclosed_csv_quote');
    profile.routes.push({ route: 'table', status: 'ready', detail: '행과 헤더를 보존한 구조 단위' });
  } else {
    let body = ''; let headings: string[] = []; let first = 1; let lineNumber = 0; let fence = '';
    for await (const raw of lines(path)) {
      lineNumber++; const line = raw.replace(/\r?\n$/, '');
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = ''; }
      const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        if (!emit(sourceUnit(body.replace(/\n$/, ''), `본문 ${first}행`, 'text', undefined, [...headings], 'section'))) { complete = false; break; }
        body = ''; headings = headings.slice(0, heading[1].length - 1); headings[heading[1].length - 1] = heading[2]; first = lineNumber;
      }
      body += line + (raw.endsWith('\n') ? '\n' : '');
      if (body.length > 2_000_000) throw new CorpusError('source_unit_requires_subdivision', 413);
    }
    if (complete) complete = emit(sourceUnit(body, `본문 ${first}행`, 'text', undefined, [...headings], 'section'));
    profile.routes.push({ route: 'text', status: 'ready', detail: '제목과 절을 보존한 구조 단위' });
    // Markdown tables remain in their parent section in this streaming route; no invented cell boundaries.
    if (profile.format === 'markdown') profile.warnings.push('큰 Markdown의 표는 절 안의 원문으로 보존합니다. 별도 행·열 추출은 수행하지 않았습니다.');
  }
  if (seen < startUnit) throw new CorpusError('intake_checkpoint_invalid', 409);
  if (complete && seen === 0) {
    profile.routes = [{ route: 'review', status: 'needs_review', detail: '읽을 수 있는 본문이 없습니다.' }];
  }
  return { profile, progress: { cursor, complete } };
}

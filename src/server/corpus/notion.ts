import ky from 'ky';
import type { CorpusChunk, CorpusProfile } from '../../shared/corpus.js';
import { chunkText, CorpusError, MAX_SOURCE_BYTES } from './extract.js';
import { sourceUnit } from './source-reader.js';
import type { SourceUnit } from '../../shared/corpus.js';
import type { CorpusInput } from './service.js';

export const NOTION_VERSION = '2026-03-11';
type Json = Record<string, any>;

export function notionPageId(value: string): string {
  let candidate = value.trim();
  if (candidate.startsWith('https://')) {
    const url = new URL(candidate);
    if (!/(^|\.)(notion\.so|notion\.site|notion\.com)$/.test(url.hostname)) throw new CorpusError('invalid_notion_page', 400);
    candidate = url.pathname.split('/').filter(Boolean).pop() ?? '';
  }
  const match = candidate.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  if (!match) throw new CorpusError('use_notion_page_id_or_url', 400);
  const id = match[1].replace(/-/g, '').toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
export async function readBounded(response: Response, limit = MAX_SOURCE_BYTES): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new CorpusError('download_too_large', 413); }
  const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const parts: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new CorpusError('download_too_large', 413);
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(parts);
}
const richText = (value: unknown): string => Array.isArray(value) ? value.map(v => String(v?.plain_text ?? v?.text?.content ?? '')).join('') : '';

export class NotionReadonlyProvider {
  constructor(private token: string, private endpoint = 'https://api.notion.com/v1') {}
  async readPage(input: string, labels: string[] = []): Promise<CorpusInput> {
    if (!this.token) throw new CorpusError('notion_not_configured', 503);
    const id = notionPageId(input); let totalBytes = 0; let requests = 0;
    const http = ky.create({ headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': NOTION_VERSION },
      timeout: 15_000, totalTimeout: 30_000, retry: { limit: 2, methods: ['get'], statusCodes: [429, 502, 503, 504], maxRetryAfter: 5000 }, redirect: 'error' });
    const get = async (path: string): Promise<Json> => {
      if (++requests > 200) throw new CorpusError('notion_request_limit', 413);
      const response = await http.get(`${this.endpoint}/${path}`, { throwHttpErrors: false });
      if (!response.ok) throw new CorpusError(response.status === 401 || response.status === 403 || response.status === 404 ? 'notion_page_not_accessible' : 'notion_provider_error', response.status === 429 ? 503 : 502);
      const bytes = await readBounded(response, 2 * 1024 * 1024); totalBytes += bytes.length;
      if (totalBytes > MAX_SOURCE_BYTES) throw new CorpusError('notion_page_too_large', 413);
      return JSON.parse(bytes.toString('utf8')) as Json;
    };
    const before = await get(`pages/${id}`);
    if (before.archived || before.in_trash || before.object !== 'page' || !before.last_edited_time) throw new CorpusError('notion_page_not_accessible', 403);
    const blocks: Json[] = []; const seen = new Set<string>();
    const walk = async (parent: string, depth: number): Promise<void> => {
      if (depth > 20) throw new CorpusError('notion_depth_limit', 413);
      let cursor: string | undefined; const cursors = new Set<string>();
      do {
        const query = new URLSearchParams({ page_size: '100' }); if (cursor) query.set('start_cursor', cursor);
        const page = await get(`blocks/${encodeURIComponent(parent)}/children?${query}`);
        if (!Array.isArray(page.results)) throw new CorpusError('invalid_notion_response', 502);
        for (const block of page.results) {
          if (typeof block.id !== 'string' || typeof block.type !== 'string') throw new CorpusError('invalid_notion_block', 502);
          if (seen.has(block.id)) throw new CorpusError('notion_duplicate_block', 409);
          seen.add(block.id); blocks.push({ ...block, corpus_parent_id: parent });
          if (blocks.length > 2000) throw new CorpusError('notion_block_limit', 413);
          // 다른 페이지와 DB는 독립적인 선택/버전 범위로 등록한다.
          if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') await walk(block.id, depth + 1);
        }
        cursor = page.has_more ? page.next_cursor : undefined;
        if (page.has_more && (!cursor || cursors.has(cursor))) throw new CorpusError('notion_pagination_error', 502);
        if (cursor) cursors.add(cursor);
      } while (cursor);
    };
    await walk(id, 0);
    const after = await get(`pages/${id}`);
    if (after.archived || after.in_trash) throw new CorpusError('notion_page_not_accessible', 403);
    if (before.last_edited_time !== after.last_edited_time) throw new CorpusError('source_changed_retry', 409);
    const titleProperty = Object.values(before.properties ?? {}).find((v: any) => v?.type === 'title') as Json | undefined;
    const title = richText(titleProperty?.title) || `Notion ${id}`;
    const chunks: CorpusChunk[] = []; const warnings = ['페이지 본문·속성·블록 JSON 스냅샷입니다. 첨부파일 원본, 하위 페이지, 데이터베이스 전체 백업은 포함하지 않습니다.'];
    const units: SourceUnit[] = [];
    const add = (text: string, block: Json, cells?: string[], headings: string[] = []) => {
      if (!text.trim()) return;
      const unit = sourceUnit(text, `Notion 블록 ${block.id}`, cells ? 'table' : 'text', cells, headings, cells ? 'row_with_header' : 'block');
      units.push(unit); chunks.push(...chunkText(text, unit.locator, unit.kind).map(chunk => ({ ...chunk, unitId: unit.id })));
    };
    const headingsByParent = new Map<string, string[]>();
    const blockHeadings = new Map<string, string[]>();
    const routes: CorpusProfile['routes'] = [];
    for (const block of blocks) {
      const parentId = String(block.corpus_parent_id);
      let headings = headingsByParent.get(parentId);
      if (!headings) {
        headings = [...(blockHeadings.get(parentId) ?? [])];
        headingsByParent.set(parentId, headings);
      }
      const content = block[block.type] ?? {};
      if (block.type === 'table_row') {
        const cells = Array.isArray(content.cells) ? content.cells.map(richText) : [];
        const parent = blocks.find(item => item.id === block.corpus_parent_id);
        const header = parent?.table?.has_column_header ? blocks.find(item => item.type === 'table_row' && item.corpus_parent_id === block.corpus_parent_id) : undefined;
        const headerText = header ? (header.table_row.cells as Json[]).map(richText).join(' | ') : '';
        add(`${headerText ? `열: ${headerText}\n` : ''}${cells.join(' | ')}`, block, cells, [...headings]);
      } else {
        const text = richText(content.rich_text) || richText(content.caption);
        const heading = block.type.match(/^heading_([123])$/);
        if (heading) { headings.length = Number(heading[1]) - 1; headings.push(text); }
        if (text) add(text, block, undefined, [...headings]);
      }
      blockHeadings.set(block.id, [...headings]);
      if (['image', 'pdf'].includes(block.type)) routes.push({ route: 'ocr', status: 'needs_tool', detail: `첨부 원본을 별도로 등록하세요: ${block.id}` });
      if (['audio', 'video'].includes(block.type)) routes.push({ route: 'transcription', status: 'needs_tool', detail: `첨부 원본을 별도로 등록하세요: ${block.id}` });
      if (['file', 'child_page', 'child_database', 'unsupported', 'synced_block'].includes(block.type)) warnings.push(`별도 확인 필요: ${block.type} (${block.id})`);
    }
    if (chunks.some(c => c.kind === 'text')) routes.push({ route: 'text', status: 'ready', detail: '블록 ID를 포함한 본문 검색' });
    if (chunks.some(c => c.kind === 'table')) routes.push({ route: 'table', status: 'ready', detail: 'Notion 표 셀 보존' });
    if (labels.length && chunks.length) routes.push({ route: 'graph', status: 'ready', detail: '사용자가 지정한 업무 분류로 연결' });
    if (!chunks.length) routes.push({ route: 'review', status: 'needs_review', detail: '추출 가능한 본문이 없습니다.' });
    if (chunks.length > 10_000 || chunks.reduce((sum, c) => sum + c.text.length, 0) > 4_000_000) throw new CorpusError('extracted_text_limit', 413);
    // 수집 시각은 바이트 해시에서 제외한다. 같은 버전을 다시 읽으면 같은 스냅샷을 재사용한다.
    const bytes = Buffer.from(JSON.stringify({ notionVersion: NOTION_VERSION, page: before, blocks }));
    return { provider: 'notion', externalId: id, providerRevision: before.last_edited_time, name: `${title.slice(0, 230)}.json`,
      mime: 'application/json', sourceUrl: `https://www.notion.so/${id.replace(/-/g, '')}`, bytes, labels, backup: 'page_snapshot',
      extracted: { profile: { format: 'json', mime: 'application/json', evidence: [`notion-page:${id}`, `api:${NOTION_VERSION}`], warnings, routes }, chunks, units } };
  }
}

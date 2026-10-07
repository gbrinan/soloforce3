export type CorpusFormat = 'text' | 'markdown' | 'csv' | 'json' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'hwpx' | 'image' | 'audio' | 'video' | 'unknown';
export type CorpusRoute = 'text' | 'table' | 'graph' | 'ocr' | 'transcription' | 'review';
export interface CorpusProfile {
  format: CorpusFormat;
  mime: string;
  evidence: string[];
  warnings: string[];
  routes: { route: CorpusRoute; status: 'ready' | 'needs_tool' | 'needs_review'; detail: string }[];
}
export interface CorpusChunk {
  id: string;
  kind: 'text' | 'table';
  locator: string;
  text: string;
  // 표의 값은 문자열로 보존한다. 숫자 변환이나 수식 재계산을 하지 않는다.
  cells?: string[];
  /** Search derivatives refer to a structural unit; cell arrays live there once. */
  unitId?: string;
}
export interface SourceUnit {
  id: string;
  kind: 'text' | 'table';
  locator: string;
  text: string;
  headingPath: string[];
  cells?: string[];
  contextStatus: 'section' | 'row_with_header' | 'page' | 'block';
}
export interface CorpusSnapshot {
  schemaVersion: 1;
  pipelineVersion: string;
  sourceId: string;
  revision: string;
  contentHash: string;
  provider: 'local' | 'google-drive' | 'notion';
  externalId: string;
  connectionId?: string;
  providerRevision?: string;
  sourceUrl?: string;
  name: string;
  importedAt: string;
  bytes: number;
  // 사용자가 입력한 업무 분류. 추론한 관계를 사실로 승격하지 않는다.
  labels: string[];
  profile: CorpusProfile;
  chunks: CorpusChunk[];
  units?: SourceUnit[];
  backup: 'original' | 'export' | 'page_snapshot';
}
export interface CorpusSource extends Omit<CorpusSnapshot, 'chunks' | 'units'> {
  chunkCount: number;
  enabled: boolean;
  revisions: number;
  unitCount?: number;
}
export interface CorpusHit {
  sourceId: string;
  revision: string;
  chunkId: string;
  title: string;
  locator: string;
  text: string;
  score: number;
  signals: ('keyword' | 'vector' | 'graph')[];
  context?: { unitId: string; locator: string; text: string; complete: boolean; reason?: string };
}
export interface CorpusSearchResult {
  hits: CorpusHit[];
  mode: 'keyword_graph' | 'keyword_vector_graph';
  warnings: string[];
}

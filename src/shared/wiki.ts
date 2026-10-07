export interface WikiScope { orgId: string; projectId: string }
export interface WikiUnit { unit_id: string; locator: string; text: string; cells?: string[] }
export interface WikiRequest {
  schema_version: string; request_id: string; source_id: string; source_revision: string;
  org_id: string; project_id: string; model: string; prompt: string; units: WikiUnit[]; structure: unknown;
}
export interface WikiNeed {
  /** Optional for legacy responses; allowed kinds are validated by the pinned core. */
  kind?: string;
  title: string; statement: string; details: string[]; departments: string[];
  patterns: string[]; evidence: string[]; claim_status: 'source_reported';
}
export interface WikiResponse {
  request_id: string;
  results: { unit_id: string; status: 'analyzed' | 'ambiguous'; needs: WikiNeed[] }[];
}
export interface WikiPayload {
  schemaVersion: 1; upstreamCommit: string; scope: WikiScope;
  source: { sourceId: string; revision: string; sha256: string; parserVersion: string; name: string };
  coverage: { totalUnits: number; selectedUnitIds: string[]; omittedUnitIds: string[]; pendingRoutes: string[];
    pendingUnits?: { unit_id: string; reason: string }[] };
  requestBytes?: number[];
  budget?: { max_characters: number; max_utf8_bytes: number; token_count: string };
  requests: WikiRequest[];
}
export interface WikiCandidate {
  id: string; requestId: string; response: WikiResponse;
  artifacts: Record<string, string>;
  validation: { structural_pass: boolean; semantic_review: 'pending'; published: false; needs: number; ambiguous_units: string[] };
}
export interface WikiJob {
  id: string; payload: WikiPayload; candidates: WikiCandidate[];
  sourceState: 'unchanged' | 'changed'; state: 'awaiting_response' | 'partial' | 'candidate_saved' | 'needs_subdivision';
  semanticReview: 'pending'; published: false; driveSync: 'not_configured';
}
export interface WikiJobSummary {
  id: string; sourceState: 'unchanged' | 'changed'; candidateCount: number; requestCount: number;
}

export interface WikiReview {
  id: string; scope: WikiScope; jobId: string; candidateId: string; unitId: string; needIndex: number;
  verdict: 'accept' | 'hold' | 'reject'; reason: string; conditionsChecked: boolean;
  reviewer: string; recordedAt: string; baseSnapshot: string | null;
  knowledgeId: string; expectedRevision: number | null; coverage: WikiPayload['coverage'];
}
export interface WikiKnowledge {
  id: string; revision: number; kind: string; owner_scope: WikiScope;
  title: string; statement: string; details: string[]; departments: string[]; domains: string[];
  patterns: string[]; evidence: string[]; claim_status: 'source_reported'; lifecycle: 'current';
  semantic_review: 'accepted'; recorded_at: string; valid_from: 'unknown'; valid_to: 'unknown';
  provenance: { source_id: string; source_revision: string; locator: string; evidence_kind: 'EXTRACTED';
    corpus_source_id: string; corpus_revision: string };
  origin: { jobId: string; candidateId: string; unitId: string; needIndex: number }; review_id: string;
  conditions: { status: 'human_checked_selected_units'; coverage: WikiPayload['coverage']; unread_dependencies: 'unverified'; note: string };
}
export interface WikiKnowledgeView { snapshot: string; knowledge: WikiKnowledge; sourceState: 'unchanged' | 'changed' }

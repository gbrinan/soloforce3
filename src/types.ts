export type AgentRole = string;

export interface AgentConfig {
  role: AgentRole;
  name: string;
  systemPrompt: string;
  allowedTools: string[];
  /** 도구 없이 텍스트만 생성하는 내부 유틸(요약·메모리 플러시 등). 도구 0 가드를 명시적으로 면제한다. */
  textOnly?: boolean;
  maxTurns: number;
  readPaths?: string[];
  writePaths?: string[];
  denyPaths?: string[];
  bashCommands?: string[];
  bashPaths?: string[];
  /** Bash 추가 허용 베이스 경로 (cwd 외부 디렉토리 화이트리스트). MCP_BASH_EXTRA_BASES로 전달. */
  bashExtraBases?: string[];
  /** 쓰기 추가 허용 베이스 경로 (cwd 외부 디렉토리 화이트리스트, writePaths 패턴 적용). MCP_WRITE_EXTRA_BASES로 전달. read에도 자동 포함. */
  writeExtraBases?: string[];
  readSensitivePaths?: string[];
  writeSensitivePaths?: string[];
  bashSensitivePatterns?: string[];
  maxCacheTokens?: number;
  model?: string | null;
  /**
   * 계획 단계(runPlanApprovalGate)에서만 쓸 모델. 미지정이면 model 을 그대로 쓴다(기존 동작 불변).
   * runWorkerAgent 가 worker-stage-model.ts 로 계산해 주입한다.
   */
  planModel?: string | null;
  // CLI --effort 수준 (low|medium|high). 미지정 시 CLI 기본.
  effort?: string | null;
  enablePlaywright?: boolean;
  /** 이 에이전트에 할당된 추가 MCP 서버 이름들 (mcp-registry 참조). safefs는 항상 기본 포함. (Phase2) */
  mcpServers?: string[];
  /** true면 인터랙티브 PTY로 실행 (워커 인터랙티브 전환). 미지정/false면 -p 모드. */
  interactive?: boolean;
  /**
   * 이 에이전트에 추가로 전달할 환경변수 키 목록 (process.env에서 필터).
   * 미지정/빈 배열 시 safeChildEnvForCli() 기본 화이트리스트만 전달.
   */
  allowedEnvKeys?: string[];
  /** 서비스 정책에 의해 추가로 차단할 MCP 도구 이름 목록 */
  extraDisallowedTools?: string[];
  /**
   * 권한 레벨 — UI 셀렉트로 변경 가능 (restricted/standard/admin).
   * agent.ts에서 claude CLI `--permission-mode` 매핑:
   *   admin → bypassPermissions
   *   standard → acceptEdits
   *   restricted → default
   * 미지정 시 기존 동작(bypassPermissions) 유지 — 하위호환.
   */
  permissionLevel?: string;
}

export interface AgentCost {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  durationMs: number;
  model?: string;
  /** costUsd 산정 방식(cli | session-delta | tokens | unpriced). 2026-10-02 이전 행에는 없다. 등급 해석은 cost-ledger.ts. */
  costMethod?: string;
}

export interface AgentResult {
  agentRole: AgentRole;
  taskId: string;
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  cost?: AgentCost;
}

export type JobStatus =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "completed"
  | "outputs_missing"
  | "failed"
  | "paused"
  | "done";

export type JobPriority = "high" | "normal" | "low";

export interface Job {
  id: string;
  request: string;
  projectName?: string;
  cwd?: string;
  agent?: string;
  priority: JobPriority;
  afterJobId?: string;
  /** DAG 형태 다중 의존성 (Downloads 스키마 호환). 우선순위: afterJobIds > afterJobId. getJobDeps 헬퍼로 통합 조회. */
  afterJobIds?: string[];
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logs: string[];
  attachments?: string[];
  error?: string;
  plan?: string;
  planAttempts?: number;
  planHistory?: string[];
  reportedToGenie?: boolean;
  reportAttempts?: number;
  leaseUntilMs?: number;
  selfRestart?: boolean;
  skipPlanGate?: boolean;
  skipOutput?: boolean;
  leaseSec?: number;
  maxTurns?: number;
  outputFiles?: string[];
  // 자동 회수용 baseline: lease 시작 시점 outputs/{agent}/ 파일명 → mtime(epoch ms) 스냅샷.
  // checkExpiredLeases에서 baseline 대비 신규/갱신 파일이 있으면 status=completed로 자동 회수.
  outputsBaseline?: Record<string, number>;
  /**
   * lease 획득 시점의 «코드 파일 미커밋 변경» 경로 집합. 잡 종료 시 다시 찍어 차집합을 내면
   * 「이 잡이 실제로 코드를 바꿨는가」가 나온다. 자동 QA 발동 판정의 주 신호.
   * undefined = 판정 불가(git 없음/실패) → 안전측으로 QA 를 수행한다.
   */
  codeBaseline?: string[];
  // 자식 claude CLI PID. lease 만료 + 자동 회수 불가 시 SIGKILL 대상.
  // 부팅 시 stale 처리 (loadJobs에서 undefined로 클리어 — 자식은 부모와 함께 죽음).
  childPid?: number;
  // 직원 raw 응답 풀 본문 (logs[결과]는 2000자 preview, fullResult는 절단 없음).
  fullResult?: string;
  stages?: string[];
  stageAgents?: string[];
  currentStage?: number;
  stageResults?: string[];
  // 워커 raw 응답 풀 본문 (Phase2 신규 파일 호환 — 현재 런타임 미배선)
  content?: string;
  // 워커가 제공한 요약 (Phase2 신규 파일 호환)
  summary?: string;
  costUsd?: number;
  totalTokens?: number;
  /** 이 job을 생성한 마이크루 turn ID (완료 시 순서 보장용) */
  genieTurnId?: string;
  /** Job 결과 분류 (WorkerResult.outcome을 Job 레벨로 승격 — Downloads 호환). */
  outcome?: "success" | "fail" | "review";
  /** DelegatePlan으로 묶인 Task ID (옵셔널 — Task 단위 advance 조회 키). */
  taskId?: string;
  /** Task 제목 캐시 (UI 표시·로그용). */
  taskTitle?: string;
  /** 자동 QA 트리거로 생성된 잡임을 표시 (재귀 차단용 — true면 추가 자동 QA 안 함). */
  qaTriggered?: boolean;
  /** 호출자가 명시적으로 자동 QA를 옵트아웃 (예: selfRestart 트리거·단순 토글 작업). */
  skipQa?: boolean;
  /** 호출자가 명시적으로 자동 QA를 요청 (코드 변경이 아니어도 QA 강제). */
  forceQa?: boolean;
  /**
   * 재제출 체인 추적용 — 산출물 검증 FAIL로 재제출된 job의 최초 원본 job ID.
   * precheckArtifacts에서 mtime 비교 기준을 "재제출 job의 startedAt"이 아닌
   * "원본 job의 startedAt"으로 잡아야 무한 루프 차단됨.
   * 재제출이 다시 재제출돼도 항상 최초 원본 ID 유지 (체인 평탄화).
   */
  originalJobId?: string;
  /** 산출물 검증 FAIL로 인한 재제출 누적 횟수. MAX_RESUBMIT 초과 시 자동 중단. */
  resubmitCount?: number;
  /**
   * job 단위 모델 오버라이드 — 지정 시 워커 에이전트의 기본 모델(agents.json model/modelTier) 대신 이 모델로 spawn.
   * 미지정 시 기존 동작 불변(에이전트 기본값 사용).
   */
  model?: string | null;
  // CLI --effort 수준 (low|medium|high). 미지정 시 CLI 기본.
  effort?: string | null;
  /**
   * 상류(Anthropic) 세션/사용 한도로 잡을 지연시킨 재개 시각 (epoch ms).
   * 설정되면 status는 `queued`로 되돌아가고, processQueue가 이 시각 전에는 잡을 집지 않는다.
   * 한도 소진은 작업 결함이 아니라 재시도 대상이라 `failed`로 종결하지 않는다 (upstream-limit.ts 참조).
   */
  deferredUntilMs?: number;
  /** 한도로 지연된 누적 횟수. MAX_DEFERRALS 초과 시 기존대로 failed로 종결 (무한 순환 방지). */
  deferCount?: number;
  /** 재시도 중 모델 티어 자동 승격이 이미 적용됐는지 — job당 1회 상한(무한 승격 방지)을 위한 플래그. */
  escalatedTier?: boolean;
  /** 승격 전 모델 ID (지표 기록·로그 표시용, escalatedTier=true일 때만 값 존재). */
  escalatedFromModel?: string;
  /** 승격 후 모델 ID (지표 기록·로그 표시용, escalatedTier=true일 때만 값 존재). */
  escalatedToModel?: string;
  /**
   * 실행 중 claude 세션 ID — stream-json system/init 이벤트에서 조기 캡처(체크포인트).
   * SIGKILL(lease 만료)·크래시로 결과를 못 받아도 다음 재시도가 --resume으로 진행분을 이어감.
   */
  sessionId?: string;
}

export type GenieTodoState =
  | "received"
  | "delegated"
  | "plan_review"
  | "working"
  | "reporting"
  | "done"
  | "closed"
  | "failed"
  | "stuck"
  | "cancelled";

export interface GenieTodo {
  id: string;
  origin: string; // 'user' | 'genie' | 'agent:<id>'
  instruction: string;
  createdAt: string;
  status: "pending" | "done";
  state?: GenieTodoState;
  stateHistory?: Array<{ state: GenieTodoState; at: string; note?: string }>;
  stages?: string[];
  stageAgents?: string[];
  currentStage?: number;
  /** 담당 에이전트 표시명. job 시작(processJob) 시 영구 저장 — jobs store가 정리돼도 "미배정"으로 안 떨어지게 함. */
  agentName?: string;
  stuckNotifiedAt?: string;
  /** stuck/failed 재알림(renotify) 누적 횟수. 상한 초과 시 자동 종결(cancelled) 트리거. */
  renotifyCount?: number;
  reportedAt?: string;
  relatedJobIds?: string[];
  /** cron 트리거로 생성된 todo면 원본 cron expression. UI 카드 메타 표시·반복 안내용. */
  cronExpr?: string;
  /** 루틴 인스턴스 todo면 GenieTask.routineType에서 전파된 구분값. */
  routineType?: 'master' | 'instance';
  /** 루틴 인스턴스 todo가 참조하는 마스터 task ID. GenieTask.masterTaskId에서 전파. */
  masterTaskId?: string;
}

// === Task (사용자 지시 1건 — Todo들의 상위 묶음). Phase2 신규 파일(tasks.ts) 호환용 추가. ===
export type GenieTaskStatus = "active" | "done" | "cancelled";

export interface GenieTask {
  id: string;
  origin: string; // 'user' | 'genie' | 'agent:<id>' | 'schedule' | 'external'
  instruction: string;
  createdAt: string;
  status: GenieTaskStatus;
  todoIds: string[];
  doneAt?: string;
  doneSummary?: string;
  /** 루틴 마스터/인스턴스 구분. 마스터: cron 정의(todo 없음), 인스턴스: 트리거마다 생성. */
  routineType?: 'master' | 'instance';
  /** 인스턴스 task가 참조하는 마스터 task ID. */
  masterTaskId?: string;
  /** 마스터 카드 주기 표시용 cron 표현식. */
  cronExpr?: string;
}


// === 동료 비서 통합 (B2B 비서 간 메시징) ===

export type ExternalMessageType = "request" | "reply" | "notification" | "token_update" | "resume_share";

export type ExternalMessageDirection = "inbound" | "outbound";

export type ExternalMessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "received"
  | "auto_handled"
  | "awaiting_approval"
  | "approved_handled"
  | "rejected"
  | "error";

export type ExternalMessageClassification =
  | "info"
  | "info_with_files"
  | "simple_answer"
  | "delegation"
  | "data_share"
  | "financial"
  | "token_update"
  | "ambiguous";

export type ExternalHandlingMode = "auto" | "approval_required" | "asked_owner";

export interface PartnerScope {
  canDelegate?: boolean;
  canAccessFiles?: boolean;
  allowedTopics?: string[];
  allowExternalShelfShare?: boolean;
}

export interface PartnerTokenHistoryEntry {
  rotatedAt: string;
  rotatedBy: "us" | "them";
  reason?: string;
  field: "inbound" | "outbound";
}

export interface MyProfile {
  companyName: string;
  department?: string;
  contactName: string;
  secretaryName: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface Partner {
  id: string;
  companyName: string;
  department?: string;
  contactName: string;
  secretaryName?: string;
  contactEmail?: string;
  contactPhone?: string;
  apiUrl: string;
  outboundToken: string;
  inboundToken: string;
  scope?: PartnerScope;
  registeredAt: string;
  registeredBy?: string;
  active: boolean;
  tokenHistory: PartnerTokenHistoryEntry[];
  // 자동 비활성 카운터 (rate limit 30분 5회 초과 시 active=false 트리거)
  rateBreaches?: Array<{ at: string }>;
  // presence: 친구 측이 우리에게 응답한 마지막 시각 (inbound 수신 또는 health ping 200 응답)
  lastSeenAt?: string;
  /** 이력서를 이 동료에게 마지막으로 공유한 시각. 값 없으면 미공유. (Phase2 resume-share) */
  resumeSharedAt?: string;
}

export interface ExternalInjectionFlag {
  pattern: string;
  detectedAt: string;
}

export interface SharedSchedule {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  color?: "blue" | "green" | "red" | "yellow" | "violet" | "orange";
}

export interface ExternalMessagePayload {
  newToken?: string;
  kind?: "schedule_request" | "schedule_response";
  requestId?: string;
  from?: string;
  to?: string;
  schedules?: SharedSchedule[];
  [key: string]: unknown;
}

export interface ExternalMessage {
  id: string;
  partnerId: string;
  threadId: string;
  direction: ExternalMessageDirection;
  senderLabel: string;
  recipientLabel: string;
  body: string;
  bodyLength: number;
  receivedAt: string;
  sentAt?: string;
  status: ExternalMessageStatus;
  messageType?: ExternalMessageType;
  classification?: ExternalMessageClassification;
  handlingMode?: ExternalHandlingMode;
  handledByGenieTodoId?: string;
  inReplyToMessageId?: string;
  injectionFlags?: ExternalInjectionFlag[];
  errorReason?: string;
  payload?: ExternalMessagePayload;
  attachments?: ExternalAttachment[];
  // 사용자가 동료 드로어에서 숨긴 메시지 — 전송 여부 무관. 목록/뱃지에서 제외(soft-hide, 복구 가능).
  hidden?: boolean;
}

export interface ExternalAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;          // 원본 바이트
  storagePath?: string;  // 수신 쪽 저장 경로 (발신 쪽엔 없음)
}

// === Partner Request (동료 자동 등록 요청) ===

export type PartnerRequestStatus = "pending" | "approved" | "rejected" | "expired" | "failed";

export type PartnerRequestRejectReason =
  | "out_of_scope"
  | "unknown_company"
  | "suspicious"
  | "scope_too_broad"
  | "other";

// 외부 → 우리 (POST /api/external/partner-request body)
export interface PartnerRequestBody {
  companyName: string;        // max 128
  contactName: string;        // max 64
  secretaryName?: string;     // max 64
  department?: string;        // max 64
  contactEmail?: string;      // max 128
  contactPhone?: string;      // max 32
  apiUrl: string;             // https + 사설 IP 차단
  inboundToken: string;       // 외부 입장에서 발급한, 우리가 외부 호출 시 쓸 토큰 (32~64 hex)
  scope?: PartnerScope;
  message?: string;           // max 4000자
  timestamp: string;          // ISO 8601 — drift ±60s
  requestId: string;          // UUID — 클라가 생성
  // 콜백 인증용 (옵션 B 헤더 방식)
  callbackSecret: string;     // 32 hex — 외부가 콜백 시 X-Partner-Request-Callback-Secret 헤더로 echo
}

// 우리 → 외부 즉시 응답
export interface PartnerRequestImmediateResponse {
  ok: boolean;
  requestId?: string;
  status?: PartnerRequestStatus;
  expiresAt?: string;
  error?:
    | "rate_limit"
    | "https_required"
    | "private_ip"
    | "schema_invalid"
    | "duplicate_pending"
    | "queue_full"
    | "ip_blacklisted"
    | "timestamp_drift"
    | "payload_too_large"
    | "injection_detected";
}

// 우리 → 외부 비동기 콜백 (POST <외부>/api/external/partner-request-result)
export interface PartnerRequestCallback {
  requestId: string;
  status: "approved" | "rejected" | "expired";
  // approved 시 — 콜백 발신 측 자기 회사 정보 (받는 측이 partners.json 등록에 사용)
  inboundToken?: string;        // 외부가 우리를 호출할 때 쓸 토큰 (= 우리 partner.inboundToken)
  partnerId?: string;
  scope?: PartnerScope;
  partnerCompanyName?: string;  // 콜백 발신 측 회사명 (받는 측 입장에서 동료 회사명)
  partnerContactName?: string;
  partnerSecretaryName?: string;
  partnerDepartment?: string;
  partnerContactEmail?: string;
  partnerContactPhone?: string;
  // rejected
  reason?: PartnerRequestRejectReason;
  reasonText?: string;          // other 시만, max 64
}

// 영속 (history/external/partner-requests.jsonl) — append + update 라인
export interface PartnerRequest {
  id: string;                 // = body.requestId
  receivedAt: string;
  status: PartnerRequestStatus;
  body: PartnerRequestBody;   // 디스크에는 inboundToken·callbackSecret 마스킹된 본문 저장 (메모리 캐시는 평문)
  sourceIp: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedBy?: "owner" | "auto-expire" | "auto-fail";
  rejectReason?: PartnerRequestRejectReason;
  rejectReasonText?: string;
  resultDeliveredAt?: string;
  resultDeliveryAttempts?: number;
  scopeOverride?: PartnerScope;
  /** 승인 콜백 자체가 실패한 횟수 (재시도 내부 attempts와 별개, approve() 호출 단위). N회 이상이면 status=failed 자동 전환. */
  approvalFailureCount?: number;
  /** status=failed로 전환된 최종 사유 (sendResult.errorReason). */
  failReason?: string;
}

// 발신 측 (A) in-memory cache — 콜백 받기까지 유지. 부팅 시 휘발 OK
export interface PartnerRequestSentCache {
  requestId: string;
  targetApiUrl: string;
  ourInboundToken: string;    // 평문 — 콜백에서 외부에 전달용
  callbackSecret: string;     // 평문 — 콜백 인증용
  sentAt: string;
  body: PartnerRequestBody;   // 사장님 [재전송] 시 재로드용
}

// === Contacts (마이크루 연락처 — 명함 OCR + 카메라 캡처 + 수동 CRUD) ===

// 출처: photo=사진앱 명함 자동 분류 / camera=카메라 캡처 / manual=수동 입력
export type ContactSource = "photo" | "camera" | "manual";

export interface Contact {
  id: string;
  name: string;
  phone?: string;
  phones?: string[];          // 다중 전화번호 (휴대폰/사무실 등)
  email?: string;
  emails?: string[];          // 다중 이메일
  company?: string;
  department?: string;
  position?: string;
  address?: string;           // 주소
  memo?: string;
  labels: string[];           // 친구·거래처·동료 등 사용자 정의 라벨
  favorite: boolean;
  source: ContactSource;
  // 사진앱 명함 출처일 때 — 원본 자산 참조 (photos 앱 sha256)
  sourcePhotoSha?: string;
  // OCR 신뢰도 (0~1, 사진/카메라 출처일 때만)
  ocrConfidence?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDraft {
  name: string;
  phone?: string;
  phones?: string[];
  email?: string;
  emails?: string[];
  company?: string;
  department?: string;
  position?: string;
  address?: string;
  memo?: string;
  labels?: string[];
  favorite?: boolean;
  source?: ContactSource;
  sourcePhotoSha?: string;
  ocrConfidence?: number;
}

// OCR 파서가 추출한 명함 구조 (사진앱 → 본체 webhook 페이로드)
export interface BusinessCardParsed {
  name?: string;
  phones?: string[];
  emails?: string[];
  company?: string;
  department?: string;
  position?: string;
  rawText: string;
  confidence: number;
}

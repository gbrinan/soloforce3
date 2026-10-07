// 자동 QA 발동 판정 — 순수 모듈.
//
// ★ 2026-08-24 배경: 「자동 QA를 조건부화하자」는 지시를 받았는데, 실측해 보니 **이미 조건부**였다
//   (jobs.ts: forceQa || looksLikeQaRequest || hasCodeChanges). 진짜 결함은 조건이 없는 게 아니라
//   **신호가 오염돼 있던 것**이다:
//     1) hasCodeChanges 가 `git status --porcelain` 으로 «레포 전체 워킹트리»를 봤다.
//        그 잡이 무엇을 바꿨는지와 무관하다. 이 레포에는 진단 스크립트 등 미추적 코드 파일이
//        상시 수십 개 널려 있어 사실상 **모든 잡에서 영구히 true** 였다.
//     2) looksLikeQaRequest 정규식이 `검증|테스트|점검|리뷰|verify` 라 한국어 지시서 거의 전부에 걸린다.
//   ⇒ 조건을 더 얹기 전에 신호부터 잡 범위로 좁혀야 한다. 그게 이 모듈이다.
//
// 설계 원칙(아난 승인 문구 그대로):
//   - 코드 변경이 있는 잡 → 전수 QA 유지. 여기가 실제로 결함이 나오는 곳이다. 줄이지 않는다.
//   - 코드 변경 0건 잡 → 전수 해제. 단 완전히 끄지 않고 주 1회 표본은 돌린다.
//   - 외부 발신이 있으면 코드 변경 0건이어도 전수 QA 유지(되돌릴 수 없다).
//   - 판정 불가능하면 안전한 쪽(= QA 수행)이 기본값이다.

/** 외부 발신 가능성이 상시 있는 에이전트. 여기 없어도 어휘·명시 플래그로 걸릴 수 있다. */
export const EXTERNAL_SEND_AGENTS = new Set<string>([
  "spf-sales", "spf-comms", "spf-logistics", 
  "book-keeper", "lead-keeper", "hermes",
]);

/**
 * 아웃바운드 어휘. 히트해도 «판정»이 아니라 «보수적으로 QA 를 켜는» 방향으로만 쓴다
 * — 오탐의 대가가 QA 1회이고, 미탐의 대가는 되돌릴 수 없는 발신이다.
 * (procedure_contract-gate-lexicon-denial-path: 어휘 히트를 FAIL 로 직결하지 않는다)
 */
// ⚠️ 2026-08-24 시정: 처음엔 `메일\s*보` 였는데 "메일**로** 보내라" 가 안 잡혔다(조사 하나에 뚫린다).
//    한국어 조사를 정규식으로 쫓지 말고 명사만 잡는다 — 오탐의 대가는 QA 1회뿐이다.
const OUTBOUND_RE = /발송|전송|발신|메일|텔레그램|카카오|카톡|디스코드|슬랙|게시|업로드|publish|\bsend\b|\bpost\b|notify/i;

export interface QaDecisionInput {
  /** 잡이 실제로 바꾼 코드 파일 수(= 종료 스냅샷 − 시작 스냅샷). 판정 불가면 null. */
  jobScopedCodeChanges: number | null;
  /** 호출자 명시 — 최우선. */
  forceQa?: boolean;
  skipQa?: boolean;
  /** QA 가 스폰한 잡(재귀 차단). */
  qaTriggered?: boolean;
  agentId: string | undefined;
  request: string;
  /** 이 에이전트의 마지막 «표본» QA 시각(ISO). 없으면 한 번도 안 돌린 것. */
  lastSampleAtIso?: string | null;
  /** 현재 시각(ISO) — 테스트 주입용. */
  nowIso: string;
  /** 표본 주기(일). 기본 7 = 주 1회. */
  sampleIntervalDays?: number;
}

export interface QaDecision {
  run: boolean;
  /** 왜 그렇게 판정했는가 — 잡 로그·원장에 그대로 남긴다. 「조용히 껐다」를 막는다. */
  reason: string;
  /** 이번 판정이 «표본» 자격으로 돌린 것인가(표본 시각 갱신 대상). */
  isSample: boolean;
}

/**
 * 루프 러너가 모든 스텝 요청 앞에 붙이는 정책 문구의 표식.
 * 이 문구에는 "외부 발신·전송은 … 한해서만" 같은 금지 문장이 들어 있어, 어휘 판정이
 * «발신을 금지하는 문장»을 «발신 의심»으로 오인했다. 그 결과 9/15~9/26 자동 QA 74회 중
 * 70회(95%)가 이 오탐으로 발동했다(2026-09-26 실측). 러너 쪽 문구와 표식이 어긋나지 않도록
 * 회귀 테스트가 runner.ts 소스를 직접 대조한다.
 */
export const LOOP_POLICY_MARKER = "[루프 정책]";

/** 루프 러너가 보낸 정기 작업인가. 이런 작업은 루프의 승인 모드·권한 게이트가 발신을 사전에 통제한다. */
export function isLoopDispatched(request: string): boolean {
  return (request || "").includes(LOOP_POLICY_MARKER);
}

export function externalSendSuspected(agentId: string | undefined, request: string): boolean {
  if (agentId && EXTERNAL_SEND_AGENTS.has(agentId)) return true;
  return OUTBOUND_RE.test(request || "");
}

/**
 * 점검용 핑(하네스·헬스 체크) 요청인가. 이런 잡은 검증할 산출물이 없어 QA가 붙으면 비용만 들고
 * "보고 형식 누락"으로 기록된다(2026-09-15 3건). 짧은 요청 + 명시적 핑 표현일 때만 참 — 실제 작업 오탐 방지.
 */
export function isHealthPing(request: string): boolean {
  const r = (request || "").trim();
  if (r.length > 400) return false;
  if (/^[A-Z][A-Z0-9_]*_READY$/.test(r)) return true;
  // 핑의 공통 형태: "도구 호출·파일 읽기를 하지 말고" + "X 한 단어만 반환" (9/15 하네스·Opus·재시작 게이트 핑 전부 이 형태)
  const noTools = /(도구 호출|파일 읽기|외부 조회)[^.\n]{0,30}(하지 마|하지 말|일절)/.test(r);
  const oneWord = /한 단어만\s*(반환|답)/.test(r);
  return noTools && oneWord;
}

/** 주 1회 QA 표본에서 제외하는 수집 전용 에이전트(자체 검증 보유). 코드 변경·외부 발신 QA는 그대로다. */
export const QA_SAMPLE_EXEMPT_AGENTS: ReadonlySet<string> = new Set(["ingestiger", "spf-kakao-collect", "mail-secretary"]);

export function decideQa(input: QaDecisionInput): QaDecision {
  // 0. 옵트아웃 — 새 조건보다 «항상» 세다.
  if (input.qaTriggered) return { run: false, reason: "qa-recursion-guard", isSample: false };
  if (input.skipQa) return { run: false, reason: "skipQa(호출자 명시)", isSample: false };
  if (!input.agentId || input.agentId === "qa" || input.agentId === "dev-pm") {
    return { run: false, reason: `agent-excluded(${input.agentId ?? "none"})`, isSample: false };
  }
  // 1. 명시 요청 — 최우선 발동.
  if (input.forceQa === true) return { run: true, reason: "forceQa(호출자 명시)", isSample: false };

  // 1-1. 점검용 핑 — 검증할 산출물이 없다. 코드 변경 판정보다 먼저 본다(판정 불가 null로 QA가 붙던 경로 차단).
  if (isHealthPing(input.request)) return { run: false, reason: "health-ping(점검용 핑)", isSample: false };

  // 2. 코드 변경 — 여기가 결함이 나오는 곳. 줄이지 않는다.
  //    판정 불가(null)면 안전측으로 «수행».
  if (input.jobScopedCodeChanges === null) {
    return { run: true, reason: "code-change-undetermined(안전측 수행)", isSample: false };
  }
  if (input.jobScopedCodeChanges > 0) {
    return { run: true, reason: `code-change(${input.jobScopedCodeChanges}개 파일)`, isSample: false };
  }

  // 3. 코드 변경 0건 — 외부 발신이면 유지.
  //    단 루프 정기 작업은 제외하고 아래 주 1회 표본으로 보낸다(2026-09-26 아난 결정).
  //    자동 QA는 작업이 «끝난 뒤» 도는 사후 감사라 이미 나간 발신을 막지 못한다 — 루프 발신의
  //    실제 통제는 실행 전 단계(루프 승인 모드·safefs 권한 게이트)가 맡는다.
  if (!isLoopDispatched(input.request) && externalSendSuspected(input.agentId, input.request)) {
    return { run: true, reason: "external-send-suspected(되돌릴 수 없음)", isSample: false };
  }

  // 3-1. 자체 검증이 있는 수집 전용 에이전트는 주 1회 표본에서도 뺀다(2026-10-02 아난 결정).
  //      ingestiger(인용·구조 검증 내장), spf-kakao-collect(파서 검증), mail-secretary(초안만·발송 불가).
  //      코드 변경·외부 발신은 위 2·3단계에서 이미 걸러지므로 여기 도달한 건 단순 수집·정리다.
  if (QA_SAMPLE_EXEMPT_AGENTS.has(input.agentId)) {
    return { run: false, reason: `sample-exempt(수집 전용·자체 검증: ${input.agentId})`, isSample: false };
  }

  // 4. 코드 변경 0건 + 외부 발신 없음 → 주 1회 표본만.
  const days = input.sampleIntervalDays ?? 7;
  const now = Date.parse(input.nowIso);
  const last = input.lastSampleAtIso ? Date.parse(input.lastSampleAtIso) : NaN;
  if (!Number.isFinite(last)) {
    return { run: true, reason: `sample(첫 표본 · 주기 ${days}일)`, isSample: true };
  }
  const elapsedDays = (now - last) / 86400000;
  if (elapsedDays >= days) {
    return { run: true, reason: `sample(마지막 표본 ${elapsedDays.toFixed(1)}일 전 · 주기 ${days}일)`, isSample: true };
  }
  return {
    run: false,
    reason: `no-code-change · no-external-send · 표본 주기 미도래(${elapsedDays.toFixed(1)}/${days}일)`,
    isSample: false,
  };
}

/**
 * 코드 파일 집합의 «잡 범위» 차집합. baseline 에 없던 항목만 이 잡이 만든 변경이다.
 * 문자열 배열만 받는다 — git 실행은 호출부(jobs.ts)에서 한다.
 */
export function newCodeChanges(baseline: string[] | undefined, current: string[]): string[] {
  const seen = new Set(baseline ?? []);
  return current.filter((p) => !seen.has(p));
}

// ── QA 모델 티어 (2026-09-28 아난 결정: 간단한 검증은 terra, 위험한 검증은 sol) ──
export const QA_MODEL_HEAVY = "gpt-5.6-sol";
export const QA_MODEL_LIGHT = "gpt-5.6-terra";

/**
 * QA 잡에 쓸 codex 모델을 고른다. QA가 codex-cli일 때만 값을 돌려주고, 그 밖엔 undefined(에이전트 기본 모델 유지).
 * 코드 변경(판정 불가 포함)·외부 발신 의심·명시 요청·code/data 유형 → heavy, 나머지(루프 표본의 문서·일반 검증) → light.
 */
export function pickQaModel(input: { adapter?: string; reason: string; profile?: string }): string | undefined {
  if (input.adapter !== "codex-cli") return undefined;
  const heavyReason = /^(code-change|external-send|forceQa)/.test(input.reason);
  const heavyProfile = input.profile === "code" || input.profile === "data";
  return heavyReason || heavyProfile ? QA_MODEL_HEAVY : QA_MODEL_LIGHT;
}

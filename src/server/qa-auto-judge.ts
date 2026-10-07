/**
 * QA 자동 판정 연동 (#10)
 * - QA 잡 완료 시 verdict 자동 감지
 * - FAIL → 핫픽스 위임 + 재검증 큐 자동 생성
 * - PASS → self-restart 알림 (필요시)
 * - 3회 연속 FAIL → 사용자 에스컬레이션 + 사이클 중단
 */

import { randomUUID } from "node:crypto";
import { basename, join, isAbsolute } from "node:path";
import { statSync } from "node:fs";
import { resolveArtifactAcrossBases } from "./utils/path-normalize.js";
import { ARTIFACT_EXT, EXT_BOUNDARY } from "./utils/artifact-ext.js";
import type { Job } from "../types.js";
import { PROJECT_SELF_DIR } from "../config.js";
import { addGenieMessage, isSelfRestartPending } from "./chat.js";
import { getWorkerAgent } from "../agent-registry.js";
import { isQaFailVerdict } from "./qa-verdict.js";
import { recordQaRunOutcome } from "./qa-run-failure.js";
import type { TrajectoryVerdict } from "./trajectory-judge.js";

export type QaVerdict = "pass" | "fail" | "unknown";

export interface PrecheckResult {
  pass: boolean;
  failures: string[];
}

// 산출물 실존 해석(NFC/NFD·스코프 폴백)은 ./utils/path-normalize.ts로 공용화됨.
// requirements-ingest.ts의 nfc()와 단일 소스를 공유한다.

// ── 산출물 경로 추출 정규식 공용 빌더 ──────────────────────────────
// [핫픽스 2026-08-08] 확장자 절단 결함 수정 → [2026-08-10] 정의를 ./utils/artifact-ext.ts로 이관.
// 같은 결함이 jobs.ts:2768에서 재발해(seen.jsonl 절단) 확장자 목록·경계 규약을 단일 소스로 모았다.
// 절단 3기전과 (?![A-Za-z0-9])를 쓰는 이유는 그쪽 주석에 전부 남겨뒀다. 여기 값은 동작 불변.
const ARTIFACT_PATH_BODY = "([^\\s`]+\\." + ARTIFACT_EXT + EXT_BOUNDARY + ")";
const MD_PATH_BODY = "([^\\s`]+\\.md(?![A-Za-z0-9]))";

/** 라벨(산출물:/경로: 등) 뒤 파일 경로를 잡는 전역 정규식을 만든다(매 호출 새 인스턴스 → lastIndex 상태 공유 없음). */
function labelPathPattern(label: string, body: string = ARTIFACT_PATH_BODY): RegExp {
  return new RegExp(label + "[:：]\\s*`?" + body, "gi");
}

/** 텍스트에서 라벨 기반 산출물 경로를 추출한다(URL 제외, 확장자 온전 보존). */
function collectLabeledPaths(text: string, patterns: RegExp[]): string[] {
  const out = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const p = m[1].trim();
      if (p && !p.startsWith("http") && !p.includes("://")) out.add(p);
    }
  }
  return [...out];
}

/**
 * 원 작업 요청에서 '명시적으로 요구된 산출물' 경로만 추출한다.
 * 입력/참조 경로(SafeRead 대상 등)는 제외하고 산출 라벨(산출물:/보고서:)만 본다.
 * 용도: 보고서에 산출물 경로가 0개일 때 "도구 없음/미저장" 회피 보고를 실측으로 가려내기 위함.
 */
function extractRequiredArtifacts(request: string): string[] {
  return collectLabeledPaths(request, [
    labelPathPattern("산출물"),
    labelPathPattern("보고서", MD_PATH_BODY),
  ]);
}

/**
 * 작업 완료 보고서 텍스트에서 산출물 경로를 추출한다 (테스트 가능한 순수 함수).
 * 라벨: 수정 파일/생성 파일/산출물/파일/경로/보고서.
 * 확장자 절단 결함(.jsonl→.js 등)은 labelPathPattern 공용 빌더에서 교정됨.
 */
export function extractArtifactPaths(text: string): string[] {
  return collectLabeledPaths(text, [
    labelPathPattern("수정\\s*파일"),
    labelPathPattern("생성\\s*파일"),
    labelPathPattern("산출물"),
    labelPathPattern("파일"),
    labelPathPattern("경로"),
    labelPathPattern("보고서", MD_PATH_BODY),
  ]);
}

/**
 * 작업 완료 보고서에 명시된 산출물 파일 실존·mtime 검증 (거짓 보고 차단)
 * @param job 완료된 워커 잡
 * @param lookupJob 원본 job 조회 콜백 (선택) — 재제출 체인(originalJobId)일 때 mtime 기준점을 원본 job.startedAt으로 잡기 위함.
 *   미제공 시 job.startedAt 그대로 사용 (테스트 호환).
 * @returns { pass: true, failures: [] } 검증 통과 / { pass: false, failures: [...] } 실패 목록
 */
export function precheckArtifacts(
  job: Job,
  lookupJob?: (id: string) => Job | undefined,
): PrecheckResult {
  let text = job.logs.join("\n");

  // 재제출 job(request가 "[산출물 검증 실패 — 재제출 요구]"로 시작하거나 originalJobId 보유)의 경우,
  // 이전 실패 보고서에 포함된 경로("검증 경로: /...")가 경로 추출 대상이 되어 무한 루프를 일으킴.
  // "## 검증 실패 사유" ~ "## 필수 조치" 블록을 스트립한 뒤 파싱한다.
  if (
    job.request.startsWith("[산출물 검증 실패 — 재제출 요구]") ||
    job.originalJobId
  ) {
    text = text.replace(
      /## 검증 실패 사유[\s\S]*?(?=##\s|$)/g,
      "",
    );
  }
  
  // 1. 파일 경로 추출 (명시적 라벨 기반 — 백틱 단독 인용 제외)
  //    확장자 절단 방지(.jsonl/.json.posted 온전 보존) 로직은 extractArtifactPaths로 공용화.
  const paths = new Set<string>(extractArtifactPaths(text));
  
  // 2. 파일 0개 처리
  //    기본: 진단/리서치 작업은 보고서만 작성하므로 PASS.
  //    단, 원 요청이 산출물을 명시적으로 요구했는데 보고서에 경로가 하나도 없으면
  //    "파일도구가 없다"·"저장 못 했다" 류의 무검증 회피 보고일 수 있다 → 요구 경로를
  //    실측 조회해, 하나도 실존하지 않으면 FAIL로 막는다(상위 무검증 신뢰 루프 차단).
  if (paths.size === 0) {
    const required = extractRequiredArtifacts(job.request);
    if (required.length === 0) {
      return { pass: true, failures: [] };
    }
    const zeroBaseDir = job.cwd || PROJECT_SELF_DIR;
    const missing: string[] = [];
    for (const rp of required) {
      // 코드 루트·데이터 루트(MYCREW_HOME) 양쪽 해석 — 단일 베이스는 분리 인스턴스에서
      // 상대경로 산출물 전량을 유령으로 판정한다(상세: resolveArtifactAcrossBases 주석).
      if (!resolveArtifactAcrossBases(rp, zeroBaseDir)) missing.push(rp);
    }
    // 요구 산출물이 하나라도 실존하면 저장은 된 것(워커가 경로 라벨을 안 적었을 뿐) → PASS.
    // 전부 미존재면 회피 보고로 간주 → FAIL.
    if (missing.length === required.length) {
      return {
        pass: false,
        failures: missing.map((p) => `요구된 산출물 미존재(실측 조회): ${p}`),
      };
    }
    return { pass: true, failures: [] };
  }
  
  // 2.5. no-op 보고 감지 (이미 적용/기존 확인 키워드 → mtime 검증 스킵)
  // 용도: dev-pm no-op 보고 무한 루프 차단 — 기존 적용 확인 보고서의 mtime 검증 우회
  const isNoOpReport = /이미\s*(적용|완료|존재)|기존\s*적용\s*확인|no-op/i.test(text);
  
  // 3. 검증: 존재 + mtime (외부 프로젝트는 job.cwd 기준 경로 해석)
  const failures: string[] = [];
  for (const path of paths) {
    // 경로 해석: 절대 경로면 그대로, 상대 경로면 job.cwd 기준
    // (mycrew-photos 등 외부 프로젝트 작업 시 올바른 경로에서 검증)
    const baseDir = job.cwd || PROJECT_SELF_DIR;

    // 존재 검증 (NFC/NFD·bare 파일명 오탐 방지 폴백 + 코드/데이터 루트 양 베이스)
    const resolvedPath = resolveArtifactAcrossBases(path, baseDir);
    if (!resolvedPath) {
      // 진단 문구에는 1차 베이스 후보를 남긴다. 실제로는 MYCREW_HOME까지 조회한 뒤의 미존재다.
      const fullPath = isAbsolute(path) ? path : join(baseDir, path);
      failures.push(`파일 미존재: ${path} (검증 경로: ${fullPath}, MYCREW_HOME 폴백 포함)`);
      continue;
    }
    
    // mtime 검증 (no-op 보고는 스킵)
    // 재제출 체인(originalJobId)이면 원본 job의 startedAt을 기준으로 사용
    // → 재제출 시점 startedAt 사용 시 항상 mtime < startedAt이 되어 무한 루프 발생하는 문제 차단
    if (!isNoOpReport) {
      let baselineStartedAt = job.startedAt;
      if (job.originalJobId && lookupJob) {
        const origJob = lookupJob(job.originalJobId);
        if (origJob?.startedAt) baselineStartedAt = origJob.startedAt;
      }
      if (baselineStartedAt) {
        const stat = statSync(resolvedPath);
        const startTime = new Date(baselineStartedAt);
        if (stat.mtime < startTime) {
          failures.push(
            `파일 mtime이 작업 시작 이전: ${path} ` +
            `(mtime=${stat.mtime.toISOString()}, started=${baselineStartedAt}` +
            `${job.originalJobId ? `, originalJobId=${job.originalJobId.slice(0, 8)}` : ""})`,
          );
        }
      }
    }
  }
  
  return { pass: failures.length === 0, failures };
}

// <!--QA_AUTO_CYCLE:cycleId:failCount-->
const CYCLE_TAG_RE = /<!--QA_AUTO_CYCLE:([^:>]+):(\d+)-->/;

// cycleId → 현재 연속 FAIL 횟수 (메모리; selfRestart 후 초기화됨 — 의도적)
const activeCycles = new Map<string, number>();
// QA→핫픽스→재QA 자동 사이클 상한. 각 사이클 = QA 세션 + 핫픽스 세션(둘 다 고비용)이라
// 다턴 누적·토큰 소모의 주 증폭원. 2회 실패 시 사람 확인으로 에스컬레이션(무한 반복 차단).
const MAX_FAILS = 2;

function isSelfProject(projectName?: string): boolean {
  if (!projectName) return false;
  const folderName = basename(PROJECT_SELF_DIR);
  const selfNames = new Set(["self", folderName, folderName.toLowerCase()]);
  return selfNames.has(projectName.toLowerCase());
}

export function detectQaVerdict(logs: string[]): QaVerdict {
  const text = logs.join("\n");
  // 조건부 합격 → pass (불합격보다 먼저 체크)
  if (/조건부\s*합격/.test(text)) return "pass";
  // 한국어 판정
  const krMatch = text.match(/종합\s*판정\s*[—–\-]\s*\*\*(합격|불합격)/i);
  if (krMatch) return krMatch[1] === "합격" ? "pass" : "fail";
  // 영문 혼용
  const enMatch = text.match(/\*\*(PASS|FAIL)\*\*/i);
  if (enMatch) return enMatch[1].toUpperCase() === "PASS" ? "pass" : "fail";
  // v0.1.6 폴백: [결과] FAIL / FAIL. 패턴
  if (isQaFailVerdict(text, undefined)) return "fail";
  return "unknown";
}

function extractCycleInfo(request: string): { cycleId: string; failCount: number } | null {
  const m = request.match(CYCLE_TAG_RE);
  if (!m) return null;
  return { cycleId: m[1], failCount: parseInt(m[2], 10) };
}

function inferHotfixAgent(job: Job): string {
  if (isSelfProject(job.projectName)) return "dev-pm";
  const req = job.request;
  if (/planner|cso/i.test(req)) {
    const planner = getWorkerAgent("planner-researcher");
    if (planner) return planner.id;
  }
  return "dev-pm";
}

type CycleInfo = { cycleId: string; failCount: number };

/** PASS 처리 — 사이클 정리 + self restart 알림 (regex/trajectory 양쪽 경로에서 공용) */
function handlePassVerdict(job: Job, cycleInfo: CycleInfo | null): void {
  if (cycleInfo) activeCycles.delete(cycleInfo.cycleId);
  // self 프로젝트 + restart 대기 중 → MyCrew에 알림
  if (isSelfProject(job.projectName) && isSelfRestartPending()) {
    addGenieMessage(
      "[자동 판정] ✅ QA 합격 — self 코드 변경 누적, RESTART 실행 필요.",
      { internal: true },
    );
  }
}

/** QA 요청문에서 검증 대상 원작업의 제목 한 줄을 뽑는다(알림용). */
function qaOriginalTitle(request: string): string {
  const body = request.split(/##\s*원본 (?:요청|QA 대상)/)[1] ?? request;
  const line = body.split("\n").map((l) => l.trim())
    .find((l) => l && !/^\*\*\[루프 정책\]|^\[?(자동 QA|QA 자동)|^<!--|^워커\(|^#/.test(l)) ?? request.split("\n")[0];
  return line.replace(/\*\*/g, "").slice(0, 80);
}

/**
 * "보류" 판정 — 환경(권한·도구·연결) 문제로 QA가 검증 자체를 못 한 경우(2026-09-28).
 * 합격 처리(조건부 포함)하면 작업이 검증된 것처럼 보이고, 불합격 처리하면 워커에게 무의미한 핫픽스가 간다.
 * 보류는 둘 다 하지 않고 아난에게 할 일(보고서의 "아난이 할 일" 줄)만 알린다.
 */
export function detectQaHold(text: string): { hold: boolean; todo: string } {
  const all = [...text.matchAll(/종합\s*판정\s*[—–\-]\s*\*\*(보류|합격|불합격|조건부\s*합격)/g)];
  const last = all[all.length - 1];
  if (!last || last[1] !== "보류") return { hold: false, todo: "" };
  const todo = (text.match(/아난이 할 일\s*[:：]\s*([^\r\n]+)/) || [])[1] || "";
  return { hold: true, todo: todo.replace(/\*\*/g, "").trim() };
}

export function handleQaJobComplete(job: Job): void {
  if (job.agent !== "qa") return;
  // QA 실행 자체 실패도 버리지 않는다 — 원인을 분류하고 연속 실패면 사람에게 알린다.
  // (2026-09-19~26 codex 인증 실패로 QA 23건이 무알림 실패 → 원작업이 검증 없이 끝난 사고)
  const runOutcome = recordQaRunOutcome(job.status, job.logs ?? [], qaOriginalTitle(job.request));
  if (job.status !== "completed") {
    if (runOutcome) {
      console.warn(`[QA-AutoJudge] QA 실행 실패(${runOutcome.info.cause}) job=${job.id.slice(0, 8)}: ${runOutcome.info.evidence}`);
      if (runOutcome.alert) addGenieMessage(runOutcome.alert);
    }
    return;
  }

  // 보류: 환경 문제로 검증 불가 — 합격·핫픽스 어느 쪽으로도 보내지 않고 아난에게 알린다(2026-09-28).
  const holdText = [job.fullResult ?? "", ...(job.logs ?? [])].join(String.fromCharCode(10));
  const hold = detectQaHold(holdText);
  if (hold.hold) {
    const title = qaOriginalTitle(job.request);
    addGenieMessage(`[자동 판정] ⏸ QA 보류 — 환경 문제로 검증하지 못했습니다(합격 처리 안 함, 핫픽스 안 보냄).
작업: ${title}
아난이 할 일: ${hold.todo || "보고서 확인"}`);
    console.log(`[QA-AutoJudge] 보류 job=${job.id.slice(0, 8)}: ${hold.todo}`);
    return;
  }

  const verdict = detectQaVerdict(job.logs);
  const cycleInfo = extractCycleInfo(job.request);

  if (verdict === "pass") {
    handlePassVerdict(job, cycleInfo);
    return;
  }

  if (verdict === "unknown") {
    // regex 불명확 → trajectory LLM 판정 시도 (dynamic import — 기존 패턴과 동일, 순환 참조 방지)
    void (async () => {
      let tv: TrajectoryVerdict | null = null;
      try {
        const { judgeTrajectory, makeDefaultLlmRunner } = await import("./trajectory-judge.js");
        tv = await judgeTrajectory(job, makeDefaultLlmRunner());
      } catch (err) {
        console.warn("[QA-AutoJudge] trajectory judge 실행 실패:", err);
      }

      if (tv && tv.verdict === "pass") {
        console.log(`[QA-AutoJudge] trajectory judge PASS (score=${tv.score})`);
        handlePassVerdict(job, cycleInfo);
        return;
      }
      if (tv && tv.verdict === "fail") {
        console.log(
          `[QA-AutoJudge] trajectory judge FAIL (score=${tv.score}): ${tv.reasons.join("; ").slice(0, 300)}`,
        );
        handleFailVerdict(job, cycleInfo);
        return;
      }

      // null 또는 unclear → 기존 불명확 메시지 유지
      const firstLine = job.request.split("\n")[0].trim().slice(0, 80).replace(/`/g, "'");
      addGenieMessage(
        `[자동 판정] ⚠️ QA 판정 불명확 — 사용자 확인 필요. (trajectory judge도 불명확)\n작업: \`${firstLine}\``,
      );
    })();
    return;
  }

  // verdict === "fail"
  handleFailVerdict(job, cycleInfo);
}

/** FAIL 처리 — 에스컬레이션 또는 핫픽스 위임 + 재검증 큐 (regex/trajectory 양쪽 경로에서 공용) */
function handleFailVerdict(job: Job, cycleInfo: CycleInfo | null): void {
  const cycleId = cycleInfo?.cycleId ?? randomUUID();
  const newFailCount = (cycleInfo?.failCount ?? 0) + 1;
  activeCycles.set(cycleId, newFailCount);

  // 3회 연속 FAIL → 에스컬레이션 + 사이클 중단
  if (newFailCount >= MAX_FAILS) {
    activeCycles.delete(cycleId);
    const firstLine = job.request.split("\n")[0].trim().slice(0, 80).replace(/`/g, "'");
    addGenieMessage(
      `[자동 판정] 🚨 QA ${MAX_FAILS}회 연속 FAIL — 자동 핫픽스를 중단합니다. 사용자 직접 확인 필요.\n작업: \`${firstLine}\``,
    );
    return;
  }

  // 핫픽스 위임 에이전트 결정
  const hotfixAgentId = inferHotfixAgent(job);
  const hotfixAgentDef = getWorkerAgent(hotfixAgentId);
  const hotfixAgentName = hotfixAgentDef?.name ?? hotfixAgentId;
  const isSelf = isSelfProject(job.projectName);

  // QA 로그 마지막 20줄 (2000자 cap) 추출
  const qaReport = job.logs.slice(-20).join("\n").slice(0, 2000);
  const origRequestPreview = job.request.slice(0, 500);

  const hotfixRequest =
    `[QA 자동 판정 FAIL — 핫픽스 요청 #${newFailCount}]\n` +
    `QA 검증 결과 FAIL. 아래 QA 결과를 확인하고 핫픽스를 진행해주세요.\n\n` +
    `## 원본 QA 요청\n${origRequestPreview}\n\n` +
    `## QA 결과 요약\n${qaReport}\n\n` +
    `5단 보고 필수. selfRestart=${isSelf}.\n` +
    `<!--QA_AUTO_CYCLE:${cycleId}:${newFailCount}-->`;

  const reCheckRequest =
    `[QA 자동 재검증 #${newFailCount} — ${hotfixAgentName} 핫픽스 후]\n` +
    `${hotfixAgentName}가 핫픽스를 완료했습니다. 직전 FAIL 항목이 수정됐는지 재검증해주세요.\n\n` +
    `## 원본 QA 대상\n${origRequestPreview}\n\n` +
    `5단 QA 보고 필수 (발견된 문제/검증 항목/종합 판정).\n` +
    `<!--QA_AUTO_CYCLE:${cycleId}:${newFailCount}-->`;

  // dynamic import — jobs.ts ↔ qa-auto-judge.ts 순환 참조 방지
  void (async () => {
    try {
      const { createJob } = await import("./jobs.js");
      const hotfixJob = createJob(
        hotfixRequest,
        job.projectName,
        undefined,       // attachments
        hotfixAgentId,
        job.cwd,
        "high",
        undefined,       // afterJobId
        isSelf,          // selfRestart
      );

      createJob(
        reCheckRequest,
        job.projectName,
        undefined,
        "qa",
        job.cwd,
        "normal",
        hotfixJob.id,    // afterJobId: 핫픽스 완료 후 자동 실행
        false,
      );

      console.log(
        `[QA-AutoJudge] FAIL #${newFailCount} → 핫픽스: ${hotfixAgentId} (${hotfixJob.id.slice(0, 8)}), ` +
        `재검증 예약 (cycleId=${cycleId.slice(0, 8)})`,
      );
    } catch (err) {
      console.error("[QA-AutoJudge] 핫픽스/재검증 잡 생성 실패:", err);
    }
  })();
}

// 패치 80 회귀 테스트 — genie 알림 비용·배칭·자동 진행 게이트.
//   1) 비용 원장: 재개 세션의 누적 total_cost_usd 를 «이번 호출분»으로 환산
//   2) 단순 알림 비재개 단발 + 다이제스트(50줄 롤링·1회 소비)
//   3) state-change 적응형 배칭(모드 판정 + 가짜 시계로 flush 시점)
//   4) 자동 진행 진척 게이트·루프 감지
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeInvocationCost, priceTokens, SessionCostTracker } from "../src/server/invocation-cost.js";
import { buildCostEntry } from "../src/server/cost-entry.js";
import {
  isFreshNoticeSource, appendNoticeDigest, consumeNoticeDigest, makeDigestEntry, buildDigestBlock, DIGEST_MAX_LINES,
} from "../src/server/notice-digest.js";
import { decideStateChangeMode, StateChangeBatcher, batchConfigFromEnv } from "../src/server/state-change-batch.js";
import { ProgressGate, isNearIdentical, observeProgress, stallLimitFromEnv, buildStallPrompt } from "../src/server/auto-continuation-gate.js";
import { modelForInternalSource } from "../src/server/internal-source-tier.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ── 1. 비용 ──
{
  // 실측 행(2026-10-02): haiku, 캐시읽기 114k·생성 3.4k·출력 319 → 원장 $2.15 였으나 실제 약 $0.020
  // 캐시 생성은 1시간 TTL 단가($2/M) — 근거는 cost-price-calibration-test.ts 의 CLI 실측 대조.
  const usage = { inputTokens: 0, outputTokens: 319, cacheReadTokens: 114_000, cacheCreateTokens: 3_400 };
  const tok = priceTokens(usage, "claude-haiku-4-5");
  check("haiku 토큰 단가 약 $0.020", near(tok, 0.0114 + 0.0068 + 0.001595, 1e-6), String(tok));

  const fresh = computeInvocationCost({ cliTotalUsd: 0.05, resumed: false, usage });
  check("비재개 → CLI 값 그대로(cli)", fresh.costMethod === "cli" && fresh.costUsd === 0.05);

  const delta = computeInvocationCost({ cliTotalUsd: 2.15, resumed: true, prevCumulativeUsd: 2.13, usage, model: "claude-haiku-4-5" });
  check("재개 + 직전 누적 앎 → 차분(session-delta)", delta.costMethod === "session-delta" && near(delta.costUsd, 0.02), JSON.stringify(delta));

  const unknown = computeInvocationCost({ cliTotalUsd: 2.15, resumed: true, usage, model: "claude-haiku-4-5" });
  check("재개 + 직전값 모름 → 토큰 산정(tokens), 누적값 아님", unknown.costMethod === "tokens" && unknown.costUsd < 0.05, JSON.stringify(unknown));

  const reset = computeInvocationCost({ cliTotalUsd: 0.4, resumed: true, prevCumulativeUsd: 2.0, usage, model: "sonnet" });
  check("누적이 줄면(이상치) 차분 대신 토큰 산정", reset.costMethod === "tokens");

  check("모델 미상 → opus 이상 단가(과소계상 금지)", priceTokens({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 }, undefined) >= 5);

  const t = new SessionCostTracker(2);
  t.set("a", 1); t.set("b", 2); t.set("c", 3);
  check("세션 누적 기억소 상한(오래된 것 제거)", t.get("a") === undefined && t.get("c") === 3);

  const e = buildCostEntry("genie", undefined, { costUsd: 0.02, costMethod: "session-delta", inputTokens: 0, outputTokens: 1, cacheReadTokens: 2, cacheCreateTokens: 3, durationMs: 4 }, "job:notify:ok", "2026-10-02T00:00:00.000Z");
  check("원장 행에 costMethod 포함·기존 키 유지", e.costMethod === "session-delta" && e.costUsd === 0.02 && e.source === "job:notify:ok" && e.agentId === "genie");
}

// ── 2. 단발 알림 + 다이제스트 ──
{
  check("state-change 는 단발", isFreshNoticeSource("scheduler:state-change", {}));
  check("job:notify:ok 는 단발", isFreshNoticeSource("job:notify:ok", {}));
  check("scheduler:notify 는 단발", isFreshNoticeSource("scheduler:notify", {}));
  check("job:notify:fail 은 재개 유지", !isFreshNoticeSource("job:notify:fail", {}));
  check("auto-continuation 은 재개 유지", !isFreshNoticeSource("chat:auto-continuation", {}));
  check("사용자 채팅은 재개 유지", !isFreshNoticeSource(undefined, {}));
  check("롤백 스위치 SOLOFORCE_FRESH_NOTICES=0", !isFreshNoticeSource("job:notify:ok", { SOLOFORCE_FRESH_NOTICES: "0" }));
  check("정체 보고 source 는 cheap 모델", modelForInternalSource(true, "chat:auto-continuation-stalled") === "claude-haiku-4-5");

  const dir = mkdtempSync(join(tmpdir(), "notice-digest-"));
  const f = join(dir, "genie", "notice-digest.jsonl");
  try {
    check("빈 다이제스트 소비 → 빈 문자열", consumeNoticeDigest(f) === "");
    for (let i = 0; i < DIGEST_MAX_LINES + 7; i++) {
      const mm = String(i % 60).padStart(2, "0");
      appendNoticeDigest(f, makeDigestEntry("job:notify:ok", `[시스템 알림]\n작업 ${i} 완료`, `<!--WIKI:{}-->[NOTIFY] 확인 ${i}`, `2026-10-02T01:${mm}:00.000Z`));
    }
    const lines = readFileSync(f, "utf-8").trim().split("\n");
    check(`다이제스트 ${DIGEST_MAX_LINES}줄 상한`, lines.length === DIGEST_MAX_LINES, String(lines.length));
    check("가장 오래된 줄부터 버림", JSON.parse(lines[0]).notice.includes("작업 7 완료"), lines[0]);
    check("응답의 주석 태그 제거", !lines[0].includes("WIKI"));
    const block = consumeNoticeDigest(f);
    check("소비 블록 머리말", block.startsWith("[최근 내부 알림 요약"));
    check("블록은 최근 15건 + 생략 표기", block.includes("이전 35건 생략") && block.includes("작업 56 완료"), block.slice(0, 120));
    check("1회 소비 후 재소비 시 빈 문자열", consumeNoticeDigest(f) === "");
    appendNoticeDigest(f, makeDigestEntry("scheduler:state-change", "[시스템 상태 변화 감지]\n- X 완료", ""));
    const b2 = consumeNoticeDigest(f);
    check("소비 후 새 항목만 노출 + 무응답 표기", b2.includes("X 완료") && b2.includes("(무응답)") && !b2.includes("작업 56"), b2);
    check("소비 항목만이면 블록 없음", buildDigestBlock([{ ts: "2026-10-02T00:00:00Z", source: "s", notice: "n", reply: "r", consumed: true }]) === "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 3. state-change 적응형 배칭 ──
{
  const MIN = 60_000;
  const now = 100 * MIN;
  check("잡 진행 중 → active", decideStateChangeMode({ nowMs: now, lastUserMessageMs: 0, runningOrQueuedJobs: 1 }) === "active");
  check("최근 9분 내 사용자 입력 → active", decideStateChangeMode({ nowMs: now, lastUserMessageMs: now - 9 * MIN, runningOrQueuedJobs: 0 }) === "active");
  check("10분 무입력 + 잡 없음 → idle", decideStateChangeMode({ nowMs: now, lastUserMessageMs: now - 10 * MIN, runningOrQueuedJobs: 0 }) === "idle");
  check("활동 창 설정 반영", decideStateChangeMode({ nowMs: now, lastUserMessageMs: now - 3 * MIN, runningOrQueuedJobs: 0, activeWindowMs: 2 * MIN }) === "idle");

  check("env 기본 5분", batchConfigFromEnv({}).batchMs === 5 * MIN);
  check("env SOLOFORCE_STATE_BATCH_MS 반영", batchConfigFromEnv({ SOLOFORCE_STATE_BATCH_MS: "120000" }).batchMs === 120_000);
  check("env 잘못된 값 → 기본", batchConfigFromEnv({ SOLOFORCE_STATE_BATCH_MS: "abc" }).batchMs === 5 * MIN);

  // 가짜 시계: 1분 tick 시뮬레이션
  const b = new StateChangeBatcher(5 * MIN);
  check("active 는 즉시 발송", b.shouldSend("active", 0).send);
  let t = 10 * MIN;
  const r0 = b.shouldSend("idle", t);
  check("idle 첫 사건 → 보류 시작", !r0.send && r0.reason === "idle-buffer-start");
  const sent: number[] = [];
  for (let k = 1; k <= 6; k++) {
    t += MIN;
    const r = b.shouldSend("idle", t);
    if (r.send) { sent.push(k); b.markFlushed(); }
  }
  check("idle 은 5분 뒤 한 번에 발송", sent.length === 1 && sent[0] === 5, JSON.stringify(sent));
  const b2 = new StateChangeBatcher(5 * MIN);
  b2.shouldSend("idle", 0);
  check("보류 중 idle 2분 → 아직 보류", !b2.shouldSend("idle", 2 * MIN).send);
  const r2 = b2.shouldSend("active", 3 * MIN);
  check("활동 재개 → 즉시 묶음 발송", r2.send && r2.reason === "activity-resumed-flush");
  b2.markFlushed();
  check("flush 후 실시간 복귀", b2.shouldSend("active", 4 * MIN).reason === "realtime");
  check("batchMs=0 → 배칭 끔", new StateChangeBatcher(0).shouldSend("idle", 0).send);
}

// ── 4. 자동 진행 진척 게이트·루프 감지 ──
{
  const sig = "a:pending:";
  const obs = (output: string, jobsCreated = 0, after = sig) => ({ output, jobsCreated, todoSigBefore: sig, todoSigAfter: after });

  check("카운터 숫자만 다른 출력은 거의 동일", isNearIdentical("[자동 진행 3/20] 빌드 확인 중입니다. 잠시만요.", "[자동 진행 4/20] 빌드 확인 중입니다. 잠시만요."));
  check("다른 내용은 동일 아님", !isNearIdentical("빌드 확인 중입니다", "QA 결과 2건 실패, 리사에게 재위임했어요"));
  check("새 위임 → 진척", observeProgress(undefined, obs("", 1)).progress);
  check("TODO 변화 → 진척", observeProgress(undefined, obs("", 0, "a:done:")).progress);
  check("짧은 무의미 출력 → 무진척", !observeProgress(undefined, obs("확인했습니다.")).progress);
  const loop = observeProgress("다음 단계로 리사에게 API 수정을 맡겼습니다. 결과를 기다릴게요.", obs("다음 단계로 리사에게 API 수정을 맡겼습니다. 결과를 기다릴게요!", 1));
  check("거의 같은 출력 2회 → 위임이 있어도 루프(무진척)", !loop.progress && loop.loop);

  const g = new ProgressGate(3);
  check("1회 무진척 → 정지 아님", !g.record(obs("확인")).stalled);
  check("2회 무진척 → 정지 아님", !g.record(obs("네")).stalled);
  check("진척 시 카운터 리셋", !g.record(obs("", 1)).stalled && g.consecutiveNoProgress === 0);
  const same = "빌드 상태를 다시 확인하고 있습니다 계속 진행할게요";
  const first = g.record(obs(same));
  check("첫 출력은 진척(실질 출력)", first.progress);
  g.record(obs(same + "."));
  g.record(obs(same + "!"));
  const last = g.record(obs(same + ","));
  check("같은 출력 반복 3회 연속 → 정지", last.stalled && last.loop, JSON.stringify(last));
  g.reset();
  check("reset 후 카운터 0", g.consecutiveNoProgress === 0 && g.lastOutput === undefined);
  check("정지 한도 env", stallLimitFromEnv({ SOLOFORCE_AUTO_CONT_STALL_LIMIT: "5" }) === 5 && stallLimitFromEnv({}) === 3);
  const p = buildStallPrompt(["A 작업 (완료)"], ["출력1"], "near-identical-output", "아난");
  check("정체 보고 프롬프트: 두 항목 + 위임 금지", p.includes("무엇이 막혔는지") && p.includes("다음에 필요한 것") && p.includes("위임") && p.includes("[NOTIFY]"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

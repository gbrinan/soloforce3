// 두 인스턴스 통합 테스트 — partner-request 흐름 (T1 + T9 + T10)
//
// T1: 정상 partner-request → 승인 → 양쪽 자동 등록
// T9: 콜백 실패 (chaos flag) + 사장님 [재전송]
// T10: 24h 자동 만료 (B만 timeout 0 + sweep 짧게)
//
// 흐름:
//   1. 포트 4460/4461 사전 점검
//   2. 빈 partners.json 시드 (토큰 시드 불필요 — partner-request로 자동 등록 검증)
//   3. 시나리오별 spawn → check → cleanup
//   4. 결과 dump + cleanup (process group SIGTERM → 5초 → SIGKILL)

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

// Live integration test: spawns two real MyCrew instances (child processes).
// Gated to avoid accidental runs in QA sweeps.
if (process.env.REQUIRE_LIVE !== "1") {
  console.log("SKIP: 라이브 통합 테스트 — REQUIRE_LIVE=1 환경변수로만 실행 (실 MyCrew 인스턴스 2개 spawn 발생)");
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);

const PORT_A = Number(process.env.TEST_PORT_PR_A ?? 4460);
const PORT_B = Number(process.env.TEST_PORT_PR_B ?? 4461);
const URL_A = `http://localhost:${PORT_A}`;
const URL_B = `http://localhost:${PORT_B}`;
const APPROVAL_TOKEN = "test-token-pr-" + Math.random().toString(36).slice(2, 10);

const VERBOSE = process.env.VERBOSE === "1";

interface ScenarioResult { id: string; name: string; status: "PASS" | "FAIL"; details: string[]; }
const results: ScenarioResult[] = [];

function log(scope: string, msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}][${scope}] ${msg}`);
}

function record(id: string, name: string, status: "PASS" | "FAIL", details: string[]): void {
  results.push({ id, name, status, details });
  const icon = status === "PASS" ? "✅" : "❌";
  log("Result", `${icon} (${id}) ${name} — ${status}`);
  for (const d of details) console.log(`     ${d}`);
}

async function checkPortFree(port: number): Promise<boolean> {
  const probe = (host: string | undefined): Promise<boolean> =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => { resolve(false); s.close(); });
      s.once("listening", () => { s.close(() => resolve(true)); });
      s.listen(port, host);
    });
  for (const h of ["127.0.0.1", "::", undefined] as const) {
    if (!(await probe(h))) return false;
  }
  return true;
}

function seedHome(home: string): void {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, "history", "external"), { recursive: true });
  mkdirSync(join(home, "history", "external", "messages"), { recursive: true });
  writeFileSync(join(home, "history", "agents.json"), JSON.stringify({ agents: [] }, null, 2));
  writeFileSync(join(home, "history", "external", "partners.json"), JSON.stringify({ version: 1, partners: [] }, null, 2));
}

function spawnInstance(home: string, port: number, label: string, extraEnv: Record<string, string> = {}): ChildProcess {
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      MYCREW_HOME: home,
      PORT: String(port),
      DRY_RUN: "0",
      TUNNEL_HOST: "",
      TUNNEL_KEY: "",
      TUNNEL_URL: "",
      NGROK_URL: "",
      APPROVAL_RESOLVE_TOKEN: APPROVAL_TOKEN,
      MYCREW_ALLOW_INSECURE_APIURL: "true",
      MYCREW_PARTNER_REQUEST_CALLBACK_RETRY_DELAY_MS: "200",
      MYCREW_PARTNER_REQUEST_RATE_IP_PER_MIN: "30",
      MYCREW_PARTNER_REQUEST_TIMESTAMP_DRIFT_SEC: "300",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  if (VERBOSE) {
    proc.stdout?.on("data", (d) => process.stdout.write(`[${label}] ${d}`));
    proc.stderr?.on("data", (d) => process.stderr.write(`[${label}!] ${d}`));
  }
  return proc;
}

async function killPG(proc: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (!proc.pid || proc.killed) return;
  try { process.kill(-proc.pid, signal); }
  catch { try { proc.kill(signal); } catch { /* */ } }
}

async function waitReady(url: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${url}/api/genie-name`);
      if (r.ok) return true;
    } catch { /* */ }
    await new Promise((res) => setTimeout(res, 300));
  }
  return false;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  try {
    const headers = { ...(init?.headers ?? {}), 'X-Approval-Token': APPROVAL_TOKEN } as Record<string, string>;
    const res = await fetch(url, { ...init, headers });
    let body: any = null;
    try { body = await res.json(); } catch { /* */ }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

async function pollUntil<T>(fn: () => Promise<T | undefined>, predicate: (v: T) => boolean, timeoutMs = 5000): Promise<T | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== undefined && predicate(v)) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

async function runScenario(label: string, fn: (homes: { homeA: string; homeB: string }) => Promise<void>, extraEnvA: Record<string, string> = {}, extraEnvB: Record<string, string> = {}): Promise<void> {
  const homeA = join(PROJECT_ROOT, `.mycrew-test-PR-A-${label}`);
  const homeB = join(PROJECT_ROOT, `.mycrew-test-PR-B-${label}`);
  seedHome(homeA);
  seedHome(homeB);
  const procA = spawnInstance(homeA, PORT_A, `A-${label}`, { MYCREW_COMPANY_NAME: "A사", MYCREW_CONTACT_NAME: "김부장", ...extraEnvA });
  const procB = spawnInstance(homeB, PORT_B, `B-${label}`, { MYCREW_COMPANY_NAME: "B사", MYCREW_CONTACT_NAME: "박과장", ...extraEnvB });
  try {
    if (!(await waitReady(URL_A, 30_000))) throw new Error("A 부팅 timeout");
    if (!(await waitReady(URL_B, 30_000))) throw new Error("B 부팅 timeout");
    log(label, "양 인스턴스 ready");
    // send 엔드포인트는 저장된 my-profile을 사용하므로(body 파라미터 아님) 발신 전 프로필을 설정한다.
    await fetchJson(`${URL_A}/api/external/my-profile`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Approval-Token": APPROVAL_TOKEN },
      body: JSON.stringify({ companyName: "A사", contactName: "김부장", secretaryName: "에이비서", contactEmail: "a@example.com" }),
    });
    await fetchJson(`${URL_B}/api/external/my-profile`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Approval-Token": APPROVAL_TOKEN },
      body: JSON.stringify({ companyName: "B사", contactName: "박과장", secretaryName: "비비서", contactEmail: "b@example.com" }),
    });
    await fn({ homeA, homeB });
  } finally {
    await killPG(procA, "SIGTERM");
    await killPG(procB, "SIGTERM");
    await new Promise((r) => setTimeout(r, 3000));
    await killPG(procA, "SIGKILL");
    await killPG(procB, "SIGKILL");
    if (existsSync(homeA)) rmSync(homeA, { recursive: true, force: true });
    if (existsSync(homeB)) rmSync(homeB, { recursive: true, force: true });
  }
}

// ===== T1: 정상 partner-request → 승인 → 양쪽 자동 등록 =====
async function runT1(): Promise<void> {
  await runScenario("T1", async () => {
    const details: string[] = [];
    // 1. A → B partner-request 발신
    const send = await fetchJson(`${URL_A}/api/external/partner-request/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetApiUrl: URL_B,
        ourCompanyName: "A사",
        ourContactName: "김부장",
        ourApiUrl: URL_A,
        scope: { canDelegate: false, canAccessFiles: true },
        message: "안녕하세요. 6월 분기 협업 가능한지 문의드립니다.",
      }),
    });
    details.push(`A send: status=${send.status} requestId=${send.body?.requestId?.slice(0, 8)}`);
    if (!send.body?.requestId) {
      record("T1", "정상 partner-request → 승인 → 양쪽 자동 등록", "FAIL", [...details, "A send 실패"]);
      return;
    }

    // 2. B에서 pending 확인
    const pending = await pollUntil(
      async () => {
        const r = await fetchJson(`${URL_B}/api/external/partner-requests`);
        return Array.isArray(r.body) && r.body.length > 0 ? r.body : undefined;
      },
      (v) => Array.isArray(v) && v.length > 0,
      3000,
    );
    details.push(`B pending: ${pending ? pending.length : 0}건`);
    if (!pending || pending.length === 0) {
      record("T1", "정상 partner-request → 승인 → 양쪽 자동 등록", "FAIL", details);
      return;
    }

    const reqId = pending[0].id;
    // 3. B에서 approve
    const approve = await fetchJson(`${URL_B}/api/external/partner-request/${reqId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    details.push(`B approve: status=${approve.status}`);
    if (approve.status !== 200) {
      details.push(`approve body=${JSON.stringify(approve.body)}`);
      record("T1", "정상 partner-request → 승인 → 양쪽 자동 등록", "FAIL", details);
      return;
    }

    // 4. 양쪽 partners.json 등록 확인
    await new Promise((r) => setTimeout(r, 800));
    const partnersA = await fetchJson(`${URL_A}/api/external/partners`);
    const partnersB = await fetchJson(`${URL_B}/api/external/partners`);
    const aHasB = Array.isArray(partnersA.body) && partnersA.body.some((p: any) => p.companyName === "B사");
    const bHasA = Array.isArray(partnersB.body) && partnersB.body.some((p: any) => p.companyName === "A사");
    details.push(`A partners → B사 등록: ${aHasB} (총 ${partnersA.body?.length}건)`);
    details.push(`B partners → A사 등록: ${bHasA} (총 ${partnersB.body?.length}건)`);

    record("T1", "정상 partner-request → 승인 → 양쪽 자동 등록", aHasB && bHasA ? "PASS" : "FAIL", details);
  });
}

// ===== T9: 콜백 실패 + 사장님 [재전송] =====
async function runT9(): Promise<void> {
  await runScenario("T9", async ({ homeA }) => {
    const details: string[] = [];
    const chaosFlag = join(homeA, "history", "external", ".partner-request-callback-down");
    // 1. A의 콜백 라우트 chaos 활성화
    writeFileSync(chaosFlag, "");
    details.push("A chaos flag 활성화");

    // 2. A → B partner-request
    const send = await fetchJson(`${URL_A}/api/external/partner-request/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetApiUrl: URL_B,
        ourCompanyName: "A사",
        ourContactName: "김부장",
        ourApiUrl: URL_A,
        message: "T9 chaos test",
      }),
    });
    if (!send.body?.requestId) {
      record("T9", "콜백 실패 + 재전송", "FAIL", [...details, `send 실패 status=${send.status}`]);
      return;
    }

    const pending = await pollUntil(
      async () => {
        const r = await fetchJson(`${URL_B}/api/external/partner-requests`);
        return Array.isArray(r.body) ? r.body : undefined;
      },
      (v) => Array.isArray(v) && v.length > 0,
      3000,
    );
    if (!pending || pending.length === 0) {
      record("T9", "콜백 실패 + 재전송", "FAIL", [...details, "B pending 미수신"]);
      return;
    }
    const reqId = pending[0].id;

    // 3. B approve → 1차 + 재시도 모두 실패 (chaos flag 활성)
    const approve1 = await fetchJson(`${URL_B}/api/external/partner-request/${reqId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    details.push(`B 1차 approve (chaos 활성): status=${approve1.status} (실패 예상)`);
    const failedAsExpected = approve1.status === 400 && String(approve1.body?.error ?? "").startsWith("callback_failed");
    details.push(`예상대로 callback_failed: ${failedAsExpected}`);

    // 4. resultDeliveryAttempts >= 2 확인
    const reqAfterFail = await fetchJson(`${URL_B}/api/external/partner-requests/${reqId}`);
    const attempts = reqAfterFail.body?.resultDeliveryAttempts ?? 0;
    details.push(`B partner-request resultDeliveryAttempts: ${attempts} (>=2 기대)`);

    // 5. A chaos flag 해제
    unlinkSync(chaosFlag);
    details.push("A chaos flag 해제");

    // 6. B [재전송]
    const resend = await fetchJson(`${URL_B}/api/external/partner-request/${reqId}/resend-callback`, { method: "POST" });
    details.push(`B resend-callback: status=${resend.status}`);

    // 7. A partners.json에 B사 등록 확인
    await new Promise((r) => setTimeout(r, 500));
    const partnersA = await fetchJson(`${URL_A}/api/external/partners`);
    const aHasB = Array.isArray(partnersA.body) && partnersA.body.some((p: any) => p.companyName === "B사");
    details.push(`A partners → B사 등록: ${aHasB}`);

    record("T9", "콜백 실패 + 재전송", failedAsExpected && resend.status === 200 && aHasB ? "PASS" : "FAIL", details);
  });
}

// ===== T10: 24h timeout 자동 만료 =====
async function runT10(): Promise<void> {
  // B만 timeout 0 + sweep 짧게
  await runScenario("T10", async () => {
    const details: string[] = [];

    const send = await fetchJson(`${URL_A}/api/external/partner-request/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetApiUrl: URL_B,
        ourCompanyName: "A사",
        ourContactName: "김부장",
        ourApiUrl: URL_A,
        message: "T10 timeout test",
      }),
    });
    if (!send.body?.requestId) {
      record("T10", "24h timeout 자동 만료", "FAIL", [...details, `send 실패 status=${send.status}`]);
      return;
    }
    const pending = await pollUntil(
      async () => {
        const r = await fetchJson(`${URL_B}/api/external/partner-requests`);
        return Array.isArray(r.body) ? r.body : undefined;
      },
      (v) => Array.isArray(v) && v.length > 0,
      3000,
    );
    if (!pending || pending.length === 0) {
      record("T10", "24h timeout 자동 만료", "FAIL", [...details, "pending 미수신"]);
      return;
    }
    const reqId = pending[0].id;
    details.push(`B pending 1건 등록 (reqId=${reqId.slice(0, 8)})`);

    // sweep 500ms 대기 (timeout 0이라 즉시 만료 → sweep에서 expired)
    await new Promise((r) => setTimeout(r, 1500));
    const after = await fetchJson(`${URL_B}/api/external/partner-requests/${reqId}`);
    const status = after.body?.status;
    details.push(`sweep 후 B partner-request status: ${status} (expired 기대)`);

    record("T10", "24h timeout 자동 만료", status === "expired" ? "PASS" : "FAIL", details);
  }, {}, {
    MYCREW_PARTNER_REQUEST_TIMEOUT_HOURS: "0",
    MYCREW_PARTNER_REQUEST_SWEEP_INTERVAL_MS: "500",
  });
}

async function main(): Promise<void> {
  log("Setup", `URL_A=${URL_A} URL_B=${URL_B}`);
  for (const p of [PORT_A, PORT_B]) {
    if (!(await checkPortFree(p))) {
      console.error(`[FATAL] 포트 ${p} 점유 중`);
      process.exit(2);
    }
  }
  log("Setup", "포트 free 확인");

  let cleanupDone = false;
  process.on("SIGINT", () => {
    if (!cleanupDone) {
      cleanupDone = true;
      console.error("[Cleanup] SIGINT");
      process.exit(130);
    }
  });

  try {
    await runT1();
    await runT9();
    await runT10();
  } catch (err) {
    console.error("[FATAL]", err);
    record("FATAL", "스크립트 자체 실패", "FAIL", [err instanceof Error ? err.message : String(err)]);
  }

  console.log("\n=========================================");
  console.log("partner-request 통합 테스트 결과");
  console.log("=========================================");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} (${r.id}) ${r.name} — ${r.status}`);
  }
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\nPASS=${pass} FAIL=${fail} (총 ${results.length})`);

  const dumpPath = join(PROJECT_ROOT, ".mycrew-test-pr-result.json");
  writeFileSync(dumpPath, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\n상세: ${dumpPath}`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });

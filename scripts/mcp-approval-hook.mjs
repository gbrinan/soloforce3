#!/usr/bin/env node
// PreToolUse 훅 — approval 모드 registry MCP 도구 호출을 승인 카드로 보낸다.
// 배선: src/server/terminal-ws.ts·worker-pty.ts가 matcher `mcp__<서버>__.*`로 이 파일을 건다.
// 환경: MYCREW_APPROVAL_BASE(서버 주소), MYCREW_AGENT_ROLE, MYCREW_JOB_ID.
// 실패는 닫힌 쪽으로: 서버 미응답·파싱 실패·시간 초과는 모두 거부(deny)다.
// 이 파일이 없던 동안에는 훅 명령이 실패해 승인 없이 통과했다(findings «mcp-approval-hook 부재»).

import http from "node:http";

const EXTERNAL = process.argv.includes("--external");
const POLL_MS = 500;
const DEADLINE_MS = 60_000; // 훅 timeout(70s)보다 짧게

let decided = false;
// process.exit()는 쓰지 않는다 — 소켓이 닫히는 중에 exit하면 Windows에서 0xC0000409로 죽는다(승인 배선 테스트에서 재현).
// 출력만 하고 열린 핸들이 없으면 자연 종료한다(keep-alive 없는 요청만 쓴다).
function decide(decision, reason) {
  if (decided) return;
  decided = true;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
  }));
}

/** keep-alive 없는 JSON 요청 — 열린 소켓이 남지 않아 프로세스가 바로 끝난다. */
function requestJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(url, {
      method,
      agent: false,
      timeout: 5000,
      headers: { Connection: "close", ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* 본문 없음 */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function readStdin() {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

/** 승인 카드에 보일 한 줄 요약 — 입력 전체가 아니라 앞부분만. */
export function summarize(toolName, toolInput) {
  let input = "";
  try { input = JSON.stringify(toolInput ?? {}); } catch { input = "(입력 직렬화 실패)"; }
  return `${toolName} ${input.length > 200 ? `${input.slice(0, 200)}…` : input}`;
}

async function main() {
  const base = process.env.MYCREW_APPROVAL_BASE;
  if (!base) return decide("deny", "MYCREW_APPROVAL_BASE 미설정 — 승인 경로 없음");
  let payload;
  try { payload = JSON.parse(await readStdin()); } catch { return decide("deny", "훅 입력 파싱 실패"); }
  const toolName = String(payload?.tool_name ?? "");
  if (!toolName) return decide("deny", "tool_name 없음");

  let id;
  try {
    const res = await requestJson("POST", `${base}/api/approvals`, {
        agentRole: process.env.MYCREW_AGENT_ROLE ?? "unknown",
        tool: toolName,
        path: summarize(toolName, payload?.tool_input),
        jobId: process.env.MYCREW_JOB_ID || undefined,
        reason: `${EXTERNAL ? "외부 영향 도구(사람만 승인)" : "approval 모드 MCP 도구"} 호출: ${toolName}`,
        // --external: 서비스 정책 approval 도구 — 지니 의견·반복 이력·자동 규칙으로는 허용되지 않는다.
        ...(EXTERNAL ? { external: true } : {}),
    });
    if (res.status !== 200) return decide("deny", `승인 요청 실패 HTTP ${res.status}`);
    id = res.json?.id;
  } catch (err) {
    return decide("deny", `승인 서버 연결 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!id) return decide("deny", "승인 ID 없음");

  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const res = await requestJson("GET", `${base}/api/approvals/${id}/status`);
      if (res.status !== 200) continue;
      const status = res.json?.status;
      if (status === "allowed") return decide("allow", `승인됨 (${id.slice(0, 8)})`);
      if (status === "denied" || status === "timeout") return decide("deny", `${status} (${id.slice(0, 8)})`);
    } catch { /* 일시 장애 — 재시도 */ }
  }
  return decide("deny", `승인 대기 시간 초과 (${id.slice(0, 8)})`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((err) => decide("deny", `훅 오류: ${err instanceof Error ? err.message : String(err)}`));
}

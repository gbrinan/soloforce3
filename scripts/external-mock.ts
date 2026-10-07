// 외부 에이전트 mock — 포트 4567
//
// 사용법:
//   npm run mock:external
//
// 시나리오:
//   1. 사장님 시스템(localhost:3456) → POST /api/external/delegate (Bearer)
//      → ACK { jobId, callbackUrl: "...?token=...", external:true } 반환
//   2. 그 ACK를 본 mock에 입력 (POST /external-task body=ACK)
//      → 5초 후 자동으로 callbackUrl로 POST 호출 (status="completed")
//   3. ?timeoutSim=true 시 callback 보내지 않음 → lease 자동 timeout 검증

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_EXTERNAL_PORT ?? 4567);

interface AckPayload {
  jobId: string;
  todoId?: string;
  status?: string;
  acceptedAt?: string;
  callbackUrl: string;
  request?: string;
  external?: boolean;
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/external-task")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "POST /external-task only" }));
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const timeoutSim = url.searchParams.get("timeoutSim") === "true";
  const delaySec = Number(url.searchParams.get("delaySec") ?? 5);

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let ack: AckPayload;
    try {
      ack = JSON.parse(body) as AckPayload;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json body" }));
      return;
    }
    if (!ack.jobId || !ack.callbackUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "jobId and callbackUrl required" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      mockId: `mock-${Date.now()}`,
      queued: true,
      willCallback: !timeoutSim,
      delaySec: timeoutSim ? null : delaySec,
    }));
    // timeoutSim=true 시 callback 보내지 않음 (lease 자동 timeout 검증용)
    if (timeoutSim) {
      console.log(`[Mock] timeout 시뮬: jobId=${ack.jobId.slice(0, 8)} callback 보내지 않음`);
      return;
    }
    // delaySec 초 후 callback POST
    setTimeout(async () => {
      try {
        const callbackBody = {
          jobId: ack.jobId,
          status: "completed" as const,
          output: `MOCK-RESULT-${Date.now()}`,
          completedAt: new Date().toISOString(),
          agent: "mock-external",
          external: true,
        };
        const r = await fetch(ack.callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(callbackBody),
        });
        const text = await r.text();
        console.log(`[Mock] callback ${ack.jobId.slice(0, 8)} → ${r.status} ${text.slice(0, 200)}`);
      } catch (err) {
        console.error(`[Mock] callback 실패:`, err instanceof Error ? err.message : err);
      }
    }, delaySec * 1000);
  });
});

server.listen(PORT, () => {
  console.log(`[Mock] external agent listening on http://localhost:${PORT}`);
  console.log(`[Mock] POST /external-task with ACK body → 5초 후 callback URL로 POST`);
  console.log(`[Mock] ?timeoutSim=true → callback 보내지 않음 (lease timeout 검증)`);
});

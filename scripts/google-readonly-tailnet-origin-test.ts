// tailnet(Tailscale) 호스트명으로 들어온 소유자 요청이 구글 커넥터에서 거부되지 않는지 검증한다.
// 회귀 배경: 소유자 인증이 콜백 URL의 origin(http://localhost:3456) 하나로만 판정돼
// 맥북 등 tailnet 기기에서 구글 연동 화면이 전부 missing_credentials로 막혔다.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createGoogleReadonlyServerRoutes } from "../src/server/google-readonly-server.js";

const projectsDirectory = mkdtempSync(join(tmpdir(), "soloforce-tailnet-projects-"));
const historyDirectory = mkdtempSync(join(tmpdir(), "soloforce-tailnet-history-"));
mkdirSync(join(projectsDirectory, "alpha"), { recursive: true });

const TAILNET = "https://host.example.ts.net";
const env = {
  GOOGLE_DRIVE_CONNECTOR_CLIENT_ID: "test-client-id",
  GOOGLE_DRIVE_CONNECTOR_CLIENT_SECRET: "test-client-secret",
  GOOGLE_DRIVE_CONNECTOR_CALLBACK_URL: "http://localhost:3456/api/connections/google-drive/oauth/callback",
  GOOGLE_DRIVE_CONNECTOR_PROJECT_ID: "alpha",
  SOLOFORCE_CONNECTION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  SOLOFORCE_TAILSCALE_ORIGIN: TAILNET,
  SOLOFORCE_TAILSCALE_ALLOWED_LOGINS: "owner@example.test",
} as NodeJS.ProcessEnv;

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/connections/google-drive", createGoogleReadonlyServerRoutes({
    env,
    storage: { historyDirectory, projectsDirectory },
    resolveRemoteAddress: () => "127.0.0.1",
  }));
  return app;
}

async function statusFor(url: string, headers: Record<string, string> = {}): Promise<number> {
  const response = await buildApp().request(url, { headers });
  return response.status;
}

try {
  const path = "/api/connections/google-drive/connections";

  // 기존 경로(PC의 localhost)는 그대로 소유자로 인정돼야 한다.
  assert.equal(await statusFor(`http://localhost:3456${path}`), 200, "localhost 소유자 접근이 깨졌다");

  // tailnet 호스트로 들어와도 소유자로 인정돼야 한다 — 프록시가 http로 전달하는 경우 포함.
  assert.equal(await statusFor(`${TAILNET}${path}`), 200, "tailnet https 접근이 거부됐다");
  assert.equal(await statusFor(`http://host.example.ts.net${path}`), 200, "tailnet http 접근이 거부됐다");

  // 신원 헤더가 붙어 오면 허용 목록과 대조한다.
  assert.equal(
    await statusFor(`${TAILNET}${path}`, { "Tailscale-User-Login": "owner@example.test" }),
    200,
    "허용된 tailnet 로그인이 거부됐다",
  );
  const intruder = await buildApp().request(`${TAILNET}${path}`, {
    headers: { "Tailscale-User-Login": "intruder@example.test" },
  });
  assert.deepEqual(await intruder.json(), { error: "missing_credentials" }, "허용 목록 밖 로그인이 통과했다");

  // 신뢰 목록에 없는 호스트는 계속 막혀야 한다 (fail closed).
  const stranger = await buildApp().request(`https://evil.example${path}`);
  assert.deepEqual(await stranger.json(), { error: "missing_credentials" }, "신뢰하지 않는 origin이 통과했다");
} finally {
  rmSync(projectsDirectory, { recursive: true, force: true });
  rmSync(historyDirectory, { recursive: true, force: true });
}

console.log("google read-only tailnet origin: PASS");
process.exit(0);

#!/usr/bin/env node
// verify.sh의 Windows 호환 Node.js 포트.
// PORT=3458, DRY_RUN=1 로 서버를 띄우고 /api/staff health check 후 자동 종료.
import { spawn, execSync } from "node:child_process";
import { get as httpGet } from "node:http";

const PORT = 3458;
process.env.PORT = String(PORT);
process.env.DRY_RUN = "1";

const IS_WIN = process.platform === "win32";
const child = spawn("npx", ["tsx", "src/index.ts"], {
  env: process.env,
  stdio: "inherit",
  shell: IS_WIN,  // Windows: cmd.exe를 통해 npx.cmd 해석
});
console.log(`[verify] 부팅 대기 (PORT=${PORT}, PID=${child.pid}) ...`);

function cleanup() {
  try {
    if (IS_WIN) {
      execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch { /* */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function checkHealth(url) {
  return new Promise(resolve => {
    const req = httpGet(url, res => { res.resume(); resolve(res.statusCode < 400); });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

for (let i = 0; i < 8; i++) {
  await sleep(2000);
  if (await checkHealth(`http://localhost:${PORT}/api/staff`)) {
    console.log("[verify] ✅ 부팅 확인 — 자동 종료");
    process.exit(0);
  }
}
console.log("[verify] ❌ 부팅 실패 — health check 8회 타임아웃");
process.exit(1);

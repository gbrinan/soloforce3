import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// .env 로드
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  }
}

// IPv6 송신이 막힌 환경(WSL 등) 대응.
// DNS가 AAAA를 돌려주면 Node의 happy-eyeballs가 IPv6를 먼저 시도하는데,
// 기본 시도 타임아웃 250ms가 너무 짧아 IPv4 폴백 전에 AggregateError(ETIMEDOUT)로
// 실패한다. 실측: 기본값 10~40% 실패 → 2000ms에서 0/20 실패.
// 모든 아웃바운드 호출(fetch/undici 포함)에 적용되므로 네트워크 사용 전에 설정한다.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

// 인자 파싱
const args = process.argv.slice(2);
// PORT 우선, MYCREW_PORT를 alias로 인식 (작업지시 §13: MYCREW_PORT 기본 3456)
const portEnv = process.env.PORT ?? process.env.MYCREW_PORT;
let port = portEnv ? parseInt(portEnv, 10) : 3456;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
}

const { startServer } = await import("./server/index.js");
startServer(port);

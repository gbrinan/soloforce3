// fix B 단위 시뮬: 자식 PID 추적 + lease 만료 시 SIGKILL
// 시나리오 4건:
//   1. PID 부재 → no_pid
//   2. 살아있는 자식 SIGKILL → killed=true + 사후 ESRCH 확인
//   3. stale PID (이미 죽은 자식) SIGKILL → killed=false, code=ESRCH
//   4. onSpawn 콜백으로 PID 캡처 (runAgent options 흐름 시뮬)
import { spawn } from "node:child_process";
import { killChildIfAlive } from "../src/server/jobs.js";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, got: unknown): void {
  const tag = ok ? "PASS" : "FAIL";
  if (ok) pass++;
  else fail++;
  console.log(`[${tag}] ${name} | got=${JSON.stringify(got)}`);
}

// 자식 프로세스는 반드시 process.execPath(현재 실행 중인 node의 절대경로)로 띄운다.
// spawn("node", ...)는 PATH 해석에 의존하는데 이 머신에는 node가 PATH에 없다
// (npx·npm·git도 마찬가지 — procedure_bash-enoent-windows). 그 결과 spawn이 ENOENT를
// 'error' 이벤트로 던지고, 핸들러가 없어 프로세스가 통째로 크래시했다. 단언 하나 실패가
// 아니라 스위트가 죽어 "=== n/n PASS ===" 줄조차 안 나오는 상시 red의 원인이었다(2026-08-10).
// error 핸들러도 함께 붙여, 앞으로 spawn이 실패하더라도 크래시 대신 진단 가능한 FAIL이 되게 한다.
function spawnNode(args: string[]) {
  const p = spawn(process.execPath, args, { stdio: "ignore" });
  p.on("error", (e) => {
    console.log(`[FAIL] 자식 프로세스 spawn 실패 (${process.execPath}) | ${e.message}`);
    fail++;
  });
  return p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = 존재 확인
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // S1: PID 부재
  {
    const r = killChildIfAlive(undefined);
    check("S1 PID 부재 → no_pid", r.killed === false && r.code === "no_pid", r);
  }

  // S2: 살아있는 자식 SIGKILL
  {
    const proc = spawnNode(["-e", "setTimeout(()=>{}, 60000)"]);
    proc.unref();
    await sleep(50);
    const pid = proc.pid;
    if (!pid) {
      check("S2 SIGKILL 살아있는 자식", false, { error: "no pid" });
    } else {
      const r = killChildIfAlive(pid);
      await sleep(50);
      const stillAlive = isAlive(pid);
      check("S2 SIGKILL 살아있는 자식 → killed + 사후 죽음", r.killed === true && !stillAlive, { ...r, stillAlive });
    }
    try { proc.kill("SIGKILL"); } catch { /* 이미 죽음 */ }
  }

  // S3: stale PID (자식이 이미 자연 종료)
  {
    const proc = spawnNode(["-e", "process.exit(0)"]);
    const pid = proc.pid;
    await new Promise<void>((r) => proc.on("exit", () => r()));
    await sleep(50); // 커널 reaper 여유
    if (!pid) {
      check("S3 stale PID", false, { error: "no pid" });
    } else {
      const r = killChildIfAlive(pid);
      check("S3 stale PID → ESRCH", r.killed === false && r.code === "ESRCH", r);
    }
  }

  // S4: onSpawn 콜백 캡처 (runAgent options 흐름 시뮬)
  {
    let captured: number | undefined;
    const onSpawn = (pid: number) => { captured = pid; };
    const proc = spawnNode(["-e", "setTimeout(()=>{}, 1000)"]);
    proc.unref();
    if (proc.pid && onSpawn) onSpawn(proc.pid);
    await sleep(20);
    check("S4 onSpawn 콜백 PID 캡처", captured !== undefined && captured === proc.pid, { captured, procPid: proc.pid });
    try { proc.kill("SIGKILL"); } catch { /* */ }
  }

  console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

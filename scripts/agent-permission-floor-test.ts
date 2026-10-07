// 권한 바닥(floor) — 회귀 테스트
//
// 배경: config/agents/<id>/meta.json 만 두면 레지스트리가 자동 등재한다(agent-registry.ts:218 15-D).
//       그 경로가 주는 값은 allowedTools: [] 이고 readPaths/writePaths 는 없다.
//       그런데 buildPermissionArgs 는
//         - mcpTools 가 비면 effectiveAllowedTools 도 비고, 빈 allowlist = "전체 허용" 이며
//         - permissionModeFor 가 "standard"/"restricted" 외의 값을 전부 bypassPermissions 로 떨어뜨린다.
//       현행 meta.json 들은 permLevel: "normal" 이다 → 둘 다 걸려서
//       **도구 전체 허용 + 권한 확인 생략** 이 된다.
//
//       즉 씨앗만으로 만든 직원에게는 SafeFS 경로 검증도, 승인 흐름도 걸리지 않는다.
//       "원본은 읽기 전용", "클라이언트를 가로지르지 않는다" 같은 규칙이 지시서 산문에만 있고
//       기제는 열려 있는 상태다.
//
// 이 테스트는 그 구멍을 고정한다. 자동 등재된 직원은 최소한 아래 둘 중 하나를 만족해야 한다.
//   (A) 도구 allowlist 가 비어 있지 않다  — 무엇을 쓸 수 있는지가 명시된다
//   (B) permission-mode 가 bypassPermissions 가 아니다 — 확인을 거친다
// 둘 다 아니면 바닥이 없는 것이다.
import { buildPermissionArgs, permissionModeFor } from "../src/agent.js";
import type { AgentConfig } from "../src/types.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}

/** agent-registry.ts:236 의 15-D 스캔 경로가 실제로 만들어내는 모양. */
function scanRegisteredAgent(permLevel: string | undefined): AgentConfig {
  return {
    id: "virt-floor-test",
    name: "바닥테스트",
    permissionLevel: permLevel,
    allowedTools: [],
    maxTurns: 20,
  } as AgentConfig;
}

function modeOf(args: string[]): string | undefined {
  const i = args.indexOf("--permission-mode");
  return i >= 0 ? args[i + 1] : undefined;
}
function allowedOf(args: string[]): string[] {
  const i = args.indexOf("--allowedTools");
  if (i < 0) return [];
  return (args[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// --- permissionModeFor 자체의 폴백 방향 ---
check(
  'permissionModeFor("restricted") = default',
  permissionModeFor("restricted") === "default",
);
check(
  'permissionModeFor("standard") = acceptEdits',
  permissionModeFor("standard") === "acceptEdits",
);
check(
  "모르는 값은 열지 않는다 (fail-closed)",
  permissionModeFor("normal") !== "bypassPermissions",
  `현재 permLevel "normal" → ${permissionModeFor("normal")} (실제 meta.json 전부가 이 값이다)`,
);
check(
  "미설정도 열지 않는다 (fail-closed)",
  permissionModeFor(undefined) !== "bypassPermissions",
  `undefined → ${permissionModeFor(undefined)}`,
);

// --- 자동 등재된 직원에게 바닥이 있는가 ---
for (const lvl of ["normal", undefined]) {
  // 바닥은 둘 중 하나로 성립한다: (1) toolset-empty로 던져서 기동 자체를 차단, (2) 기동하되 bypass가 아님.
  let bounded = false; let detail = "";
  try {
    const args = buildPermissionArgs(scanRegisteredAgent(lvl));
    const mode = modeOf(args);
    const allowed = allowedOf(args);
    bounded = allowed.length > 0 || mode !== "bypassPermissions";
    detail = `allowlist ${allowed.length}개 + mode=${mode}`;
  } catch (e) {
    bounded = /toolset-empty/.test(String(e));
    detail = `기동 차단: ${String(e).slice(0, 60)}`;
  }
  check(
    `씨앗만으로 등재된 직원에 바닥이 있다 (permLevel=${String(lvl)})`,
    bounded,
    detail,
  );
}

// --- 경로가 지정된 직원은 기존대로 SafeFS 로 좁혀져야 한다 (회귀 방지) ---
{
  const scoped = {
    ...scanRegisteredAgent("normal"),
    readPaths: ["/src/**"],
    writePaths: ["/history/outputs/virt-floor-test/**"],
  } as AgentConfig;
  const allowed = allowedOf(buildPermissionArgs(scoped));
  check(
    "경로 지정 직원은 SafeFS 도구로 좁혀진다",
    allowed.some((t) => t === "mcp__safefs__SafeWrite") && allowed.some((t) => t === "mcp__safefs__SafeRead"),
    `allowlist=${allowed.join(",") || "(빈)"}`,
  );
  check(
    "경로 지정 직원에게 내장 Write 는 허용목록에 없다",
    !allowed.includes("Write") && !allowed.includes("Edit"),
  );
}

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);

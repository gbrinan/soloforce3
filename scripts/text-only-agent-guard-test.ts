// 텍스트 전용 내부 유틸의 도구 0 가드 면제 회귀 테스트.
// 배경: 2026-08-08 도입된 "도구 0개면 실행 거부" 가드가 요약기·메모리 플러시·라이브러리안·
// 일일요약 등 allowedTools: [] 로 설계된 내부 유틸 7곳까지 막아, 이들이 한 달 넘게 조용히 실패했다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { assertToolsetNotEmpty } from "../src/agent.js";
import type { AgentConfig } from "../src/types.js";

const base = { role: "orchestrator", name: "T", systemPrompt: "", allowedTools: [] as string[], maxTurns: 1 } as AgentConfig;

// 텍스트 전용으로 명시하면 통과해야 한다.
assert.doesNotThrow(() => assertToolsetNotEmpty({ ...base, textOnly: true }, []), "textOnly 유틸이 가드에 막혔다");

// 원래 목적은 유지: 권한 미설정 워커는 여전히 막아야 한다.
assert.throws(() => assertToolsetNotEmpty(base, []), /toolset-empty/, "권한 미설정 워커 차단이 풀렸다");

// 도구가 있는 워커는 당연히 통과.
assert.doesNotThrow(() => assertToolsetNotEmpty({ ...base, allowedTools: ["Read"] }, []));

// 소스 수준 보호: allowedTools: [] 로 만든 내부 유틸은 전부 textOnly 를 달고 있어야 한다.
for (const file of ["src/server/chat.ts", "src/server/scheduler.ts"]) {
  const src = readFileSync(file, "utf-8");
  const empty = (src.match(/allowedTools: \[\] as string\[\],/g) ?? []).length;
  const marked = (src.match(/allowedTools: \[\] as string\[\],\n\s*textOnly: true,/g) ?? []).length;
  assert.equal(marked, empty, `${file}: allowedTools: [] ${empty}곳 중 textOnly 표시 ${marked}곳`);
}

console.log("text-only agent toolset guard: PASS");
process.exit(0);

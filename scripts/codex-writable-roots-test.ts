// codex 샌드박스 writable_roots에는 실제 존재하는 디렉터리만 넘긴다 (2026-09-28)
// 재현 근거: QA writePaths에 파일(.qa-tmp, history/external/partners.json)과 미전개 glob(apps/*/test-results)이 섞여
// codex가 "failed to inspect synthetic bubblewrap mount target <root>/.codex: Not a directory"로 읽기·셸·쓰기 전부 실패.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = mkdtempSync(join(tmpdir(), "cxr-data-"));
process.env.MYCREW_HOME = data;
const { codexWritableRoots } = await import("../src/adapters/codex-cli.js");
const { PROJECT_SELF_DIR } = await import("../src/config.js");

mkdirSync(join(data, "history/outputs/qa"), { recursive: true });
mkdirSync(join(data, "history/external"), { recursive: true });
writeFileSync(join(data, "history/external/partners.json"), "{}");

const roots = codexWritableRoots([
  "/history/outputs/qa/**",            // 존재하는 디렉터리 → 포함
  "/history/external/partners.json",    // 파일 → 제외
  "/history/agents/qa/**",              // 아직 없는 history 디렉터리 → 만들어서 포함
  "/apps/*/zz-no-such-dir/**",          // glob인데 매치 없음 → 제외
  "/zz-no-such-code-dir/**",            // 코드 쪽 미존재 → 제외(코드 폴더에 새로 만들지 않음)
]);
assert.ok(roots.includes(join(data, "history/outputs/qa")), "존재하는 디렉터리가 빠졌다");
assert.ok(!roots.some((r) => r.endsWith("partners.json")), "파일이 writable root로 들어갔다");
assert.ok(roots.includes(join(data, "history/agents/qa")), "없는 history 디렉터리를 만들어 넣어야 한다");
assert.ok(!roots.some((r) => r.includes("*")), "glob 문자가 그대로 넘어갔다");
assert.ok(!roots.some((r) => r.includes("zz-no-such")), "존재하지 않는 경로가 들어갔다");
assert.equal(new Set(roots).size, roots.length, "중복");

// glob 전개: 코드 폴더 apps/*/src 같은 실제 디렉터리가 있으면 전개된다
const expanded = codexWritableRoots(["/src/*/"]);
assert.ok(expanded.length > 0 && expanded.every((r) => r.startsWith(PROJECT_SELF_DIR) && !r.includes("*")), `glob 전개 실패: ${expanded}`);

console.log("codex writable roots: PASS");

// codex 실행기: ① history/* 쓰기 경로를 데이터 루트로 ② 잡 중 갱신된 인증을 원본에 되돌려 씀 (2026-09-28)
// 재현 근거: 9/19~26 "refresh token has already been used" — 잡마다 auth.json 사본에서 토큰이 갱신되고 사본째 삭제돼
// 원본의 refresh token이 무효가 됨. 또 writable_roots가 /history/outputs/qa를 코드 폴더 기준으로 풀어 QA 보고서가 안 남음.
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = mkdtempSync(join(tmpdir(), "cx-data-"));
process.env.MYCREW_HOME = data;
const { resolveCodexWritePath, syncBackCodexAuth } = await import("../src/adapters/codex-cli.js");
const { PROJECT_SELF_DIR } = await import("../src/config.js");

// ① 경로
assert.equal(resolveCodexWritePath("/history/outputs/qa/**"), join(data, "history/outputs/qa"), "history 경로가 데이터 루트로 안 간다");
assert.equal(resolveCodexWritePath("/apps/leads/**"), join(PROJECT_SELF_DIR, "apps/leads"), "코드 경로는 코드 폴더 그대로여야 한다");

// ② 인증 되돌려쓰기
const dir = mkdtempSync(join(tmpdir(), "cx-auth-"));
const user = join(dir, "user-auth.json"), job = join(dir, "job-auth.json");
writeFileSync(user, JSON.stringify({ tokens: { refresh_token: "old" } }));
writeFileSync(job, JSON.stringify({ tokens: { refresh_token: "new" } }));
assert.equal(syncBackCodexAuth(job, user), "updated");
assert.equal(JSON.parse(readFileSync(user, "utf8")).tokens.refresh_token, "new", "갱신된 토큰이 원본에 안 돌아왔다");
assert.equal((statSync(user).mode & 0o777).toString(8), "600", "원본 권한은 600이어야 한다");
assert.equal(syncBackCodexAuth(job, user), "same");
writeFileSync(job, "{broken");
assert.equal(syncBackCodexAuth(job, user), "invalid", "깨진 사본으로 원본을 덮으면 안 된다");
assert.equal(JSON.parse(readFileSync(user, "utf8")).tokens.refresh_token, "new");
writeFileSync(job, JSON.stringify({ OPENAI_API_KEY: null }));
assert.equal(syncBackCodexAuth(job, user), "invalid", "토큰 없는 사본으로 덮으면 안 된다");

console.log("codex home sync: PASS");

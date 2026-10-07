// route-golden — 마운트·정적 서빙 유실 회귀 감지 (과거: VAD 404, SSO 폴백 유실, /api/voice 재이식)
// 1) 라우트: 골든 라우트 문자열이 src/server에 존재하는가 (커밋 시점, 서버 불필요)
// 2) 자산: src/client/public 아래 실파일 존재 (정적 서빙 원천)
// 3) 라이브(옵션): ROUTE_GOLDEN_BASE 설정 시 실제 GET — 404·5xx = FAIL
const { execSync } = require("child_process");
const fs = require("fs");
const g = JSON.parse(fs.readFileSync("config/route-golden.json", "utf8"));
let fail = 0;
for (const r of g.routes) {
  let found = false;
  try { execSync(`grep -rq "${r}" src/server src/index.ts`, { stdio: "ignore" }); found = true; } catch {}
  console.log(`${found ? "[PASS]" : "[FAIL]"} 라우트: ${r}${found ? "" : " — src/server에 마운트 문자열 없음(유실 의심)"}`);
  if (!found) fail++;
}
for (const a of g.staticAssets) {
  const fp = "src/client/public" + a;
  const ok = fs.existsSync(fp);
  console.log(`${ok ? "[PASS]" : "[FAIL]"} 자산: ${a}${ok ? "" : " — " + fp + " 없음"}`);
  if (!ok) fail++;
}
const base = process.env.ROUTE_GOLDEN_BASE;
if (base) {
  (async () => {
    for (const r of [...g.routes, ...g.staticAssets]) {
      try {
        const res = await fetch(base + r, { redirect: "manual" });
        const ok = res.status < 404;
        console.log(`${ok ? "[PASS]" : "[FAIL]"} 라이브: ${r} → ${res.status}`);
        if (!ok) fail++;
      } catch (e) { console.log(`[FAIL] 라이브: ${r} — ${e.message}`); fail++; }
    }
    process.exit(fail ? 1 : 0);
  })();
} else process.exit(fail ? 1 : 0);

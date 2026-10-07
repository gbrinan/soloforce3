#!/usr/bin/env node
/* config 씨앗과 직원 wiki 사본이 실제로 일치하는지 대조한다.
 *
 * 배경: ensureAgentDirs는 wiki 사본을 "없을 때만" 만들었다. 그래서 config/agents/<id>/
 * role-directive.md를 고쳐도 이미 만들어진 직원은 옛 사본을 계속 읽었다. 재동기화를 넣었지만
 * 그건 서버가 새 코드로 다시 떠야 동작한다 — 이 스크립트는 "지금 무엇이 어긋나 있는지"를
 * 보여주고, pull·재시작 전후를 대조한다.
 *
 * 실행 (프로젝트 루트에서):
 *   node scripts/check-directive-sync.cjs              현재 상태표
 *   node scripts/check-directive-sync.cjs snapshot     현재 상태를 파일로 저장 (pull 전에)
 *   node scripts/check-directive-sync.cjs compare      저장해 둔 상태와 지금을 대조 (재시작 후에)
 *
 * MYCREW_HOME을 쓰는 설치본이면 그대로 인식한다. 의존성 없음.
 */
const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(__dirname, "..");
const HOME = process.env.MYCREW_HOME ? path.resolve(process.env.MYCREW_HOME) : PROJECT;
const CFG_AGENTS = path.join(PROJECT, "config", "agents");
const WIKI_OF = (id) => path.join(HOME, "history", "agents", id, "wiki", "role-directive.md");
const SNAP = path.join(HOME, "history", ".directive-sync-snapshot.json");

const mode = (process.argv[2] || "status").toLowerCase();

// ── 비교 방법 ───────────────────────────────────────────────────────────────
// 씨앗에는 {{NAME}} 같은 플레이스홀더가 있고 사본에는 치환된 값이 들어 있다. 바이트 비교는
// 치환 로직을 그대로 복제해야 해서 깨지기 쉽고, 플레이스홀더를 지우고 비교하면 그 자리만큼
// 어긋난다. 그래서 섹션 제목만 대조하되 플레이스홀더를 와일드카드로 바꾼 정규식으로 맞춘다.
const sections = (s) =>
  s.split(/\r?\n/).filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.trim());

const seedToRe = (h) =>
  new RegExp("^" + h.split(/\{\{[A-Z_]+\}\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*") + "$");

const shapeMatches = (seedHs, wikiHs) =>
  seedHs.length === wikiHs.length && seedHs.every((h, i) => seedToRe(h).test(wikiHs[i]));

function agents() {
  if (!fs.existsSync(CFG_AGENTS)) return [];
  return fs.readdirSync(CFG_AGENTS)
    .filter((d) => fs.existsSync(path.join(CFG_AGENTS, d, "role-directive.md")))
    .sort();
}

function state(id) {
  const seedPath = path.join(CFG_AGENTS, id, "role-directive.md");
  const wikiPath = WIKI_OF(id);
  const seed = fs.readFileSync(seedPath, "utf-8");
  const seedStat = fs.statSync(seedPath);

  if (!fs.existsSync(wikiPath)) {
    return { id, verdict: "사본없음", detail: "다음 실행 시 씨앗에서 생성된다",
             seedMtime: seedStat.mtimeMs, wikiMtime: 0,
             seedSections: sections(seed), wikiSections: [] };
  }
  const wiki = fs.readFileSync(wikiPath, "utf-8");
  const wikiStat = fs.statSync(wikiPath);
  const ss = sections(seed), ws = sections(wiki);

  let verdict, detail;
  if (shapeMatches(ss, ws)) {
    verdict = "일치";
    detail = "";
  } else if (seedStat.mtimeMs > wikiStat.mtimeMs) {
    verdict = "반영대기";
    detail = "씨앗이 더 최신 — 새 코드로 재시작하면 사본이 교체된다";
  } else {
    verdict = "사본우선";
    detail = "사본이 더 최신 — 손으로 고친 것으로 보고 건드리지 않는다";
  }
  return { id, verdict, detail, seedMtime: seedStat.mtimeMs, wikiMtime: wikiStat.mtimeMs,
           seedSections: ss, wikiSections: ws };
}

function sectionDiff(s) {
  const onlySeed = s.seedSections.filter((h) => !s.wikiSections.some((w) => seedToRe(h).test(w)));
  const onlyWiki = s.wikiSections.filter((w) => !s.seedSections.some((h) => seedToRe(h).test(w)));
  return { onlySeed, onlyWiki };
}

function report(list) {
  const w = Math.max(10, ...list.map((s) => s.id.length));
  console.log(`설치 위치: ${HOME}`);
  console.log(`직원 ${list.length}명\n`);
  console.log(`  ${"직원".padEnd(w)}  ${"판정".padEnd(8)}  설명`);
  console.log(`  ${"-".repeat(w)}  ${"-".repeat(8)}  ${"-".repeat(46)}`);
  for (const s of list) {
    console.log(`  ${s.id.padEnd(w)}  ${s.verdict.padEnd(8)}  ${s.detail}`);
  }

  const stale = list.filter((s) => s.verdict === "반영대기");
  if (stale.length) {
    console.log(`\n반영 대기 ${stale.length}명 — 섹션 차이 (+ 씨앗에만 / - 사본에만):`);
    for (const s of stale) {
      const d = sectionDiff(s);
      console.log(`\n  [${s.id}]`);
      d.onlySeed.forEach((x) => console.log(`    + ${x}`));
      d.onlyWiki.forEach((x) => console.log(`    - ${x}`));
      if (!d.onlySeed.length && !d.onlyWiki.length) {
        console.log("    (섹션 제목은 같고 본문만 다름)");
      }
    }
  }

  const counts = list.reduce((a, s) => ((a[s.verdict] = (a[s.verdict] || 0) + 1), a), {});
  console.log(`\n요약: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

  // 전원 "사본없음"은 정상 상태가 아니라 거의 항상 잘못된 HOME을 본 것이다.
  // 실제로 이 출력을 "18명 다 시딩 대기"로 읽은 적이 있다 — MYCREW_HOME 미설정이었고,
  // 진짜 history는 다른 폴더에 멀쩡히 있었다. 조용히 그럴듯한 것이 제일 나쁘다.
  if (list.length && counts["사본없음"] === list.length) {
    console.log(`\n[경고] 전원 "사본없음" — history를 못 찾은 것일 가능성이 높습니다.`);
    console.log(`  본 곳: ${path.join(HOME, "history")}`);
    console.log(`  존재:  ${fs.existsSync(path.join(HOME, "history")) ? "예" : "아니오"}`);
    if (!process.env.MYCREW_HOME) {
      console.log("  MYCREW_HOME 미설정 — 데이터가 설치 폴더 밖에 있으면 지정해야 합니다.");
      console.log('  예: $env:MYCREW_HOME = "C:\\mycrew\\mycrew-program"  (PowerShell)');
    }
    console.log("  판정을 믿기 전에 위를 먼저 확인하세요.");
  }
  if (stale.length) {
    console.log("\n다음 단계: git pull → npm test → 서버 재시작 → compare 로 다시 실행");
    console.log("교체된 사본의 이전 판본은 role-directive.md.bak 으로 남습니다.");
  }
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const ids = agents();
if (!ids.length) {
  console.error(`ERROR: ${CFG_AGENTS} 에서 직원을 찾지 못했습니다. 프로젝트 루트에서 실행하세요.`);
  process.exit(1);
}
const now = ids.map(state);

if (mode === "snapshot") {
  fs.writeFileSync(SNAP, JSON.stringify({ takenAt: new Date().toISOString(), home: HOME, list: now }, null, 2));
  console.log(`스냅샷 저장: ${SNAP}\n`);
  report(now);
} else if (mode === "compare") {
  if (!fs.existsSync(SNAP)) {
    console.error(`ERROR: 스냅샷이 없습니다 (${SNAP}). pull 전에 snapshot 을 먼저 실행하세요.`);
    process.exit(1);
  }
  const before = JSON.parse(fs.readFileSync(SNAP, "utf-8"));
  const prev = Object.fromEntries(before.list.map((s) => [s.id, s]));
  console.log(`스냅샷 시각: ${before.takenAt}\n`);
  const w = Math.max(10, ...now.map((s) => s.id.length));
  let changed = 0, still = 0;
  for (const s of now) {
    const p = prev[s.id];
    const moved = p && p.wikiMtime !== s.wikiMtime;
    if (moved) changed++;
    if (s.verdict === "반영대기") still++;
    console.log(`  ${s.id.padEnd(w)}  ${(moved ? "바뀜" : "그대로").padEnd(6)}  ${p ? p.verdict : "신규"} → ${s.verdict}`);
  }
  console.log(`\n사본이 실제로 교체된 직원: ${changed}명`);
  if (still) {
    console.log(`아직 반영대기: ${still}명 — pull 또는 재시작이 안 된 것으로 보입니다.`);
    process.exit(1);
  }
  console.log("반영대기 0명 — 동기화 완료.");
} else {
  report(now);
}

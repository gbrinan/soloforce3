// Stage 1 블라인드 라벨 카드 — 과거 워커 결과(A)와 단일 에이전트 결과(B)를 출처 없이 무작위 순서로 보여 준다(G12).
//   npx tsx scripts/stage1/cards.ts --out <stage1 폴더>
// 산출: cards.html(라벨링용, 출처 표시 없음), key.json(카드별 좌우 배치 — 집계 전에는 열지 않는다).
// 라벨은 카드 화면의 «내보내기»로 labels.json 을 받아 같은 폴더에 둔다. 집계는 tally.ts.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rng, type Candidate } from "./sample.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const outDir = arg("--out");
if (!outDir || !existsSync(path.join(outDir, "sample.json"))) {
  console.error(`MISS: ${outDir ?? "--out"}/sample.json 이 없습니다`);
  process.exit(2);
}
const { cases } = JSON.parse(readFileSync(path.join(outDir, "sample.json"), "utf-8")) as { cases: Candidate[] };
const resultsDir = path.join(outDir, "results");
const done = new Set(existsSync(resultsDir) ? readdirSync(resultsDir).map((f) => f.replace(/\.json$/, "")) : []);

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r = rng(4242); // 좌우 배치 시드 — 표본 시드와 분리
const key: Record<string, { left: "A" | "B" }> = {};
const cards: string[] = [];
let skipped = 0;
for (const c of cases) {
  if (!done.has(c.id)) continue;
  const b = JSON.parse(readFileSync(path.join(resultsDir, `${c.id}.json`), "utf-8")) as { ok: boolean; result: string };
  if (!b.ok || !b.result.trim()) { skipped++; continue; } // 실행 실패는 카드로 만들지 않고 집계에 따로 남긴다
  const left: "A" | "B" = r() < 0.5 ? "A" : "B";
  key[c.id] = { left };
  const [one, two] = left === "A" ? [c.result, b.result] : [b.result, c.result];
  const n = cards.length + 1;
  cards.push(`<section class="card" data-id="${c.id}">
  <h2>${n}. 요청</h2><pre class="req">${esc(c.request)}</pre>
  <div class="pair"><div><h3>결과 1</h3><pre>${esc(one)}</pre></div><div><h3>결과 2</h3><pre>${esc(two)}</pre></div></div>
  <fieldset><legend>어느 쪽이 이 요청에 더 쓸모 있나요?</legend>
    ${["1이 낫다", "비슷하다", "2가 낫다", "둘 다 못 쓴다"].map((v) => `<label><input type="radio" name="c-${c.id}" value="${v}"> ${v}</label>`).join("\n    ")}
  </fieldset>
  <label class="flag"><input type="checkbox" name="live-${c.id}"> 실시간 데이터(메일·일정·내부 시스템)가 있어야 제대로 답할 수 있는 요청이다</label>
  <textarea name="note-${c.id}" placeholder="메모(선택)"></textarea>
</section>`);
}

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stage 1 블라인드 비교</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--card:#fff;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--card:#292524;--accent:#60a5fa}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}
header{max-width:1200px;margin:0 auto 16px}.card{max-width:1200px;margin:0 auto 24px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
pre{white-space:pre-wrap;word-break:break-word;max-height:480px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:13px}
.req{max-height:200px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:760px){.pair{grid-template-columns:1fr}}
fieldset{border:1px solid var(--line);border-radius:6px;margin:10px 0}label{margin-right:14px;display:inline-block}.flag{display:block;margin:6px 0;color:var(--muted)}
textarea{width:100%;min-height:48px;box-sizing:border-box;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px}
button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:15px;cursor:pointer}#status{color:var(--muted);margin-left:10px}
</style></head><body>
<header><h1>단일 에이전트 비교 — 블라인드 라벨 ${cards.length}장</h1>
<p>각 요청에 대해 두 결과 중 어느 쪽이 더 쓸모 있는지 골라 주세요. 어느 쪽이 기존 방식인지는 표시하지 않았고, 좌우 배치는 카드마다 무작위입니다. 입력은 마스킹 사본이라 이름 등이 가려져 있습니다.</p>
<p><button id="export">라벨 내보내기 (labels.json)</button><span id="status"></span></p></header>
${cards.join("\n")}
<script>
const KEY="stage1-labels";
function load(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){return {}}}
function save(s){try{localStorage.setItem(KEY,JSON.stringify(s))}catch(e){}}
const state=load();
function collect(){const out={};document.querySelectorAll(".card").forEach(c=>{const id=c.dataset.id;const ch=c.querySelector('input[type=radio]:checked');out[id]={choice:ch?ch.value:null,live:c.querySelector('input[type=checkbox]').checked,note:c.querySelector('textarea').value}});return out}
function status(){const s=collect();const n=Object.values(s).filter(v=>v.choice).length;document.getElementById("status").textContent=n+" / "+Object.keys(s).length+" 완료"}
document.querySelectorAll(".card").forEach(c=>{const v=state[c.dataset.id];if(!v)return;if(v.choice){const r=c.querySelector('input[value="'+v.choice+'"]');if(r)r.checked=true}c.querySelector('input[type=checkbox]').checked=!!v.live;c.querySelector('textarea').value=v.note||""});
document.addEventListener("input",()=>{save(collect());status()});
document.getElementById("export").onclick=()=>{const blob=new Blob([JSON.stringify({labeledAt:new Date().toISOString(),labels:collect()},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="labels.json";a.click()};
status();
</script></body></html>`;

writeFileSync(path.join(outDir, "cards.html"), html);
writeFileSync(path.join(outDir, "key.json"), JSON.stringify({ seed: 4242, key }, null, 2));
console.log(`카드 ${cards.length}장 생성 (실행 실패로 제외 ${skipped}건) → ${path.join(outDir, "cards.html")}`);

#!/usr/bin/env node
// 노션 페이지 → 마크다운 덤프 (NOTION_TOKEN 필요 — .env에서 직접 읽음). [로컬 패치 2026-07-15]
// 사용법: node tools/notion-fetch.mjs "<페이지 URL 또는 32자 id>"
// 통합(Integration) 토큰 발급: https://www.notion.so/my-integrations → 대상 페이지에 통합 연결 필요.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg) {
  console.error('usage: node tools/notion-fetch.mjs "<notion page url or id>"');
  process.exit(1);
}

let token = process.env.NOTION_TOKEN ?? "";
if (!token) {
  try {
    const env = readFileSync(join(__dirname, "..", ".env"), "utf-8");
    const m = env.match(/^NOTION_TOKEN=(.+)$/m);
    if (m) token = m[1].trim();
  } catch { /* .env 없음 */ }
}
if (!token) {
  console.error("NOTION_TOKEN not found — .env에 NOTION_TOKEN=... 을 추가하고, 노션에서 해당 페이지에 통합을 연결하세요.");
  process.exit(2);
}

const idRaw = (arg.match(/[0-9a-f]{32}/i) ?? arg.replace(/-/g, "").match(/[0-9a-f]{32}/i))?.[0];
if (!idRaw) {
  console.error("노션 페이지 id를 찾지 못했습니다: " + arg);
  process.exit(1);
}
const pageId = `${idRaw.slice(0,8)}-${idRaw.slice(8,12)}-${idRaw.slice(12,16)}-${idRaw.slice(16,20)}-${idRaw.slice(20)}`;
const H = { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" };

function rich(arr) { return (arr ?? []).map((t) => t.plain_text ?? "").join(""); }

async function blockToMd(b, depth) {
  const ind = "  ".repeat(depth);
  const t = b.type; const d = b[t] ?? {};
  switch (t) {
    case "heading_1": return `# ${rich(d.rich_text)}`;
    case "heading_2": return `## ${rich(d.rich_text)}`;
    case "heading_3": return `### ${rich(d.rich_text)}`;
    case "paragraph": return rich(d.rich_text);
    case "bulleted_list_item": return `${ind}- ${rich(d.rich_text)}`;
    case "numbered_list_item": return `${ind}1. ${rich(d.rich_text)}`;
    case "to_do": return `${ind}- [${d.checked ? "x" : " "}] ${rich(d.rich_text)}`;
    case "quote": return `> ${rich(d.rich_text)}`;
    case "code": return "```" + (d.language ?? "") + "\n" + rich(d.rich_text) + "\n```";
    case "divider": return "---";
    case "callout": return `> 💡 ${rich(d.rich_text)}`;
    case "toggle": return `${ind}- ${rich(d.rich_text)}`;
    case "child_page": return `${ind}- 📄 하위 페이지: ${d.title} (id: ${b.id})`;
    case "table": return `${ind}(표 — 하위 행 참조)`;
    case "table_row": return `${ind}| ${(d.cells ?? []).map(rich).join(" | ")} |`;
    default: return d.rich_text ? `${ind}${rich(d.rich_text)}` : "";
  }
}

async function dump(blockId, depth) {
  const out = [];
  let cursor;
  do {
    const url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await fetch(url, { headers: H });
    if (!res.ok) { console.error(`Notion API ${res.status}: ${(await res.text()).slice(0,300)}`); process.exit(3); }
    const data = await res.json();
    for (const b of data.results) {
      const line = await blockToMd(b, depth);
      if (line) out.push(line);
      if (b.has_children && b.type !== "child_page") out.push(...(await dump(b.id, depth + 1)));
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: H });
if (pageRes.ok) {
  const page = await pageRes.json();
  const titleProp = Object.values(page.properties ?? {}).find((p) => p.type === "title");
  console.log(`# ${rich(titleProp?.title)}\n`);
}
console.log((await dump(pageId, 0)).join("\n"));

// 프로젝트(projects) 앱 M1 — 읽기 전용 뷰어 서버.
// PROJECTS_DIR(mycrew-works)를 직접 읽는다(learn이 ../bookshelf/data를 직접 읽는 선례).
// 본체(mycrew-program)를 호출하지 않아 SSO 리스크 없음. 쓰기·버전·RAG·도메인분류 없음(M1은 열람만).
// NFC 정규화 + 경로가드는 src/server/projects-query.ts와 동일 로직을 인라인 구현.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, resolve, sep, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
// apps/projects → ../../.. = 워크스페이스 루트(C:/mycrew), +mycrew-works. env로 오버라이드 가능(테스트용).
const PROJECTS_DIR = process.env.PROJECTS_DIR
  ? resolve(process.env.PROJECTS_DIR)
  : join(ROOT, "..", "..", "..", "mycrew-works");
const CATEGORY_DIRS = ["ax-consulting", "education", "ax-research", "spf"];
const FOLDER_KEYS = ["00-sessions", "10-curriculum", "20-feedback", "30-proposals", "outputs"];
const READABLE_EXTS = new Set([".md", ".txt", ".json"]);
const PREFIX = "/api/apps/projects/proxy"; // strip 모드라 보통 제거된 채 도달하지만 방어적으로 처리
const PORT = Number(process.env.PORT) || 13248;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const nfc = (s) => s.normalize("NFC");

// ── NFD 관용 실존 해석 (path-normalize.ts resolveExistingArtifact 축약판: 단일 디렉터리 스코프) ──
function resolveExistingFile(fullPath, relPath, baseDir) {
  if (existsSync(fullPath)) return fullPath;
  const nfcPath = fullPath.normalize("NFC");
  if (nfcPath !== fullPath && existsSync(nfcPath)) return nfcPath;
  // basename NFC 비교로 같은 디렉터리 안에서만 구제(폴더 이탈 없음)
  const targetDir = dirname(fullPath);
  const targetBn = nfc(relPath.split("/").pop() ?? "");
  try {
    for (const n of readdirSync(targetDir)) {
      if (nfc(n) === targetBn) {
        const full = join(targetDir, n);
        if (existsSync(full)) return full;
      }
    }
  } catch { /* 디렉터리 부재 */ }
  return null;
}

function readProjectJson(dir) {
  const p = join(dir, "project.json");
  if (!existsSync(p)) return null;
  try { const raw = JSON.parse(readFileSync(p, "utf-8")); return raw && typeof raw === "object" ? raw : null; }
  catch { return null; }
}

function toSummary(category, slug, pj) {
  const rawSessions = pj && pj.anandaraSessions;
  const sessions = rawSessions && typeof rawSessions === "object" ? rawSessions : null;
  const domRaw = pj && pj.domain;
  let domain = [];
  if (Array.isArray(domRaw)) domain = domRaw.map((d) => String(d));
  else if (domRaw && typeof domRaw === "object" && Array.isArray(domRaw.labels)) {
    domain = domRaw.labels.map((l) => String((l && l.name) ?? "")).filter(Boolean);
  }
  return {
    category, slug,
    name: pj && typeof pj.name === "string" ? pj.name : slug,
    client: pj && typeof pj.anandaraClient === "string" ? pj.anandaraClient
      : (pj && typeof pj.client === "string" ? pj.client : null),
    status: pj && typeof pj.status === "string" ? pj.status : null,
    sessions,
    domain,
    generatedBy: pj && typeof pj.generatedBy === "string" ? pj.generatedBy : null,
  };
}

function listProjects(category, search) {
  if (!existsSync(PROJECTS_DIR)) return [];
  const cats = category ? [category] : CATEGORY_DIRS;
  const q = search ? nfc(search).toLowerCase() : "";
  const out = [];
  for (const cat of cats) {
    let entries;
    try { entries = readdirSync(join(PROJECTS_DIR, cat), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const slug = nfc(e.name);
      const s = toSummary(cat, slug, readProjectJson(join(PROJECTS_DIR, cat, e.name)));
      if (q && !(`${s.name} ${s.client ?? ""}`.toLowerCase().includes(q))) continue;
      out.push(s);
    }
  }
  return out;
}

function resolveProjectDir(category, slug) {
  if (!CATEGORY_DIRS.includes(category)) return null;
  const catDir = join(PROJECTS_DIR, category);
  const direct = join(catDir, slug);
  if (existsSync(direct)) return direct;
  const want = nfc(slug);
  try {
    for (const e of readdirSync(catDir, { withFileTypes: true })) {
      if (e.isDirectory() && nfc(e.name) === want) return join(catDir, e.name);
    }
  } catch { /* 카테고리 폴더 부재 */ }
  return null;
}

function getProject(category, slug) {
  const dir = resolveProjectDir(category, slug);
  if (!dir) return null;
  const pj = readProjectJson(dir);
  const base = toSummary(category, nfc(slug), pj);
  const folders = FOLDER_KEYS.map((key) => {
    let files = [];
    try {
      files = readdirSync(join(dir, key), { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith("."))
        .map((d) => { const st = statSync(join(dir, key, d.name)); return { name: nfc(d.name), size: st.size, mtime: st.mtime.toISOString() }; });
    } catch { /* 폴더 부재 */ }
    return { key, files };
  });
  return { ...base, folders, projectJson: pj ?? {} };
}

function readProjectFile(category, slug, relPath) {
  const dir = resolveProjectDir(category, slug);
  if (!dir) return null;
  const cleanRel = nfc(relPath).replace(/\\/g, "/");
  if (!cleanRel || cleanRel.includes("..") || cleanRel.startsWith("/")) return null; // 경로탈출 차단
  if (!READABLE_EXTS.has(extname(cleanRel).toLowerCase())) return null;               // 확장자 화이트리스트
  const root = resolve(dir);
  const target = resolve(dir, cleanRel);
  if (target !== root && !target.startsWith(root + sep)) return null;                 // 루트 이탈 차단
  const actual = resolveExistingFile(target, cleanRel, dir);                          // NFD 관용
  if (!actual) return null;
  const st = statSync(actual);
  if (!st.isFile()) return null;
  return { path: cleanRel, content: readFileSync(actual, "utf-8"), mtime: st.mtime.toISOString() };
}

// ── HTTP ────────────────────────────────────────────────────────────────
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function handleApi(res, p, query) {
  if (p === "/api/health") return json(res, 200, { ok: true, app: "projects" });

  if (p === "/api/projects") {
    const category = query.get("category") || undefined;
    const search = query.get("search") || undefined;
    return json(res, 200, { projects: listProjects(category, search) });
  }

  let m = p.match(/^\/api\/projects\/([^/]+)\/([^/]+)\/file$/);
  if (m) {
    const f = readProjectFile(decodeURIComponent(m[1]), decodeURIComponent(m[2]), query.get("path") || "");
    if (!f) return json(res, 404, { error: "not found or not allowed" });
    return json(res, 200, { file: f });
  }

  m = p.match(/^\/api\/projects\/([^/]+)\/([^/]+)$/);
  if (m) {
    const detail = getProject(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    if (!detail) return json(res, 404, { error: "not found" });
    return json(res, 200, { project: detail });
  }

  return json(res, 404, { error: "unknown api" });
}

const server = http.createServer(async (req, res) => {
  const raw = req.url || "/";
  let p = decodeURIComponent(raw.split("?")[0]);
  const query = new URLSearchParams(raw.split("?")[1] ?? "");
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || "/";

  if (p.startsWith("/api/")) {
    try { handleApi(res, p, query); }
    catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  // 정적: 단일 index.html SPA만 서빙(외부 자산 0)
  const rel = normalize(p === "" || p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(ROOT, rel);
  try {
    const st = await stat(filePath);
    const fp = st.isDirectory() ? join(filePath, "index.html") : filePath;
    const data = await readFile(fp);
    res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(data);
    } catch { res.writeHead(404); res.end("not found"); }
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`projects on http://127.0.0.1:${PORT} dir=${PROJECTS_DIR}`));

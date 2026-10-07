// Projects 앱 M2a 쓰기 토대 — 본체 서버가 node:fs로 PROJECTS_DIR 하위에 쓰는 canonical writer.
//
// 읽기(projects-query.ts)의 격리 규칙을 대칭으로 적용하고, 쓰기 특유의 보강을 더한다:
//   · 카테고리 화이트리스트 + 슬러그/상대경로 경로탈출 차단 + NFC 정규화(path-normalize.ts)
//   · 확장자 화이트리스트 + PROJECTS_DIR 밖 절대 거부
//   · 상위폴더 자동생성 + 원자적 쓰기(atomic-write.ts 재사용, temp→rename) + 멱등(내용 동일 시 skip)
//
// 승인/approval-cache 로직은 일절 건드리지 않는다(설계 지시). 쓰기 주체 경계 —
// "누가 쓸 자격이 있나" — 는 이 함수가 아니라 라우트의 SSO 사용자 세션 전제가 담당한다.
// 이 함수는 순수 파일시스템 쓰기만 하며, 라우트와 배치 CLI가 공유한다.
//
// 관련: procedure_writepaths-vs-server-fs(앱/본체 쓰기는 서버 node:fs = 런타임 OS 권한, writePaths 무관).
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, extname, dirname, sep } from "node:path";
import { PROJECTS_DIR } from "../config.js";
import { CATEGORY_DIRS } from "./anandara-projects.js";
import { atomicWriteFileSync } from "./utils/atomic-write.js";
import { nfc } from "./utils/path-normalize.js";

// 읽기(READABLE_EXTS)와 동일 집합 — 쓰기라고 더 넓히지 않는다.
const WRITABLE_EXTS = new Set([".md", ".txt", ".json"]);

export interface WriteOk { ok: true; category: string; slug: string; path: string; written: boolean; }
export interface WriteErr { ok: false; error: string; code: number; }
export type WriteResult = WriteOk | WriteErr;

// 세그먼트(카테고리·슬러그) 검증 — 경로탈출/구분자/절대·은닉 세그먼트 차단.
function badSegment(seg: string): boolean {
  return !seg || seg.includes("..") || seg.includes("/") || seg.includes("\\") || seg.startsWith(".");
}

/**
 * PROJECTS_DIR/<category>/<slug>/<relPath> 에 파일 하나를 안전하게 쓴다.
 * @returns 성공 시 written=true(신규/변경) 또는 false(내용 동일 skip), 실패 시 error+code(400/404).
 */
export function writeProjectFile(
  category: string, slug: string, relPath: string, content: string,
): WriteResult {
  const cat = nfc(category ?? "").trim();
  const sl = nfc(slug ?? "").trim();

  // 1) 카테고리는 화이트리스트, 슬러그는 경로탈출 차단
  if (!(CATEGORY_DIRS as readonly string[]).includes(cat))
    return { ok: false, error: `unknown category: ${category}`, code: 400 };
  if (badSegment(sl)) return { ok: false, error: "invalid slug", code: 400 };

  // 2) 상대경로 정규화 + 경로탈출 차단
  const cleanRel = nfc(relPath ?? "").replace(/\\/g, "/");
  if (!cleanRel || cleanRel.includes("..") || cleanRel.startsWith("/"))
    return { ok: false, error: "invalid path", code: 400 };

  // 3) 확장자 화이트리스트
  if (!WRITABLE_EXTS.has(extname(cleanRel).toLowerCase()))
    return { ok: false, error: `extension not allowed: ${extname(cleanRel)}`, code: 400 };

  // 4) PROJECTS_DIR 밖 절대 거부 (resolve 후 root 이탈 차단)
  const projDir = join(PROJECTS_DIR, cat, sl);
  const root = resolve(projDir);
  const target = resolve(projDir, cleanRel);
  if (target !== root && !target.startsWith(root + sep))
    return { ok: false, error: "path escapes project dir", code: 400 };

  // 5) 멱등 — 기존 내용과 같으면 쓰지 않는다(mtime 보존).
  try {
    if (existsSync(target) && statSync(target).isFile() && readFileSync(target, "utf-8") === content)
      return { ok: true, category: cat, slug: sl, path: cleanRel, written: false };
  } catch { /* 읽기 실패 시 아래에서 덮어쓴다 */ }

  // 6) 상위폴더 자동생성 + 원자적 쓰기
  mkdirSync(dirname(target), { recursive: true });
  atomicWriteFileSync(target, content);
  return { ok: true, category: cat, slug: sl, path: cleanRel, written: true };
}

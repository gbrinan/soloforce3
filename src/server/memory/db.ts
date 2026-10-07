// memory/db.ts — memory.db 연결 + 운영 PRAGMA + 마이그레이션.
// 불변식 M1: 이 DB는 재생성 가능한 인덱스. 진실은 마크다운(history/).

import Database from "better-sqlite3";
import { join } from "node:path";
import { HISTORY_DIR } from "../../config.js";
import { runMigrations } from "./schema.js";

export type { Database } from "better-sqlite3";

export const MEMORY_DB_PATH = join(HISTORY_DIR, "memory.db");

// path 미지정 시 실제 memory.db. 테스트/드라이런은 ":memory:" 전달.
export function openMemoryDb(path: string = MEMORY_DB_PATH) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  const { version, tokenizer } = runMigrations(db);
  db.pragma("optimize");
  // [데이터 감사 P0-1] WAL 체크포인트 부재로 -wal(4.2MB)이 본체(2.9MB)를 추월했었다.
  // 데스크톱 앱은 비정상 종료가 흔하므로: 열 때 1회 TRUNCATE + 10분 주기 + 종료 시그널에서 수행.
  if (path !== ":memory:") {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* 잠금 중이면 다음 주기에 */ }
    const ckpt = setInterval(() => {
      try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* noop */ }
    }, 10 * 60_000);
    ckpt.unref?.();
    const closeOnce = () => { try { db.pragma("wal_checkpoint(TRUNCATE)"); db.close(); } catch { /* noop */ } };
    process.once("beforeExit", closeOnce);
    process.once("SIGINT", () => { closeOnce(); process.exit(130); });
    process.once("SIGTERM", () => { closeOnce(); process.exit(143); });
  }
  return { db, version, tokenizer };
}

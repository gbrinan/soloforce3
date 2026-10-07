// 일회성 프리시드 스크립트: store-catalog.ts의 PLUGIN_ITEMS/APP_ITEMS(22개)를
// history/store/installed.jsonl에 설치 완료 레코드로 기록 (userId sentinel: "local-owner")
// 사용: npx tsx scripts/store-preseed-installed.ts
// 멱등: 이미 기록된 {kind}:{itemId} 조합은 건너뜀
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR } from "../src/config.js";

// store-catalog.ts PLUGIN_ITEMS/APP_ITEMS id 미러 (모듈 비공개 export라 직접 import 불가)
const PLUGIN_IDS = [
  "inbox", "notifications", "todos", "schedules", "meeting",
  "notes", "files", "staff", "costs", "contacts",
] as const;
const APP_IDS = [
  "photos", "sign", "movie", "design", "pdf", "booking",
  "mail", "payment", "approval", "mymaps", "notes", "calc",
] as const;

const USER_ID = "local-owner";
const STORE_DIR = join(HISTORY_DIR, "store");
const INSTALLED_FILE = join(STORE_DIR, "installed.jsonl");

interface InstalledRecord {
  userId: string;
  itemId: string;
  kind: "skill" | "plugin" | "app";
  action: "install" | "uninstall";
  at: string;
}

export function preseedInstalled(): number {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });

  const existingKeys = new Set<string>();
  if (existsSync(INSTALLED_FILE)) {
    const lines = readFileSync(INSTALLED_FILE, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as InstalledRecord;
        if (rec.userId === USER_ID) existingKeys.add(`${rec.kind}:${rec.itemId}`);
      } catch {
        // 손상된 라인 무시
      }
    }
  }

  const targets: { itemId: string; kind: "plugin" | "app" }[] = [
    ...PLUGIN_IDS.map((itemId) => ({ itemId, kind: "plugin" as const })),
    ...APP_IDS.map((itemId) => ({ itemId, kind: "app" as const })),
  ];

  let written = 0;
  const now = new Date().toISOString();
  for (const { itemId, kind } of targets) {
    const key = `${kind}:${itemId}`;
    if (existingKeys.has(key)) continue;
    const rec: InstalledRecord = { userId: USER_ID, itemId, kind, action: "install", at: now };
    appendFileSync(INSTALLED_FILE, JSON.stringify(rec) + "\n", "utf-8");
    existingKeys.add(key);
    written++;
  }
  return written;
}

if (process.argv[1] && process.argv[1].endsWith("store-preseed-installed.ts")) {
  const count = preseedInstalled();
  console.log(`[store-preseed] ${count}건 신규 기록 (userId=${USER_ID})`);
}

// history/ 무한 성장 파일 유지보수 — 부팅 시 1회 실행.
// (플랫폼 분석 2026-07-04 P1: cost-log.jsonl·approvals.json·installed.jsonl이
//  append-only로 무한 성장하던 문제. 대화 md는 사용자 데이터라 건드리지 않는다.)
import { existsSync, statSync, renameSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { HISTORY_DIR } from "../config.js";

const ROTATE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB

// 크기 초과 시 날짜 접미사로 아카이브하고 새 파일로 시작 (원본 보존 — 삭제 없음)
function rotateIfLarge(relPath: string): void {
  const file = join(HISTORY_DIR, relPath);
  try {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size < ROTATE_THRESHOLD_BYTES) return;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const archived = file.replace(/\.jsonl$/, `-${stamp}.jsonl`);
    if (existsSync(archived)) return; // 같은 날 중복 로테이션 방지
    renameSync(file, archived);
    console.log(`[HistoryMaint] ${relPath} 로테이션 (${(size / 1024 / 1024).toFixed(1)}MB → ${archived.split("/").pop()})`);
  } catch (err) {
    console.warn(`[HistoryMaint] ${relPath} 로테이션 실패:`, err instanceof Error ? err.message : err);
  }
}

// installed.jsonl 컴팩션 — install/uninstall 로그를 리플레이해 (userId,kind,itemId)별
// 최종 상태만 남긴다. 상태 재생 결과가 동일하므로 소비자(store-installed.ts 등)에 무영향.
// bootstrap 레코드는 최종 install 상태 위에서만 의미가 있으므로 함께 보존한다.
function compactInstalledLog(): void {
  const file = join(HISTORY_DIR, "store", "installed.jsonl");
  try {
    if (!existsSync(file)) return;
    if (statSync(file).size < ROTATE_THRESHOLD_BYTES) return;
    const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const finalAction = new Map<string, string>(); // key → 마지막 install/uninstall 라인
    const bootstraps = new Map<string, string>(); // key → 마지막 bootstrap 라인
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as { userId?: string; kind?: string; itemId?: string; action?: string };
        const key = `${rec.userId}|${rec.kind}|${rec.itemId}`;
        if (rec.action === "bootstrap") bootstraps.set(key, line);
        else finalAction.set(key, line);
      } catch {
        /* 손상 라인 스킵 */
      }
    }
    const kept: string[] = [];
    for (const [key, line] of finalAction) {
      kept.push(line);
      const b = bootstraps.get(key);
      if (b && line.includes('"install"')) kept.push(b);
    }
    writeFileSync(file, kept.join("\n") + "\n");
    console.log(`[HistoryMaint] installed.jsonl 컴팩션: ${lines.length} → ${kept.length}줄`);
  } catch (err) {
    console.warn("[HistoryMaint] installed.jsonl 컴팩션 실패:", err instanceof Error ? err.message : err);
  }
}

// approvals.json 정리 — 미해결 항목은 전부 보존, 해결된 항목은 30일만 보관.
// (loadApprovals()보다 먼저 실행되므로 부팅 시 로드 대상 자체가 줄어든다)
function pruneApprovals(): void {
  const file = join(HISTORY_DIR, "approvals.json");
  try {
    if (!existsSync(file)) return;
    const arr = JSON.parse(readFileSync(file, "utf-8")) as { status?: string; resolvedAt?: string }[];
    if (!Array.isArray(arr)) return;
    const cutoff = Date.now() - 30 * 24 * 3600_000;
    const kept = arr.filter((a) => {
      if (a.status === "pending" || !a.resolvedAt) return true; // 미해결은 항상 보존
      const t = Date.parse(a.resolvedAt);
      return !Number.isFinite(t) || t >= cutoff;
    });
    if (kept.length === arr.length) return;
    writeFileSync(file, JSON.stringify(kept, null, 2));
    console.log(`[HistoryMaint] approvals.json 정리: ${arr.length} → ${kept.length}건 (해결 후 30일 경과분 제거)`);
  } catch (err) {
    console.warn("[HistoryMaint] approvals 정리 실패:", err instanceof Error ? err.message : err);
  }
}

// 대화 원본 아카이브 — "일일 요약 생성 완료 + 14일 경과" 파일만 gzip.
// 요약이 생기면 chat.ts가 원본을 다시 읽지 않으므로(generateDailySummaries) 안전.
// .md.gz는 .md 필터에서 자연히 제외되어 요약/목록 로직에 영향 없음. zcat으로 열람 가능.
function archiveOldConversations(): void {
  const convDir = join(HISTORY_DIR, "conversations");
  const dailyDir = join(HISTORY_DIR, "genie", "daily");
  try {
    if (!existsSync(convDir)) return;
    const cutoff = Date.now() - 14 * 24 * 3600_000;
    let archived = 0;
    let savedBytes = 0;
    for (const f of readdirSync(convDir)) {
      if (!f.endsWith(".md")) continue;
      const date = f.replace(/\.md$/, "");
      const t = Date.parse(`${date}T00:00:00`);
      if (!Number.isFinite(t) || t >= cutoff) continue; // 14일 이내는 보존
      if (!existsSync(join(dailyDir, `${date}.md`))) continue; // 요약 미생성분은 보존 (요약 대상)
      const src = join(convDir, f);
      const raw = readFileSync(src);
      writeFileSync(`${src}.gz`, gzipSync(raw, { level: 9 }));
      unlinkSync(src);
      archived++;
      savedBytes += raw.byteLength;
    }
    if (archived > 0) {
      console.log(`[HistoryMaint] 대화 아카이브: ${archived}개 파일 gzip (${(savedBytes / 1024 / 1024).toFixed(0)}MB 원본)`);
    }
  } catch (err) {
    console.warn("[HistoryMaint] 대화 아카이브 실패:", err instanceof Error ? err.message : err);
  }
}

export function runHistoryMaintenance(): void {
  rotateIfLarge("cost-log.jsonl");
  rotateIfLarge("jobs.jsonl");
  compactInstalledLog();
  pruneApprovals();
  archiveOldConversations();
}

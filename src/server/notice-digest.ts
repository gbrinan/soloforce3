// 단순 내부 알림 «비재개 단발 처리» + 다이제스트 — 판정/서식(순수) + 작은 파일 IO.
//
// 왜(2026-10-02 실측, cost-log 중앙값): scheduler:state-change·job:notify:ok·scheduler:notify 는
// 매번 genie 장기 세션 전체를 --resume 했다(캐시읽기 중앙값 약 100~114k 토큰/회).
// 알림 1건 처리에 대화 전체 맥락은 필요 없다. 그래서 이 3종은 새 세션(비재개)·저가 모델로
// «알림 + 짧은 상황 요약»만 주고 처리한다. 도구·권한·태그 처리(위임 등)는 genie 그대로다.
//
// 맥락 단절 보완: 처리한 알림을 한 줄씩 notice-digest.jsonl(최대 50줄 롤링)에 남기고,
// 다음 «진짜» genie 턴(재개 세션) 앞에 "최근 내부 알림 요약" 블록으로 1회 덧붙인 뒤 소비 처리한다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 비재개 단발로 처리할 source. 여기 없는 source 는 기존대로 genie 세션을 재개한다. */
export const FRESH_NOTICE_SOURCES: ReadonlySet<string> = new Set([
  "scheduler:state-change",
  "job:notify:ok",
  "scheduler:notify",
  "chat:auto-continuation-stalled",
]);

/** 환경변수 SOLOFORCE_FRESH_NOTICES=0 이면 전부 기존 재개 경로(긴급 롤백 스위치). */
export function isFreshNoticeSource(source: string | undefined | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!source) return false;
  if (env.SOLOFORCE_FRESH_NOTICES === "0") return false;
  return FRESH_NOTICE_SOURCES.has(source);
}

export const DIGEST_MAX_LINES = 50;

export interface NoticeDigestEntry {
  ts: string;
  source: string;
  notice: string;
  reply: string;
  consumed?: boolean;
}

/** 주석 태그·공백 정리 후 한 줄로 자른다. */
export function oneLine(text: string, max: number): string {
  const s = text.replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function makeDigestEntry(source: string, notice: string, reply: string, nowIso?: string): NoticeDigestEntry {
  // 알림 첫 줄은 대개 "[시스템 …]" 머리말이라 앞 3줄을 합쳐 본다.
  const body = notice.split("\n").filter((l) => l.trim()).slice(0, 3).join(" ");
  return {
    ts: nowIso ?? new Date().toISOString(),
    source,
    notice: oneLine(body, 160),
    reply: oneLine(reply, 160) || "(무응답)",
  };
}

/** 배열을 상한까지 뒤에서부터 남긴다. */
export function capLines<T>(lines: T[], max = DIGEST_MAX_LINES): T[] {
  return lines.length > max ? lines.slice(lines.length - max) : lines;
}

/** 미소비 항목으로 프롬프트 블록을 만든다. 없으면 빈 문자열. */
export function buildDigestBlock(entries: NoticeDigestEntry[], maxItems = 15): string {
  const pending = entries.filter((e) => !e.consumed);
  if (pending.length === 0) return "";
  const shown = pending.slice(-maxItems);
  const omitted = pending.length - shown.length;
  const lines = shown.map((e) => `- ${e.ts.slice(11, 16)} [${e.source}] ${e.notice} → ${e.reply}`);
  const head = `[최근 내부 알림 요약 — 별도 단발 세션에서 처리된 알림${omitted > 0 ? `, 이전 ${omitted}건 생략` : ""}]`;
  return `${head}\n${lines.join("\n")}\n[최근 내부 알림 요약 끝]`;
}

function readEntries(path: string): NoticeDigestEntry[] {
  if (!existsSync(path)) return [];
  const out: NoticeDigestEntry[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as NoticeDigestEntry); } catch { /* 손상 라인 무시 */ }
  }
  return out;
}

function writeEntries(path: string, entries: NoticeDigestEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
}

/** 1건 추가 + 50줄 상한 유지. 실패해도 throw 하지 않는다(알림 처리 경로 무영향). */
export function appendNoticeDigest(path: string, entry: NoticeDigestEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n");
    const all = readEntries(path);
    if (all.length > DIGEST_MAX_LINES) writeEntries(path, capLines(all));
  } catch (e) {
    console.warn("[NoticeDigest] 기록 실패:", e instanceof Error ? e.message : e);
  }
}

/** 미소비 블록을 돌려주고 전부 consumed 로 표시한다(1회성). */
export function consumeNoticeDigest(path: string): string {
  try {
    const all = readEntries(path);
    const block = buildDigestBlock(all);
    if (!block) return "";
    writeEntries(path, capLines(all.map((e) => ({ ...e, consumed: true }))));
    return block;
  } catch (e) {
    console.warn("[NoticeDigest] 소비 실패:", e instanceof Error ? e.message : e);
    return "";
  }
}

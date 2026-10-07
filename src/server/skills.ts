import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { HISTORY_DIR, PROMPTS_DIR } from "../config.js";

// 스킬-알바 라이브 공유 풀. 직원들이 여기서 스킬-알바를 추가·갱신한다.
export const SKILLS_DIR = join(HISTORY_DIR, "skills");

function metaOf(src: string, key: string): string {
  return src.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*(.+)`))?.[1]?.trim() ?? "";
}

function buildIndexMd(rows: string[]): string {
  return `# 스킬-알바 인덱스 (라이브 풀)

스킬-알바 = \`Agent\` 도구로 스폰해 쓰는, 검증된 재사용 서브에이전트.
이 디렉토리(\`history/skills/\`)가 **살아있는 공유 풀**입니다 — 전 직원이 함께 씁니다.

**작업을 받으면 먼저 이 표에서 맞는 스킬-알바를 찾으세요.** 있으면 정의 파일을 SafeRead해 \`Agent\` 도구로 스폰합니다.

| 스킬-알바 | 설명 | owner | 키워드 |
|-----------|------|-------|--------|
${rows.join("\n")}

---
- 새 스킬-알바를 추가하면 이 표에 행을 추가하세요. 정의 포맷은 \`prompts/sub-agents/_TEMPLATE.md\` 참고.
- 각 스킬-알바의 **owner**가 유지보수 책임자입니다. 사용 후 피드백은 해당 파일의 "사용 이력 · 피드백"에 남기세요.
`;
}

/**
 * 스킬-알바 라이브 풀 시딩 (부팅 1회).
 * history/skills/ 가 아직 없으면 prompts/sub-agents/ 의 코드 시드를 복사하고
 * 라이브 라우팅 index.md 를 생성한다.
 * 이미 시드돼 있으면(직원이 키운 풀) 절대 손대지 않는다 — index.md 존재 여부로 판별.
 */
export function ensureSkillsSeeded(): void {
  if (existsSync(join(SKILLS_DIR, "index.md"))) return; // 이미 시드됨 — 보존
  const seedDir = join(PROMPTS_DIR, "sub-agents");
  if (!existsSync(seedDir)) return;
  mkdirSync(SKILLS_DIR, { recursive: true });
  const rows: string[] = [];
  for (const f of readdirSync(seedDir)) {
    // 포맷 템플릿(_TEMPLATE.md)·시드 인덱스(index.md)는 스킬 정의가 아니므로 제외
    if (!f.endsWith(".md") || f === "_TEMPLATE.md" || f === "index.md") continue;
    const src = readFileSync(join(seedDir, f), "utf8");
    copyFileSync(join(seedDir, f), join(SKILLS_DIR, f));
    rows.push(
      `| ${f.replace(/\.md$/, "")} | ${metaOf(src, "설명")} | ${metaOf(src, "owner")} | ${metaOf(src, "키워드")} |`,
    );
  }
  writeFileSync(join(SKILLS_DIR, "index.md"), buildIndexMd(rows));
  console.log(`[Skills] history/skills/ 시드 복사 완료 (${rows.length}개 스킬-알바)`);
}

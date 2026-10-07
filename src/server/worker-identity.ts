import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** This same identity block is included by buildWorkerPrompt in a fresh worker session. */
export function loadWorkerIdentity(agentId: string, historyDir: string): string {
  const dir = join(historyDir, 'agents', agentId, 'wiki');
  const parts: string[] = [];
  const rdPath = join(dir, 'role-directive.md');
  if (existsSync(rdPath)) parts.push(`[역할 지시서]\n${readFileSync(rdPath, 'utf-8')}\n[역할 지시서 끝]`);
  const spPath = join(dir, 'self-profile.md');
  if (existsSync(spPath)) {
    parts.push(`[자기 프로필]\n${readFileSync(spPath, 'utf-8')}\n[자기 프로필 끝]`);
  } else {
    parts.push('[안내] self-profile.md가 없습니다. 작업 경험이 쌓이면 wiki/self-profile.md에 강점, 약점, 교훈을 기록하세요.');
  }
  return parts.join('\n\n');
}

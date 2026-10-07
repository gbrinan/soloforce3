// claude CLI memory 폴더 경로 계산.
// cwd 절대경로의 / 를 - 로 치환한 hash 사용 (claude CLI 컨벤션).
// 예: /Users/foo/bar -> ~/.claude/projects/-Users-foo-bar
// 다른 PC/사용자명에서도 동작하도록 절대경로 하드코딩 금지.

import { homedir } from "node:os";
import { join } from "node:path";

export function computeMemoryDir(cwd: string): string {
  const hash = cwd.replace(/[/\\]/g, "-");  // Windows 백슬래시도 처리
  return join(homedir(), ".claude", "projects", hash);
}

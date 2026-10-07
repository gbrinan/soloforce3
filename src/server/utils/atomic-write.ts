// 원자적 파일 쓰기 + 손상 파일 격리 — 영속 JSON 저장소 공용 헬퍼 (2026-07-17 데이터 감사 P0-2/P0-3).
//
// 배경: jobs/todos/approvals 등 주요 저장소가 bare writeFileSync 전체 재작성이라
// 크래시 타이밍에 파일이 찢어지고, 다음 부팅의 파싱 실패 경로가 빈 상태로 시작한 뒤
// 곧바로 저장하면서 복구 가능한 손상본을 빈 파일로 덮어쓰는 유실 구조였다.
import { writeFileSync, renameSync, existsSync } from "node:fs";

/** tmp에 쓴 뒤 rename — 어느 시점에 죽어도 원본은 온전한 구본 또는 완전한 신본. */
export function atomicWriteFileSync(filepath: string, content: string): void {
  const tmp = filepath + ".tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, filepath);
}

/**
 * 파싱 실패한 파일을 `*.corrupt-<ts>`로 격리 — 이후 빈 상태로 저장해도 원본이 소각되지 않는다.
 * 반환: 격리된 경로(없으면 null). 호출부는 console.error로 사용자에게 알릴 것.
 */
export function quarantineCorruptFile(filepath: string): string | null {
  try {
    if (!existsSync(filepath)) return null;
    const dest = `${filepath}.corrupt-${Date.now()}`;
    renameSync(filepath, dest);
    return dest;
  } catch {
    return null;
  }
}

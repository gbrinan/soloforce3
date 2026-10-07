// HDCLEANER_TEST_MODE=1 일 때만 활성화되는 테스트 훅. 테스트 모드가 아니면 전 함수 완전 no-op.
// 우즈 QA §6.3 개발자 훅 요구사항 반영: fixture 주입, 권한 mock, 삭제 결과 mock, 감사 로그 조회, 상태 리셋.
import { readFile } from "node:fs/promises";
import { getAuditPath } from "./deleter/audit";

const TEST_MODE = process.env.HDCLEANER_TEST_MODE === "1";

interface FixtureItem {
  path: string;
  size: number;
}

let fixtures: FixtureItem[] = [];
let permissionGranted = true;
let deleteResultOverride: "success" | "failure" | null = null;

export function isTestMode(): boolean {
  return TEST_MODE;
}

export function injectFixture(path: string, size: number): void {
  if (!TEST_MODE) return;
  fixtures.push({ path, size });
}

export function mockPermission(granted: boolean): void {
  if (!TEST_MODE) return;
  permissionGranted = granted;
}

export function mockDeleteResult(result: "success" | "failure"): void {
  if (!TEST_MODE) return;
  deleteResultOverride = result;
}

export async function readAuditLog(): Promise<string> {
  if (!TEST_MODE) return "";
  try {
    return await readFile(getAuditPath(), "utf-8");
  } catch {
    return "";
  }
}

export function resetState(): void {
  if (!TEST_MODE) return;
  fixtures = [];
  permissionGranted = true;
  deleteResultOverride = null;
}

export function getFixtures(): FixtureItem[] {
  return TEST_MODE ? fixtures : [];
}

export function getPermissionGranted(): boolean {
  return permissionGranted;
}

export function getMockDeleteResult(): "success" | "failure" | null {
  return deleteResultOverride;
}

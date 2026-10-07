// ensure-next-link: predev/prebuild/prestart 가드.
// 이 앱은 로컬 node_modules에 next를 설치해 사용한다. 과거 모노레포 호이스팅 환경에서
// next 바이너리 링크를 보장하던 헬퍼가 유실되어 predev/prebuild/prestart가 전부
// 깨졌었다(빌드 불가 → 결재 앱 빈 화면). 현재는 next가 로컬에 존재하므로 존재를
// 검증하고 통과시키는 멱등 가드로 복구한다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const nextPkg = join(appDir, "node_modules", "next", "package.json");

if (!existsSync(nextPkg)) {
  console.error("[ensure-next-link] next가 없습니다. 'npm install'을 먼저 실행하세요.");
  process.exit(1);
}
console.log("[ensure-next-link] next 설치 확인됨 — 통과");

// Windows 경로 구분자 회귀 테스트 — base가 역슬래시로 들어와도 '/**' 허용목록이 동작해야 한다.
// (2026-07-17: 미정규화 base 때문에 '/**' 전면 무효 → 승인 폭주 + 워커 정지 → 잡 타임아웃 버그 수정)
import { configurePathMatcher, matchesAllowList } from "../src/mcp/path-matcher.js";

let failed = 0;
function check(name: string, actual: boolean, expected: boolean): void {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (got ${actual}, want ${expected})`);
  if (!ok) failed++;
}

const target = "C:/mycrew/mycrew-program/src/agent.ts";

// 1) 역슬래시 base + '/**' → 매칭돼야 함 (버그 재현 케이스)
configurePathMatcher({ bases: ["C:\\mycrew\\mycrew-program"], projectsDir: "" });
check("역슬래시 base '/**'", matchesAllowList(target, ["/**"]), true);

// 2) basesOverride로 역슬래시가 직접 와도 매칭 (resolveReadAllowed 호출 경로)
check("역슬래시 basesOverride '/**'", matchesAllowList(target, ["/**"], ["C:\\mycrew\\mycrew-program"]), true);

// 3) 루트 디렉토리 자신도 '/**'에 매칭 (SafeGlob '.' 케이스)
check("루트 자신 '/**'", matchesAllowList("C:/mycrew/mycrew-program", ["/**"]), true);

// 4) 루트 밖은 여전히 거부 (보안 회귀 방지)
check("루트 밖 거부", matchesAllowList("C:/Windows/System32/cmd.exe", ["/**"]), false);

// 5) 구체 패턴도 역슬래시 base에서 동작
check("구체 패턴 src/**", matchesAllowList(target, ["/src/**"], ["C:\\mycrew\\mycrew-program"]), true);

// 6) 구체 패턴 미스는 거부 유지
check("구체 패턴 미스 거부", matchesAllowList("C:/mycrew/mycrew-program/history/x.md", ["/src/**"], ["C:\\mycrew\\mycrew-program"]), false);

if (failed > 0) { console.error(`\n${failed}건 실패`); process.exit(1); }
console.log("\n전체 통과");

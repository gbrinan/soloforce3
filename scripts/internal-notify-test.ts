// internal 응답 [NOTIFY] 마커 emit 분기 단위 테스트
// 대상: src/server/internal-reply-emit.ts decideInternalEmit / notifyOnlyFromEnv
import { decideInternalEmit, notifyOnlyFromEnv } from "../src/server/internal-reply-emit.js";

let pass = 0;
let fail = 0;

function check(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`[PASS] ${label}`);
  } else {
    fail++;
    console.log(`[FAIL] ${label} | got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`);
  }
}

// 1. internal=true + [NOTIFY] → emit, 마커 strip
check(
  "1. NOTIFY 마커 → emit + strip (🔔 아이콘 prefix)",
  decideInternalEmit("[NOTIFY] 데이브 작업 실패함", true, true),
  { emit: true, emitContent: "🔔 데이브 작업 실패함", warn: false },
);

// 2. internal=true + 마커 없음 + NOTIFY_ONLY=true → emit skip + warn
check(
  "2. internal + 마커 없음 + NOTIFY_ONLY=true → skip+warn",
  decideInternalEmit("무시", true, true),
  { emit: false, emitContent: "무시", warn: true },
);

// 3. internal=false → 항상 emit (NOTIFY 무관)
check(
  "3. user 메시지 (internal=false) → 항상 emit, 마커 무관",
  decideInternalEmit("안녕", false, true),
  { emit: true, emitContent: "안녕", warn: false },
);

// 4. internal=true + NOTIFY_ONLY=false (안전망) → emit
check(
  "4. NOTIFY_ONLY=false 안전망 → emit (옛 동작)",
  decideInternalEmit("무시", true, false),
  { emit: true, emitContent: "무시", warn: false },
);

// 5. case insensitive: [notify], [Notify]
check(
  "5-1. 소문자 [notify] → emit + strip (🔔 아이콘 prefix)",
  decideInternalEmit("[notify] 작업 완료", true, true),
  { emit: true, emitContent: "🔔 작업 완료", warn: false },
);
check(
  "5-2. 혼합 [Notify] → emit + strip (🔔 아이콘 prefix)",
  decideInternalEmit("[Notify] X", true, true),
  { emit: true, emitContent: "🔔 X", warn: false },
);

// 6. 마커 뒤 공백/줄바꿈 처리
check(
  "6-1. 마커 뒤 공백 다중 (🔔 아이콘 prefix)",
  decideInternalEmit("[NOTIFY]   여러 공백", true, true),
  { emit: true, emitContent: "🔔 여러 공백", warn: false },
);
check(
  "6-2. 마커 뒤 줄바꿈 (🔔 아이콘 prefix)",
  decideInternalEmit("[NOTIFY]\n다음 줄", true, true),
  { emit: true, emitContent: "🔔 다음 줄", warn: false },
);

// 7. 마커가 첫 줄 아닌 중간에 있으면 → 마커 인식 X (skip)
check(
  "7. 마커가 본문 중간 → 인식 안 함, skip",
  decideInternalEmit("앞부분 [NOTIFY] 뒷부분", true, true),
  { emit: false, emitContent: "앞부분 [NOTIFY] 뒷부분", warn: true },
);

// 8. 빈 마커 본문 (마커만)
check(
  "8. 마커만 → emit + 본문은 아이콘만 (🔔 )",
  decideInternalEmit("[NOTIFY]", true, true),
  { emit: true, emitContent: "🔔 ", warn: false },
);

// --- notifyOnlyFromEnv ---

check(
  "9-1. env 미설정 → default true",
  notifyOnlyFromEnv({}),
  true,
);
check(
  "9-2. env=true → true",
  notifyOnlyFromEnv({ INTERNAL_REPLY_NOTIFY_ONLY: "true" }),
  true,
);
check(
  "9-3. env=false → false",
  notifyOnlyFromEnv({ INTERNAL_REPLY_NOTIFY_ONLY: "false" }),
  false,
);
check(
  "9-4. env=다른 값 → false",
  notifyOnlyFromEnv({ INTERNAL_REPLY_NOTIFY_ONLY: "yes" }),
  false,
);

console.log(`\n=== ${pass}/${pass + fail} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);

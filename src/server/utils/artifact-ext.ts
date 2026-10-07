/**
 * 산출물 경로 확장자 — 정규식 절단 방지 공용 정의 (단일 소스)
 *
 * [재발 이력] 같은 결함이 두 번 났다. 세 번째를 막으려고 여기로 모았다.
 *   - 2026-08-08 qa-auto-judge.ts: messages-*.jsonl → *.js 절단 → 재제출 무한 루프
 *   - 2026-08-10 jobs.ts:2768   : seen.jsonl → seen.json, crew-post-*.json.posted → *.json 절단
 *                                 → QA 핸드오프·토스트·지니 보고에 유령 경로 노출
 *
 * [절단이 나는 3가지 기전 — 새 확장자를 추가할 때 전부 확인할 것]
 *   (1) 순서의존(first-match): alternation은 왼쪽부터 시도한다. 짧은 접두 확장자가
 *       앞에 있으면 그것만 잡고 멈춘다. → 접두 관계인 쌍은 반드시 긴 것을 앞에 둔다.
 *       현재 접두 관계 쌍: jsonl>json, mdx>md, tsx>ts, jsx>js, html>htm
 *   (2) 후행경계 부재: 확장자 뒤에 영숫자가 이어져도 매칭이 성립한다.
 *       → EXT_BOUNDARY의 (?![A-Za-z0-9])가 차단한다. (1)과 중복 방어이며 둘 다 유지한다.
 *   (3) 이중확장자 미보존: crew-post-*.json.posted 가 .json 에서 잘린다.
 *       → EXT_BOUNDARY의 (?:\.posted)? 가 흡수한다.
 *
 * [(?![A-Za-z0-9])를 쓰는 이유 — \b가 아니다]
 *   \b는 'foo.md' 뒤의 마침표에서도 경계로 성립해 프로즈 문장을 못 거른다는 문제와 별개로,
 *   'foo.mdx'의 'md' 뒤에서 경계가 성립하지 않아야 하는데 \b는 그 판정을 못 한다.
 *   (?![A-Za-z0-9])는 "더 긴 토큰의 접두부로 매칭되는 것"만 차단하고,
 *   문장 마침표 등 비영숫자 후행('산출물: report.md.' → 'report.md')은 정상 허용한다.
 */

/**
 * QA 산출물 검증기(qa-auto-judge.ts)용 확장자 집합.
 * 코드·문서 위주 — 2026-08-08 핫픽스 시점 값을 그대로 유지한다(동작 불변).
 */
export const ARTIFACT_EXT = "(?:jsonl|json|tsx|ts|jsx|js|yaml|yml|html|css|md|py|sh)";

/**
 * 잡 산출물 링크 추출(jobs.ts extractOutputFiles)용 확장자 집합.
 * ARTIFACT_EXT ∪ 문서/바이너리 산출물.
 *
 * 선정 근거 — 2026-08-10 ALLOW_PREFIXES 3개 디렉터리 전수 조사:
 *   history/outputs/     : md, json, jsonl(1), json.posted(26), txt, py(19), mjs/cjs/js(6)
 *   history/attachments/ : json, md, txt, csv, pdf, png, cjs/mjs/js, py, pl, awk
 *   agentTeam/           : (파일 없음)
 * 디스크에 없지만 유지하는 것: pptx·xlsx(file-utils.ts가 생성), jpg/gif/webp/mp4/webm(첨부 이미지·영상).
 *
 * 순서 주의: 위 (1)의 접두 관계 쌍이 지켜져 있다. 새 확장자는 아무 데나 넣지 말 것.
 */
export const OUTPUT_EXT =
  "(?:jsonl|json|pptx|xlsx|docx|pdf|csv|mdx|md|txt|yaml|yml|html|htm|css|svg|zip" +
  "|tsx|ts|jsx|mjs|cjs|js|py|sh|pl|awk|png|jpeg|jpg|gif|webp|webm|mp4)";

/** 확장자 뒤 경계 규약. 이중확장자(.posted) 보존 + 접두부 매칭 차단. */
export const EXT_BOUNDARY = "(?:\\.posted)?(?![A-Za-z0-9])";

/** 산출물로 인정하는 경로 접두 — 이 밖의 경로는 링크로 노출하지 않는다. */
export const OUTPUT_ALLOW_PREFIXES = ["history/outputs/", "history/attachments/", "agentTeam/"];

/**
 * 잡 로그 본문에서 산출물 경로를 찾는 전역 정규식.
 * 매 호출 새 인스턴스를 만든다 — /g 정규식은 lastIndex가 상태이므로 모듈 상수로 공유하면
 * 호출 간 탐색 시작 위치가 이월돼 매칭을 건너뛴다.
 */
export function buildOutputPathRegex(): RegExp {
  return new RegExp("(?:history|agentTeam)\\/[^\\s\"'<>]+\\." + OUTPUT_EXT + EXT_BOUNDARY, "g");
}

/**
 * 텍스트에서 산출물 경로를 추출한다(ALLOW_PREFIXES 밖은 제외, 확장자 온전 보존).
 * 순수 함수 — 회귀 테스트(scripts/output-path-ext-test.ts)가 직접 호출한다.
 */
export function extractOutputPathsFromText(text: string): string[] {
  const out: string[] = [];
  const matches = text.match(buildOutputPathRegex());
  if (!matches) return out;
  for (const m of matches) {
    if (OUTPUT_ALLOW_PREFIXES.some((p) => m.startsWith(p))) out.push(m);
  }
  return out;
}

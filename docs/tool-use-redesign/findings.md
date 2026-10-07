# Findings & Decisions

> **기술적 발견, 중요한 결정이 있을 때마다 이 파일을 즉시 업데이트하세요.**

## Requirements

- 정책을 프롬프트가 아니라 도구 스키마·서버 검증에 둔다.
- 기본 단일 에이전트, 개발·인제스트·QA처럼 컨텍스트가 다른 작업만 레인.
- paperthin 원칙이 코드 단위(스키마·검사 스크립트·테스트 기대값)에 들어간다 — 규칙 정본은 CLAUDE.md.
- 계획 파일은 File-based Planning 3파일 패턴(기존 `templates/`)을 따른다.

## Research Findings

### 라이브의 실체 (2026-10-07)

- 라이브 릴리스 `~/.local/share/soloforce2/current` = 커밋 `872d219` + 오버레이 패치 38개(`~/.config/soloforce2/patches`, MANIFEST의 upstream 전부 `pending`) + 기록 없던 직접 수정 5파일. GitHub `main`은 `390872c`에 머물러 커밋 11개도 없었다.
- 배포 스크립트는 패치가 역적용되면 «already present upstream»으로 건너뛴다. 따라서 패치를 upstream에 올려도 다음 배포가 깨지지 않는다.

### 역싱크 검증

브랜치에서 `git ls-tree -r HEAD`의 블롭 해시와, 라이브에서 `git ls-files -c -o --exclude-standard`로 나열한 실재 파일을 `git hash-object --stdin-paths`로 해시한 값을 경로별로 대조한다. 결과: 1,847개 전부 일치. 라이브에만 있는 2개는 런타임 표식(`.soloforce2-verified`)과 심볼릭 링크(`config/mail-scan-filters.json`)다.

### 비용 계량기

- 패치 80(2026-10-02, 라이브 첫 기록 04:47:17Z)이 «CLI total_cost_usd 세션 누적값» 결함을 이미 고쳤다. 그 이후 행은 정상이고, 부풀린 것은 그 이전 행이다.
- 남은 결함은 단가표였다. opus를 구세대 $15/$75로, sonnet-5를 $3/$15로, 캐시 생성을 5분 TTL(1.25배)로 계산했다.
- 외부 정답 대조: 비재개 cli 행에서 공시 단가 + 캐시 생성 1시간 TTL(2배) 가정의 추정/CLI 중앙값이 sonnet·haiku·opus 모두 1.000(5분 가정은 0.66~0.68).
- 라이브 원장 30일(2026-09-07~): 로그 합계 $1,462 중 의사결정용(measured + estimated) $190.32, legacy 1,341행 로그값 $1,272 → 토큰 재산정 $214.94, unpriced(codex QA) 104행.

### DelegateTask 계약

- genie.md는 `model`·`stages`·`stageAgents`를 가르치지만 MCP 스키마에는 없다. 2026-09-22~10-06 위임 59건 중 이 필드를 넘긴 건 0건 — 조용히 버려진 게 아니라 시도조차 안 된 죽은 지시다.

### Stage 1 데이터 (2026-10-08, 마스킹 사본 `D:/mycrew-labels/masked-history`)

- 잡 1,349건 중 사람이 직접 낸 요청 268건(`[`로 시작하는 시스템 지시 제외 — jev-decisions `load-jobs.ts` 규칙과 같음).
- 레인 유지 대상(dev-pm·qa·ingest·gpt-runner 등) 194건, 흡수 후보 74건. 흡수 후보 중 실시간 상태(메일·노션·일정·카톡·장부 등) 키워드가 없는 자기완결 요청 52건, 결과 본문이 있는 것 53건.
- 흡수 후보는 planner-researcher가 38건으로 쏠려 있다 — 표본에서 상한을 둔다.

### Stage 1 사전 등록 (실행 전 고정, 2026-10-08 아난 승인: 기준 30%, 파일럿 10건 먼저)

- 가설: 흡수 후보 페르소나에게 위임됐던 자기완결 요청을, 단일 에이전트가 같은 모델(sonnet-5)로 해당 역할 지시서를 스킬로 골라 써서 처리하면 사람 블라인드 평가에서 열등하지 않다.
- 비교: A = 과거 워커 결과(원장 기록), B = 단일 에이전트 재실행 결과. 카드마다 A/B 순서 무작위, 출처 비공개.
- 라벨: B가 낫다 / 비슷하다 / A가 낫다 / 둘 다 못 쓴다, 그리고 «실시간 데이터가 필요했던 요청인가» 표시.
- 판정: «A가 낫다»가 30% 이상이면 해당 영역은 레인 유지. 30% 미만이면 흡수 진행. 에이전트별로 5건 이상 모인 곳만 따로 판정.
- 알려진 편향: 입력이 마스킹 사본이라 B가 불리하다(A는 원문으로 만들어졌다). 이 편향은 현상 유지 쪽으로 기울므로, B가 기준을 넘으면 결론이 보수적으로 강해진다.

## Technical Decisions

| Decision | Rationale |
| --- | --- |
| 원장은 고치지 않고 읽을 때 등급을 붙인다 | append-only 원장의 소급 수정은 날조. legacy 로그값은 보존하고 재산정은 따로 낸다 |
| 테스트 기대값은 라이브 원장 cli 행 | 설계자가 정한 기대값은 검증자=설계자(mandela #5) |
| 모르는 claude 모델은 가장 비싼 단가 | 과소계상보다 과대계상이 안전(기존 원칙 유지) |
| 계획 파일은 기존 `templates/` 규약을 확장 | 새 위치를 만들면 규약이 둘이 된다(SSOT) |
| 검사 규칙 정본은 CLAUDE.md, 강제는 plan-check.cjs | 이 리포 CLAUDE.md가 «메커니즘은 여기에만»을 규정 |
| 구독제 실행은 `costMethod: "unpriced"` | `$0`을 무료로 세면 과소계상 |

## Issues Encountered

### 1. `npm test`가 새 체크아웃에서 중간에 멈춤

**문제**: `scripts/route-keyword-collision-test.ts`가 FAIL 23건으로 체인을 끊는다.

**원인**: 실 `history/agents.json`을 «라이브 로더»로 읽는데, history/는 gitignore라 새 체크아웃에 없다. 이번 변경과 무관(이 테스트가 읽는 파일을 건드리지 않음).

**해결**: 체인의 나머지 테스트를 개별 실행해 확인. 환경 의존 테스트 분리는 후속 과제.

**결과**: 미해결(후속)

### 2. 역싱크 중 `git reset --hard` 차단

**문제**: 새 워크트리를 라이브 커밋으로 옮기려던 `reset --hard`가 자동 모드에서 거부됨.

**해결**: 작업 트리가 깨끗할 때만 동작하는 `git switch -c cycle4/cost-ledger-live live/872d219`로 대체.

**결과**: 해결됨

### 3. `qa-artifact-base-test`가 통과 후 종료되지 않음

**문제**: 6건 모두 PASS를 출력한 뒤 프로세스가 끝나지 않아 `npm test` 체인이 멈춘다.

**원인**: import한 `qa-auto-judge`가 연 핸들이 남는다. 이 테스트는 기록 없던 라이브 직접 수정(2026-10-05)에서 들어왔다.

**해결**: 성공 경로 끝에 `process.exit(0)`.

**결과**: 해결됨(체인 끝까지 진행)

## Negative Corpus

- «비용 원장 전체가 망가졌다» — 처음 30일 집계로 내린 결론. 실제로는 10/02 이후는 정상이었고 결함은 과거 행과 단가표에 한정됐다. 측정 기간을 컷오프로 나눠 보지 않은 것이 원인.
- 재산정 단가로 sonnet-5 $3을 가정한 것 — 공시 단가는 $2. 기억한 단가를 쓰지 말고 공식 표와 CLI 실측으로 확인한다.
- `.re0/templates/`와 별도 문서로 새 계획 규약을 만들려던 시도 — 리포에 이미 같은 3파일 규약(`templates/`)이 있어 철회.
- 첫 sonnet fixture 1건만으로 단가를 검증한 것 — 입력·캐시 단가 오차가 서로 상쇄돼 틀린 표로도 통과했다. 출력 위주 행을 더해 판별력을 확보.

## Resources

### 문서

- [File-based Planning Workflow](https://github.com/ahastudio/til/blob/main/ai/file-based-planning-workflow.md)
- [paperthin](https://github.com/LilMGenius/paperthin) v0.17.7
- [Top 15 Agentic AI Trends to Watch in 2026](https://www.firecrawl.dev/blog/agentic-ai-trends)

### 코드 참조

- 단가 정본: `src/server/invocation-cost.ts`
- 원장 해석기: `src/server/cost-ledger.ts`
- 배포 패치 적용 루프: `~/.local/bin/soloforce2-update` (라이브 WSL)

## Learnings

### 측정 도구부터 검증한다 (2026-10-07)

원장 숫자로 결론을 내기 전에 원장 자체를 외부 정답(CLI 보고값)과 대조해야 한다. 이번 사이클에서 «비용 누수» 판단 두 건(9/24 73%, 10/07 genie 76%)이 모두 오염된 계기판 위에 서 있었다.

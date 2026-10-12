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

### Stage 1 표본 결과 (2026-10-08)

- 사전 등록 규칙(완료 잡·결과 200자 이상·같은 요청 중복 제거·깨진 인코딩 제외)을 모두 적용하면 후보는 **27건**뿐이다. 에이전트별 상한(40%)까지 적용하면 표본은 **21건**(planner-researcher 12). 사전 등록한 30건은 이 데이터로 채울 수 없다 — 규칙을 느슨하게 바꾸지 않고, 파일럿 뒤 새 라이브 기록을 마스킹해 보충할지 아난이 정한다.
- 표본 ID sha256 `0c802ea8aa7be856edb7dac8d205f1dbbe4624745283c716665e1dd5694a2adb` (seed 20261008), 같은 시드 재생성 일치.
- 파일럿은 따로 뽑지 않고 전체 표본의 앞 10건을 자른다. 상한이 n에 따라 달라 별도 추출은 앞부분과 어긋난다(`stage1-test.ts`가 고정).

### Stage 1 파일럿 결과 — 설계 결함 발견 (2026-10-08, 10건, 비용 $2.83)

- 10건 중 7건에서 B안이 «환경에 파일·도구가 없다»며 작업을 멈췄다(SafeRead 경로, 첨부 파일, history/ 폴더, curl 실행 요구). 품질 비교가 아니라 환경 접근 비교가 됐다.
- 근본 원인: 잡의 `request`는 아난이 한 말이 아니라 genie가 워커에게 쓴 위임 지시문이다. `[`로 시작하지 않는다는 이유로 «사람 요청»으로 분류됐지만, 실제로는 파일 경로·도구 이름·이전 잡 참조를 담은 내부 지시다. 키워드 기반 «자기완결» 필터로는 걸러지지 않는다.
- 결론: 이 카드로 라벨을 받으면 «A가 낫다»가 환경 탓으로 쌓여 판정이 오염된다(mandela #2 잘못된 귀무가설). 카드를 만들지 않고 실험 단위를 다시 정한다.
- 대안: 비교 단위를 «아난이 채팅에 쓴 원문 → 아난이 최종으로 받은 답»으로 바꾼다. A = genie + 위임 체계가 낸 최종 답, B = 같은 원문을 받은 단일 에이전트(역할 스킬 + 같은 데이터에 대한 읽기 전용 접근). 원문은 `history/human-chat/messages-*.jsonl`(29일치)에 있다.

### Stage 1 재설계 사전 등록 (채팅 단위, 실행 전 고정, 2026-10-08)

- 단위: 아난이 채팅에 쓴 원문(`history/conversations/*.md`의 «사용자» 블록) → 다음 사용자 메시지 전까지 받은 답(직접 답 + [REPORT]/[NOTIFY] 완료 보고, 최대 3시간). B는 같은 원문과 직전 대화 4턴, 원래 날짜를 받고, 라이브 history를 읽기 전용으로만 볼 수 있다.
- 제외: 행동·변경 요청(배포·발송·설정 변경 등), 답 구간에 레인 잡(dev-pm·qa·인제스트)이 실제로 생성된 메시지 — 하이브리드 설계에서 본체가 아니라 레인이 맡을 일이다.
- 표본: 사용자 메시지 375건 → 행동·변경 제외 202건 → 레인 잡 동반 제외 96건 → seed 20261008로 30건, sha256 `254e3a1dbd92b7935cecc1cb0ed81ddf03cd9ea675548fe7869dbf7286977576`. 파일럿은 앞 10건.
- 판정: 아난이 «실시간 데이터 필요»로 표시하지 않은 카드만 대상으로 «A가 낫다» 30% 이상이면 레인 유지(재실행 시점이 원래와 달라 그 시점 상태를 묻는 질문은 공정하게 비교할 수 없다). 표시된 카드는 따로 센다.

### Stage 4 착수 근거 — knowledge-work-plugins 분석 (2026-10-12)

anthropics/knowledge-work-plugins(`02ffa99`)는 외부 발송·지급 승인 계약(미리보기 블록, 한 번의 yes는 한 묶음, 반복은 동의가 아님, 승인은 만료)을 대부분 문장으로만 둔다. 같은 저장소에서 legal `signature-request`는 확인이 체크리스트 한 줄뿐이다. 문장 규칙은 스킬마다 지켜지는 정도가 갈린다는 증거로 보고, soloforce에서는 같은 계약을 서버 판정으로 옮긴다. 아난 결정(2026-10-13): «높음» 4건을 Stage 4부터, M1 승인 계약 먼저.

### Stage 4 M1 착수 전 실측 (2026-10-13)

- `SendToPartner`(`safefs-server.ts`)와 `[REPLY_TO_PARTNER]` 마커는 승인 없이 외부 파트너에게 보냈다.
- 서비스 정책의 approval 도구(gmail 발송 등)는 워커 잡 경로(`jobs.ts` `runWorkerAgent`) 한 곳에서만 막혔다. 지니 채팅 헤드리스·지니 PTY에는 적용되지 않았다.
- 헤드리스 `runAgent`는 할당된 registry MCP를 mode와 무관하게 `mcp__<서버>`로 전부 허용했다 — approval 모드 무시.
- PTY 훅이 가리키는 `scripts/mcp-approval-hook.mjs`가 리포 어디에도 없었다. 훅 명령이 실패하면 비차단 오류라 approval 모드 MCP 호출이 그대로 통과한다.
- 라이브 registry(`history/mcp-registry.json`)의 approval 모드 서버는 supabase(미할당)·hermes-agent(hermes 에이전트) 둘. notion은 allow 모드라 이번 변경의 영향을 받지 않는다.
- `bypassPermissions`(permLevel admin·workspace)에서는 허용 목록 밖 도구도 실행된다. 막으려면 금지 목록에 넣어야 한다(deny가 allow보다 우선).

### Stage 4 M2 착수 전 실측 (2026-10-13)

- `addGenieMessage`(chat.ts)는 내용과 무관하게 `[REPLY_TO_PARTNER]`·`[REPLY_TO_TELEGRAM]`·`[REPLY_TO_DISCORD]` 마커를 실행했다. 이 함수는 워커 결과 원문(jobs.ts 사용자 표시), 루프 결과 요약(on_success=full이면 산출물 본문), 메일 다이제스트도 싣는다 — 메일 본문에 마커 문자열을 넣으면 발송이 일어나는 경로였다.
- 지니 자신의 출력이 이 함수로 들어오는 곳은 PTY `post_message`(`/api/terminal/message`) 하나다. 헤드리스 채팅 응답은 `_sendMessageImpl`이 따로 마커를 처리한다.
- 워커 결과는 지니에게 경계 없이 «후속 조치 즉시 수행» 지시와 함께 전달됐다(`job-notify-gate.ts`).
- ~~루프 잡은 `taskTitle`이 `[루프 <id>] <step>`으로 시작한다~~ — 틀렸다(아래 Issues 6). 무인 실행 판별은 잡이 묶인 태스크의 `routineType === "instance"`로 한다.

### Stage 4 M3 착수 전 실측 (2026-10-13)

- `runMailScan`은 수집 실패·파싱 실패·분류 실패·이미 실행 중을 모두 `null`로 돌려주고, 자동 회차는 결과를 버렸다. 실패한 날은 «메일 없음»과 구별되지 않았다.
- 모델이 분류에서 스레드를 빠뜨리면 조용히 다이제스트에서 사라졌다(누락 건수 표시 없음).
- `relayDigest`는 예외만 없으면 `telegram: true`로 기록했는데, `sendTelegramNotice`는 토큰이 없거나 전부 실패해도 예외 없이 끝났다 — 전달 기록이 거짓이었다.
- 루프 요약은 실패 스텝을 «결과: 오류로 중단» 한 줄로만 보였다.

### Stage 4 M4 착수 전 실측 (2026-10-13)

- `DelegateTask`·`/api/delegate`에 모델·티어 필드가 없었다. 잡 모델은 `job.model ?? agentDef.model`이고 둘 다 없으면 `--model` 없이 CLI 기본.
- 루프 스텝 `model_tier`는 `setTaskModel`로 태스크에 저장만 되고 읽는 곳이 없었다. runner.ts 주석은 «DelegateTask 핸들러가 적용한다»고 했지만 그런 코드는 없었다.
- `modelForInternalSource`는 표에 없는 내부 source를 `undefined`(기본 모델 opus)로 돌려줬다 — 2026-09-24 비용 누수의 같은 꼴.
- 조사 보고의 «워커 잡 비용 로그에 source 없음»은 틀렸다 — `logCost(..., "worker:execute")` 등으로 이미 남는다.
- 레인 검사 결과: 리포 시드 32개 FAIL 0(모델 ID 직접 사용 WARN 31, bypass 권한 genie·qa·spf-comms WARN 3). 라이브 `history/agents.json` 26개 FAIL 0, WARN 26(전부 모델 ID). 시드에선 qa·spf-comms가 workspace인데 라이브 정의엔 권한 값이 없다 — meta.json은 agents.json에 없는 직원만 자동 등록하므로, 라이브는 시드와 별개로 움직인다.

## Technical Decisions

| Decision | Rationale |
| --- | --- |
| 외부 발송은 모델이 «요청»만 하고 서버가 보관한 내용을 사람 승인 뒤 그대로 보낸다 | 모델이 승인 뒤 내용을 다시 제출하지 않으므로 바꿔치기가 구조적으로 불가능. slack `send_message_draft`(사람이 보냄)와 같은 분리 |
| external 승인은 `decisionSource=user`만 허용, 거부는 누구나 | 지니 의견(부재중 즉시 적용)·반복 이력·자동 규칙은 사람의 승인이 아니다. 거부는 안전한 방향 |
| 판정 규칙은 순수 함수(`side-effect-gate.ts`), 집행은 `external-actions.ts` | 판정을 무거운 서버 모듈 없이 테스트하기 위해 |
| 정책 approval 도구: 헤드리스는 금지, 지니 PTY는 사람 전용 승인 카드(훅 `--external`) | PTY에서 금지하면 지니가 캘린더 일정도 못 만든다. 헤드리스는 승인할 사람이 없다 |
| 헤드리스 approval 모드 MCP는 `readTools`만, bypass·allowlist 꺼짐이면 서버 통째로 금지 | 아난 결정 «쓰기 도구만 막기». bypass에서는 목록 밖 도구가 실행되므로 도구 단위 허용이 불가능 |
| 승인 훅은 실패를 거부로 처리(닫힌 쪽) | 파일이 없던 동안 실패가 통과로 이어졌다 |
| 발송 마커는 기본 미처리, 지니 출력 경로만 `genieOutput: true`로 켠다 | 호출부 78곳 중 지니 출력은 한 곳. 기본을 닫아 두면 새 호출부가 생겨도 안전하다 |
| 외부 내용은 경계로 감싸고 안쪽 마커를 전각 `［`로 바꾼다 | 사람은 그대로 읽고, 기계는 마커로 인식하지 않는다. 끝 표식 위조 불가 |
| 무인 실행(루프·루틴) 발송은 승인 카드 없이 보류, 결과 요약에 표시 | 아난 승인 계획. 새벽 승인 카드에 졸면서 누르는 경로를 없앤다. 사람이 보고 다시 요청하면 그때 승인 카드 |
| 위임 모델: 호출자 tier > 태스크 고정 모델 > 에이전트 정의, 모르는 티어는 거부 | 모델 ID를 호출자가 직접 쓰지 못하게(«설정에는 티어 이름»). 무시하면 기본 모델로 새는 경로가 된다 |
| `job:report`는 표에 «기본 모델 유지»로 명시, 그 밖의 미등록 내부 source는 standard + 경고 | 아난 결정. job:report는 사장님이 그대로 읽는 문장이라 기존 의도 유지. frontier로 박지 않은 이유: genie-config 모델 선택을 덮어쓰게 된다 |
| 레인 검사: model 없음·없는 MCP 참조만 FAIL, 모델 ID·bypass 권한은 WARN | 시드 전체가 모델 ID를 쓴다. 지금 FAIL로 하면 게이트가 항상 빨갛게 되고 아무도 안 본다 |
| 결과 봉투는 `src/shared/`에 순수 모듈로 | 서버·스크립트·클라이언트가 같은 상태 어휘를 쓴다(SSOT) |
| 메일 스캔 실패는 사장님에게 알린다, 결과 없음은 조용히 | knowledge-work-plugins «absent is not zero»·«조용한 다이제스트가 성공». 실패를 침묵하면 결과 없음과 같아 보인다 |
| 메일 스캔에 의존성 주입(`runClaude`·`announce`) | 실패 경로를 실제 함수로 재현하기 위해. 기본값은 기존 동작 |
| 파트너 회신 마커(지니 내부 턴)는 보류가 아니라 승인 카드 | 파트너 문의 → 지니 초안 → 사장님 승인이 설계된 흐름. 보류하면 회신이 막힌다 |
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

### 4. 승인 훅이 Windows에서 0xC0000409로 죽음

**문제**: 승인 배선 테스트에서 훅 프로세스가 종료 코드 3221226505(0xC0000409)로 끝났다.

**원인**: fetch 소켓이 닫히는 중에 `process.exit(0)`을 호출했다.

**해결**: keep-alive 없는 `node:http` 요청으로 바꾸고 `process.exit`를 쓰지 않는다. 출력 후 자연 종료.

**결과**: 해결됨(배선 테스트에서 종료 코드 0 확인)

### 5. 승인 API 토큰을 지니가 읽을 수 있는지 미확인

**문제**: `/api/approvals/:id/resolve`는 `source`를 생략하면 사람(user) 결정으로 처리한다. 토큰 검사(`approval-auth.ts`)가 유일한 방어인데, 대시보드 토큰은 `history/.dashboard-approval-token`에 있다.

**원인**: 지니의 읽기 범위·SafeBash 루프백 curl 자동 승인과 결합하면 사람 승인을 흉내 낼 수 있는지 확인하지 않았다.

**해결**: 이번 범위 밖. 후속 과제로 기록.

**결과**: 미해결(후속)

### 6. M2 무인 실행 판별이 루프 잡에서 한 번도 맞지 않았음

**문제**: M2는 잡 `taskTitle`이 `[루프 …]`로 시작하면 무인 실행으로 봤다. M4를 위해 `/api/delegate`를 읽다가, 잡에는 `setJobTaskMeta(job.id, task.id, task.instruction)`로 **태스크 지시문(스텝 프롬프트 원문)**이 저장된다는 것을 확인했다. `[루프 …]` 제목은 요청 본문에만 있고 저장되지 않는다.

**원인**: runner.ts가 보내는 값만 보고, 서버가 실제로 저장하는 값을 확인하지 않았다. 통합 테스트도 `unattended: true`를 직접 넣어 판별 경로를 건너뛰었다.

**해결**: 판별을 «잡이 묶인 태스크가 루틴 인스턴스인가»(`isUnattendedTask`)로 바꿨다. 루프 스텝과 cron 루틴이 모두 `createRoutineInstance`를 쓴다. 통합 테스트에 실제 `tasks.ts`로 만든 인스턴스가 `/api/delegate`의 묶기 경로(`getOrCreateTaskForTurn`)로 판별되는지 추가.

**결과**: 해결됨(라이브 배포 전이라 실제 피해 없음)

## Negative Corpus

- 잡 `request`를 사람 요청으로 본 Stage 1 첫 설계 — 실제로는 genie의 위임 지시문이라 파일·도구 의존이 숨어 있었다. 파일럿 10건 중 7건이 환경 부재로 멈춤. 비교 단위는 «사람 원문 → 최종 답»이어야 한다.

- «비용 원장 전체가 망가졌다» — 처음 30일 집계로 내린 결론. 실제로는 10/02 이후는 정상이었고 결함은 과거 행과 단가표에 한정됐다. 측정 기간을 컷오프로 나눠 보지 않은 것이 원인.
- 재산정 단가로 sonnet-5 $3을 가정한 것 — 공시 단가는 $2. 기억한 단가를 쓰지 말고 공식 표와 CLI 실측으로 확인한다.
- `.re0/templates/`와 별도 문서로 새 계획 규약을 만들려던 시도 — 리포에 이미 같은 3파일 규약(`templates/`)이 있어 철회.
- 첫 sonnet fixture 1건만으로 단가를 검증한 것 — 입력·캐시 단가 오차가 서로 상쇄돼 틀린 표로도 통과했다. 출력 위주 행을 더해 판별력을 확보.
- 보내는 쪽 코드(runner.ts의 `taskTitle`)만 보고 저장되는 값을 가정한 M2 무인 판별 — 경계의 양쪽을 같이 읽어야 한다. 판별 함수에 값을 직접 넣는 테스트는 이 결함을 못 잡는다.
- python 문자열 치환으로 TS 소스를 고치다 `"\n"`이 실제 줄바꿈으로 들어가 컴파일이 깨졌다 — 이스케이프가 섞인 줄은 Edit 도구로 고친다.
- 정책 approval 도구를 지니 PTY 권한 조립(`buildPermissionArgs`)에 금지로 넣은 첫 M1 시도 — PTY가 지니의 주 경로라 캘린더 일정 생성까지 막힌다. 승인 카드로 바꿨다.

## Resources

### 문서

- [File-based Planning Workflow](https://github.com/ahastudio/til/blob/main/ai/file-based-planning-workflow.md)
- [paperthin](https://github.com/LilMGenius/paperthin) v0.17.7
- [Top 15 Agentic AI Trends to Watch in 2026](https://www.firecrawl.dev/blog/agentic-ai-trends)

### 코드 참조

- 단가 정본: `src/server/invocation-cost.ts`
- 원장 해석기: `src/server/cost-ledger.ts`
- 외부 발송 판정: `src/server/side-effect-gate.ts`, 집행: `src/server/external-actions.ts`
- 승인 훅: `scripts/mcp-approval-hook.mjs`
- 출처 표시: `src/server/provenance.ts`
- 결과 봉투: `src/shared/result-envelope.ts`
- 위임 모델 해석: `src/server/model-tiers.ts` `resolveDelegateModel`, 레인 검사: `scripts/lane-check.ts`
- [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) `02ffa99`
- 배포 패치 적용 루프: `~/.local/bin/soloforce2-update` (라이브 WSL)

## Learnings

### 측정 도구부터 검증한다 (2026-10-07)

원장 숫자로 결론을 내기 전에 원장 자체를 외부 정답(CLI 보고값)과 대조해야 한다. 이번 사이클에서 «비용 누수» 판단 두 건(9/24 73%, 10/07 genie 76%)이 모두 오염된 계기판 위에 서 있었다.

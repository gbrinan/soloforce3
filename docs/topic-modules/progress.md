# Progress Log

## Session 2026-10-13

### T1: 주제 설정 형식 ✅

**작업 내역**:

1. SPF 산출물 조사(라이브 읽기 전용)와 일정 조회 경로 확인.
2. 주제 설정 스키마(`src/shared/topic-config.ts`, zod strict) — 저장 위치(notion·leads-app), 입력(메일 질의·카톡 폴더), 루프별 켜기·일정·예산, 켠 루프에 필요한 값 교차 검사, history/ 밖 경로 거부. 예시·검사기·테스트.

### T2: 모듈 형식과 로더 ✅

**작업 내역**:

1. `src/server/modules/topic-render.ts`(순수): `{{topic.*}}` 값 표와 렌더, 없는 키는 missing.
2. `src/server/modules/registry.ts`: 모듈 선언(zod), 주제 설정 로드(파일 이름 = id), 켜진 템플릿 × 주제 → `<주제>-<템플릿>` 루프 원본, 일정·예산 덮어쓰기.
3. `loops/loader.ts`: 파일 루프 다음에 주제 루프 등록, 같은 id면 파일 우선. `LoopDefinition`에 `topic`·`module`.

### T3: 역할 에이전트 ✅

**작업 내역**:

1. 주제 설정에 `legacyAgents`(예전 id → 역할). `renderTopicContext` — 위임 요청 앞에 붙는 주제 맥락 블록(있는 값만).
2. `registry.ts`: `moduleAgentDirs`, `resolveTopicDelegation`(순수)·`resolveTopicDelegationLive`. 등록된 예전 id 우선, 역할인데 주제 없음 → 주제 하나면 자동·아니면 거부, 모르는 주제·충돌 거부.
3. `agent-registry.ts`: `modules/*/agents`도 meta.json 스캔·role-directive 시드(3순위), 캐시 무효화에 모듈 폴더 포함.
4. `routes.ts` handleDelegate·`/api/delegate`: `topic` 받기, 해석된 에이전트로 잡 생성, 맥락 블록을 요청 앞에.
5. `runner.ts`: 주제 루프 직접 위임 body에 `topic`, 지니 경유 스텝은 프롬프트로 안내. DelegateTask(`safefs-server.ts`)에 `topic`, dedup 키에 주제 포함.
6. `modules/topic-business`: 역할 4개(sales·comms·logistics·scout) meta.json + 범용 지시서. comms는 Bash를 `py`·`mv`·`mkdir` + `/history/topics/**`로 제한.
7. QA 외부 발신 목록에 topic-sales·comms·logistics.

**생성/수정 파일 (T3)**:

- `modules/topic-business/**`, `scripts/topic-roles-test.ts` (새로 생성)
- `src/shared/topic-config.ts`, `src/server/modules/{topic-render,registry}.ts`, `src/agent-registry.ts`, `src/server/routes.ts`, `src/server/loops/runner.ts`, `src/mcp/safefs-server.ts`, `src/server/qa-trigger-policy.ts`, `package.json` (수정)

**생성/수정 파일 (T2)**:

- `src/server/modules/topic-render.ts`, `src/server/modules/registry.ts`, `scripts/topic-modules-test.ts` (새로 생성)
- `src/server/loops/loader.ts`, `src/server/loops/types.ts`, `package.json` (수정)

**생성/수정 파일 (T1)**:

- `docs/topic-modules/`, `src/shared/topic-config.ts`, `config/topics/example.topic.yaml`, `scripts/topic-check.ts`, `scripts/topic-config-test.ts` (새로 생성)
- `package.json` (수정)

## Test Results

| Test | Input | Expected | Actual | Status |
| --- | --- | --- | --- | --- |

## Gate Evidence

| Gate | Result | Evidence | Date |
| --- | --- | --- | --- |
| T1-G1 | PASS | 12 passed, 0 failed (검사기 종료 코드 0·1·2 포함) | 2026-10-13 |
| T1-G2 | PASS | 예시 주제 export-trade, 켜진 루프 2개 — 종료 코드 0 | 2026-10-13 |
| T2-G1 | PASS | 8 passed, 0 failed (임시 설치에서 실제 loadLoops 통합 포함) | 2026-10-13 |
| T3-G1 | PASS | 12 passed, 0 failed (실제 레지스트리·history/topics 조합, 루프 fetch body 포함) | 2026-10-13 |

## Error Log

| Timestamp | Error | Attempt | Resolution |
| --- | --- | --- | --- |
| 2026-10-13 | routes.ts 치환에서 `\n`이 실제 줄바꿈으로 들어감 | 1 | Edit로 이스케이프 복구(동작은 같았음) — findings Negative Corpus |
| 2026-10-13 | T3-G1 첫 실행: comms 지시서에 `spf-` 스킬 이름 검출 | 1 | 내용이 범용인 기존 스킬 2개만 테스트 예외로 명시, 이름 변경은 T4 |

## 5-Question Reboot Check

| Question | Answer |
| --- | --- |
| 1. 현재 어느 단계인가? | T3 완료, T4 SPF 이전과 등가 검증 |
| 2. 다음에 할 일은? | 라이브 SPF 루프 5개를 템플릿으로, SPF 값을 주제 설정으로, 렌더 결과를 라이브 프롬프트와 대조 |
| 3. 목표는? | 주제 하나로 영업·소통·물류·정찰이 도는 모듈, SPF는 첫 예시 |
| 4. 지금까지 배운 것? | findings.md — 라이브가 리포보다 최신, 공개 리포에 Notion ID 존재 |
| 5. 완료한 작업은? | 조사, T1 주제 설정 형식, T2 모듈 로더, T3 역할 에이전트 |

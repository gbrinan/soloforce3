---
id: SPEC-AX-NESTED-PROJECTS-001
title: PROJECTS_DIR 2단계 중첩 프로젝트 계층 지원
status: Planned
priority: High
created: 2026-07-18
lifecycle: spec-anchored
lang: ko
---

# SPEC-AX-NESTED-PROJECTS-001 — 2단계 중첩 프로젝트 계층

## 1. 배경 (Environment)

My Crew는 `PROJECTS_DIR`(`C:\mycrew\mycrew-works`) 아래의 최상위 폴더 하나를 "프로젝트"로 취급한다.
에이전트(`claude.exe`)는 `${PROJECTS_DIR}/${projectName}`를 cwd로 스폰되고, safefs MCP·claude 신뢰 경로·
`.wiki/`·`outputs/` 규칙이 모두 이 단일 레벨을 전제로 동작한다.

프로그램(예: `ax`) 단위로 여러 하위 프로젝트(예: `australia-lng`)를 묶어 관리하려면 2단계 중첩
(`ax/australia-lng`)이 필요하다. 본 SPEC은 정확히 최대 깊이 2의 중첩 프로젝트를 안전하게 지원한다.

### 검증된 현재 구현 (탐색으로 확인, 라인 번호 재검증 완료)

| 위치 | 현재 동작 |
| --- | --- |
| `src/config.ts:22` | `PROJECTS_DIR = join(root, process.env.PROJECTS_FOLDER || "mycrew-works")` |
| `src/server/routes.ts:647-654` | `GET /api/projects` — 점(`.`)으로 시작하지 않는 최상위 디렉토리 이름만 필터링, **최상위 평면 문자열 배열**(`c.json(projects)`)을 반환 |
| `src/server/jobs.ts:1971-1977` | cwd 결정 로직. `overrideCwd > self > ${PROJECTS_DIR}/${projectName} > PROJECT_SELF_DIR`. **`path.join`이 아닌 템플릿 문자열 사용**, `..`/prefix 검사 없음 |
| `src/server/jobs.ts:1978` | `mkdirSync(cwd, { recursive: true })` — cwd 미존재 시 재귀 생성 |
| `src/server/jobs.ts:1562-1595` | `checkProjectWikiChange`·`loadProjectWiki` — `join(PROJECTS_DIR, projectName, ".wiki")` |
| `src/server/jobs.ts:2306-2308, 2430-2432` | post-validation cwd 재계산도 `${PROJECTS_DIR}/${job.projectName}` |
| `src/server/agent-pty.ts:153` | 스폰된 `claude.exe`에 `spec.cwd` 전달 |
| `src/mcp/path-matcher.ts:16-62` | `normSep`으로 `\`→`/` 정규화 후 매칭. 끝 `/**` 패턴은 디렉토리 자체 + 하위 매칭 |
| `src/mcp/safefs-server.ts:34,106` | `MCP_PROJECTS_DIR` 기반. 허용목록 패턴은 **CWD 상대**로 resolve — cwd가 중첩 폴더면 자연히 포함 |
| `src/claude-bootstrap.ts:51` | 신뢰 경로 = `[PROJECT_SELF_DIR, WORKSPACE_ROOT, PROJECTS_DIR]`. claude 신뢰는 상위 폴더 prefix 상속 |
| `src/server/routes.ts:1084-1093, 1347-1350` | 파일 브라우징(`/api/files`)은 프로젝트별 `outputs/`만 열거 |

### 탐색 중 발견한 원본 배경 정보와의 불일치 (Discrepancies)

1. **`GET /api/projects` 응답 형태**: 원본 배경은 "평면 목록"이라 했으나 실제로는 **최상위 JSON 배열**(`["proj-a","proj-b"]`), 객체가 아니다. 따라서 `names` 필드를 추가하는 방식은 파괴적 변경이 된다. 하위호환 전략을 이에 맞게 조정한다(요구사항 R2).
2. **클라이언트 소비자 부재**: 원본 배경은 "클라이언트 프로젝트 피커가 `GET /api/projects`를 소비한다"고 했으나, `src/client` 전체 grep 결과 **`/api/projects`를 호출하는 코드가 없다**. 클라이언트에서 `projectName`은 잡 데이터에 담겨 표시(`StaffPanel.tsx:288`)되거나 다운로드 URL(`App.tsx:651`, `JobResultModal.tsx:67`) 구성에만 쓰인다. 파일 패널은 `/api/files?base=projects`를 통해 프로젝트를 간접 열거한다. → 따라서 요구사항 R6(클라이언트 트리 피커)은 **기존 코드 수정이 아니라 신규 UI 추가**이며, 우선 `GET /api/projects` 소비 지점을 도입/식별해야 한다.
3. **라인 드리프트**: `GET /api/projects`는 646-653이 아닌 **647-654**, cwd 결정은 단일 라인(1976)이 아닌 **1971-1977 삼항식**, agent-pty cwd는 154가 아닌 **153**. 기능적 영향 없음.

## 2. 가정 (Assumptions)

- 중첩 깊이는 정확히 2단계로 한정한다(부모 프로그램 폴더 + 하위 프로젝트). 3단계 이상은 비목표.
- 부모 폴더 자체도 유효한 프로젝트로 선택 가능해야 한다(기존 단일 레벨과 하위호환).
- 모든 신규 경로 처리는 매칭 전에 **`\`→`/`로 정규화**한다(과거 Windows 경로 구분자 버그 재발 방지).
- `PROJECTS_DIR`이 claude 신뢰 목록·MCP CWD-상대 허용목록에 포함되어 있으므로 중첩 폴더는 상속으로 커버될 가능성이 높다(R5에서 실증 후 no-op 여부 문서화).

## 3. 요구사항 (Requirements — EARS)

### R1. 중첩 프로젝트 이름 검증 (Ubiquitous + Unwanted)

- **The system shall** treat a `projectName` as a relative path of **maximum depth 2** (`parent/child`), resolved under `PROJECTS_DIR`.
- **If** the input `projectName` contains `..`, an absolute path, or a drive prefix, **then the system shall** reject it before any filesystem access.
- **The system shall** normalize backslashes to forward slashes (`\` → `/`) on API input **before** validation and matching.
- **The system shall not** accept a normalized `projectName` whose segment count exceeds 2.

### R2. 프로젝트 트리 조회 (Event-Driven, 하위호환)

- **When** a client requests `GET /api/projects`, **the system shall** return a tree where each top-level entry carries an optional `children` array (하위 디렉토리, 단 점으로 시작하는 폴더·`outputs`·`backup-*` 제외).
- **The system shall** preserve backward compatibility given the current response is a **bare string array**: 기존 소비자가 없으므로(불일치 #2) 파괴 위험은 낮으나, 안전을 위해 응답을 객체 `{ names: string[], tree: TreeEntry[] }` 형태로 확장하되 최상위 이름 배열도 `names`로 함께 노출한다. (대안: 쿼리 파라미터 `?tree=1`로 신규 형태를 opt-in — plan에서 최종 결정)

### R3. 중첩 cwd 해석 및 경로 이탈 차단 (Event-Driven + Unwanted)

- **When** a job specifies a nested `projectName`, **the system shall** resolve cwd to the nested folder using `path.join(PROJECTS_DIR, ...segments)` (템플릿 문자열 금지).
- **The system shall** verify the resolved cwd, after `resolve()`, still has `PROJECTS_DIR` as a path prefix; **if not, then the system shall** reject the job.
- **The system shall** apply the same nested resolution at all cwd computation sites (`jobs.ts:1971-1977`, post-validation `2306-2308`, `2430-2432`).

### R4. 하위 프로젝트 레벨 규칙 (State-Driven)

- **While** a job runs under a nested project, **the system shall** locate `.wiki/` and `outputs/` at the **sub-project** folder (`PROJECTS_DIR/parent/child/.wiki`, `.../outputs`), not the parent.

### R5. MCP 허용목록·신뢰 경로 커버리지 (Ubiquitous)

- **The system shall** ensure safefs MCP allowlist and claude-bootstrap trust paths cover nested folders.
- **Where** existing patterns are already recursive (CWD-상대 `/**` 매칭, `PROJECTS_DIR` prefix 신뢰 상속), **the system shall** document them as no-op and add a regression test rather than new code.

### R6. 클라이언트 2단계 트리 피커 (Optional / 신규)

- **Where** a project picker is present, **the system shall** display a 2-level tree: 부모 그룹 → 선택 가능한 하위 프로젝트, 그리고 부모 폴더 자체도 선택 가능.
- 불일치 #2에 따라 이는 **신규 소비자 도입**이다. 최소 구현: `GET /api/projects`의 `tree`를 소비하는 피커 컴포넌트 추가 후 잡 생성 흐름에 연결.

### R7. 비목표 (Unwanted / Out of Scope)

- **The system shall not** support depth > 2.
- **The system shall not** provide move/rename of projects via API.
- **The system shall not** auto-ingest corpus (별도 SPEC).

## 4. 인수 기준 (Acceptance Criteria — Given-When-Then)

### AC-R1 이름 검증
- Given `projectName = "ax/australia-lng"`, When 검증, Then 통과하고 2세그먼트로 파싱된다.
- Given `projectName = "ax\australia-lng"` (백슬래시), When 정규화, Then `"ax/australia-lng"`로 변환 후 통과.
- Given `projectName = "../secret"` 또는 `"C:/x"` 또는 `"a/b/c"`, When 검증, Then 400/거부.

### AC-R2 트리 조회
- Given `mycrew-works/ax/australia-lng`, `mycrew-works/ax/outputs`, `mycrew-works/solo`, When `GET /api/projects`, Then `ax`는 `children: ["australia-lng"]`(`outputs` 제외), `solo`는 children 없음/빈 배열.
- Given 신규 응답, When 기존 방식으로 이름만 필요, Then `names`에서 최상위 목록을 그대로 얻는다.
- Given 점으로 시작하는 폴더·`backup-*`, When 조회, Then children/최상위에서 제외.

### AC-R3 cwd 해석·이탈 차단
- Given nested job, When 스폰, Then cwd = `join(PROJECTS_DIR,"ax","australia-lng")`이고 미존재 시 재귀 생성.
- Given `projectName`이 정규화 후 `PROJECTS_DIR` 밖으로 resolve, When 잡 시작, Then 거부되고 스폰되지 않는다.

### AC-R4 하위 레벨 규칙
- Given nested job가 `.wiki/page.md` 저장, Then `PROJECTS_DIR/ax/australia-lng/.wiki/page.md`에 기록.
- Given `outputs/report.md` 산출, Then 하위 프로젝트 `outputs/`에 생성되고 `/api/files?base=projects`가 이를 열거(중첩 지원 확장 시).

### AC-R5 MCP·신뢰
- Given nested cwd, When 에이전트가 cwd 내 파일 읽기, Then 승인 폭주 없이 허용목록 통과(회귀 테스트).
- Given claude 신뢰, Then `PROJECTS_DIR` 신뢰가 중첩 폴더에 상속됨을 검증(no-op 문서화).

### AC-R6 클라이언트
- Given `tree` 응답, When 피커 렌더, Then 부모 그룹 + 하위 선택지 표시, 부모 자체 선택 가능.

## 5. 테스트 계획 (Test Plan)

### 단위 테스트 (경로 해석/검증)
- `normalizeProjectName`: `\`→`/`, 세그먼트 수, `..`/절대경로/드라이브 거부.
- `resolveProjectCwd`: `join` 결과 + `resolve` 후 `PROJECTS_DIR` prefix 검사(양성/음성 케이스, Windows `\` 입력 포함).
- `path-matcher`: 중첩 cwd 상대 `/**` 패턴이 하위 파일을 매칭하고 `\` 경로에서도 정상 동작(과거 버그 회귀).

### 통합 테스트
- `GET /api/projects`: 중첩 픽스처 트리 생성 → 응답의 `names`·`tree`·제외 규칙 검증.
- Job cwd: 평면 `projectName`(기존)·중첩 `projectName` 두 경로 모두 스폰 cwd 정확성 및 이탈 거부.
- `.wiki`/`outputs`: 중첩 잡의 저장·로드·열거 end-to-end.

## 6. 영향받는 파일 (Affected Files)

- `src/server/routes.ts` — `GET /api/projects` 트리화(647-654), `/api/files` 중첩 열거(1084-1093, 1347-1350) 옵션.
- `src/server/jobs.ts` — cwd 해석 3개 지점(1971-1977, 2306-2308, 2430-2432), `.wiki`/`outputs` 경로(1562-1595).
- `src/config.ts` — (검토) 중첩 관련 헬퍼 export 필요 시.
- 신규: 경로 정규화/검증 유틸(예: `src/server/project-path.ts`) + 단위 테스트.
- `src/mcp/path-matcher.ts` / `src/mcp/safefs-server.ts` — 대체로 no-op 예상, 회귀 테스트만.
- `src/claude-bootstrap.ts:51` — 신뢰 상속 확인(대체로 no-op).
- 클라이언트: 트리 피커 컴포넌트(신규) + 잡 생성 연결.

## 7. 리스크 (Risks)

- **Windows 경로 구분자 회귀**(최우선): 과거 `/**` 글롭이 `\` 경로에서 실패해 승인 폭주·잡 타임아웃 연쇄를 유발한 이력. 모든 신규 경로 처리에서 매칭 전 `normSep` 강제, `path.join` 사용, `\` 입력 회귀 테스트 필수.
- **기존 평면 `projectName` 하위호환**: 다수 기존 잡이 단일 레벨 이름을 가짐 — 검증·해석 로직이 1세그먼트 입력을 반드시 그대로 통과시켜야 함(음성 회귀 방지).
- **응답 형태 변경**: 현재 최상위 배열 → 객체 확장 시, 미래 소비자 혼동 방지 위해 `names` 병행 노출 또는 `?tree=1` opt-in로 완화.
- **경로 이탈**: 템플릿 문자열 잔존 지점 누락 시 traversal 위험 — 모든 cwd 계산 지점을 일괄 교체하고 prefix 검사 강제.

## 8. 추적성 (Traceability)

- R1 ↔ AC-R1 ↔ 단위(normalize/validate)
- R2 ↔ AC-R2 ↔ 통합(GET /api/projects)
- R3 ↔ AC-R3 ↔ 단위(resolveCwd) + 통합(job cwd)
- R4 ↔ AC-R4 ↔ 통합(.wiki/outputs)
- R5 ↔ AC-R5 ↔ 회귀(path-matcher/trust)
- R6 ↔ AC-R6 ↔ 클라이언트 피커

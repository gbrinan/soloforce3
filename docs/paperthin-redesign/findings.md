# Findings & Decisions

> **기술적 발견, 중요한 결정이 있을 때마다 이 파일을 즉시 업데이트하세요.**

## Requirements

- paperthin 철학으로 soloforce 재설계
- 파일 기반 계획 워크플로우(ahastudio)로 계획·진행 관리
- PR은 `pr` 리모트(gbrinan/soloforce2)로 제출

## Research Findings

### paperthin 핵심 철학 (CLAUDE.md 정독)

- **Trust the artifact, not the author**: 만든 사람의 세션 내 판단은 최악의 심판. 스킬은 (1) 현재 진실로부터 재도출하거나 (2) 외부 시선(fresh sub-session)을 수입해 검증한다.
- **SSOT + 자기완결 스킬**: 사실은 한 곳에만 살고 나머지는 참조. 단, 스킬은 단독 설치·실행되므로 필요한 런타임 규칙은 인라인으로 품는다(두 원칙은 다른 레이어).
- **Restraint(절제)**: 개선할 게 없으면 아무것도 바꾸지 않는다. 적은 slop(노이즈·중복·패딩)이지 추가 자체가 아니다.
- **Recursive**: 스킬로 스킬을 유지보수한다. 모든 패스가 자기 도구로 감사받는다.
- **negatives-as-corpus**: "삭제"는 아카이브 이동. 실패한 가지는 훈련 데이터다.
- **Generic examples, not instances**: 영속 문서에는 실제 PR번호·SHA 대신 `(#123, @handle)` 류의 제네릭 예시만.

### 스킬 분류 체계: cardinality × time 4상한

| 폴더 | 역할 | 스킬 |
| --- | --- | --- |
| depth/ | 손에 든 것 하나를 정제·검증 | re0, readchk, aim, modelchk, hate, macrothink, feynman, autobahn, reorder, detool, dedash, debloat, shower, factchk, mandela, sip, re0-git, re0-release, re0-merge |
| breadth/ | 하나의 진실을 여러 파일·플랫폼에 걸쳐 정합 | ssotize, re0-upgrade |
| coil/ | 빌드 사이클 간 학습 전달 | re0-plan, re0-loop, re0-memo, re0-work, catchup, nba |
| mesh/ | 독립 시점들을 수렴 | prism |

### 스킬별 요점 (28개 라인 바이 라인 정독)

- **re0** (창립 스킬): 아티팩트를 "첫 깨끗한 v0"처럼 재작성. changelog 흔적 제거, "무엇이 바뀌었나"→"지금 무엇이 참인가"로 변환. 개선 없으면 무변경.
- **readchk**: 작업 전 지시 이해 검증. 패러프레이즈로 재진술, 컨텍스트가 해소하면 침묵 통과, 진짜 갈림길만 1개씩 질문.
- **aim**: 데이터만 오고 요청이 얇을 때, 질문 대신 "의도 제안"을 해 사용자가 yes로 답하게.
- **modelchk**: 실행 전 비용 산정 — capability tier(fast/standard/frontier) × reasoning effort(glance/measured/thorough/exhaustive). 권고만, 라우팅 권한 없음.
- **hate** (user-invoked): 계획을 죽이려는 관점에서 공격, 단 하나의 root 반론 + 가장 싼 반증 실험(first nail)만 반환. 체크리스트 금지.
- **macrothink** (user-invoked): 세션 프레이밍 제거 후 2~5개 fresh read 팬아웃. divergence가 신호, convergence는 안심일 뿐 증명 아님.
- **feynman** (user-invoked): 방금 내린 결정을 격리된 비평자가 압박 — 본인 말로 설명 못 하면 갭으로 명명. rationale을 먼저 제공하지 않음.
- **autobahn**: 가드레일 인접 스코프를 carve해 안전한 나머지만 fresh subagent에 전달(carved prompt만, 원본 금지). descope ledger로 가시화. 회피가 아니라 제거.
- **reorder** (user-invoked): 나열 순서를 단일 원칙으로 재정렬. 이동만, 문구 변경 금지.
- **detool**: 영속 문서에서 우발적 스택 결합(벤더·모델·경로 명사)을 메커니즘으로 치환. provenance·runbook·도구가 주어인 주장은 구체성 유지. "mechanism, not euphemism".
- **dedash** (user-invoked): em-dash를 문법 역할별로 치환(콤마/콜론/마침표/재작성). 범위는 사용자 소유, 범위 확장 금지.
- **debloat** (user-invoked): 축적된 패딩·과잉 한정·융합 문장 압축. load-bearing 주장은 전부 보존.
- **shower**: zero-context sub-session이 콜드리드해 자립성 진단. 진단만, 수정은 본 세션.
- **factchk**: 현실 근거 주장을 외부 소스로 양방향 검증(황당한 게 사실일 수도, 자명한 게 거짓일 수도). 메타인지적 의심이 트리거.
- **mandela**: 검증(eval/metric/실험)의 leakage 감사 — 8패턴(암기, 잘못된 귀무가설, 공유 환각, 동어반복, 검증자=설계자, 공유 풀 편향, 프레임 주입, 요구 특성). 읽기 전용.
- **sip**: 산출물 완성 직후 자기 스킬들로 맛보기 — shower→factchk/mandela→ssotize→detool→re0 오케스트레이션. user-invoked 스킬은 절대 자동 호출 안 함.
- **re0-git** (user-invoked): 커밋 메시지를 commit-economy로 재작성(진짜 변경당 불릿 1개, diff가 증명하는 것 생략, 트리 불변, gpg 서명, HEAD만 날짜 갱신).
- **re0-release** (user-invoked): 배포 체크리스트 — kind not size 버전 판정(fix→patch, 새 능력→minor), 2단 확인(커밋 / 태그+푸시), 워크플로우 소유 단계 수동 실행 금지.
- **re0-merge** (user-invoked): 외부 기여 착륙 — 기본 거절(default-deny), authorship 보존, land/pr-<n> 브랜치, 승인은 수락 시점에, 크레딧 코멘트로 종료.
- **ssotize**: 흩어진 사실을 감사(읽기 전용)→승인→통합. 정본 지정, 사본은 참조로 치환, 모순은 인간 판단으로 분리.
- **re0-upgrade** (user-invoked): 설치본을 전체 카탈로그로 수렴. rename SSOT 표, shadow install 감지, 확인 게이트 후에만 변경.
- **re0-plan** (user-invoked): 사이클 개시 시 `.re0/iteration/<version>-<workname>/` 생성과 동시에 내용 기록(빈 폴더 금지). lightweight→RETRO 씨앗, full→DESIGN/WORKFLOW/EVIDENCE.
- **re0-loop**: FRAME→BUILD→DRIVE→RE0-MEMO→HATE→RE0-WORK→BUILD AGAIN 사이클. 진행 단위는 시간·기능이 아니라 품질 통과 템플릿·재사용 모듈·제거된 안티패턴 수.
- **re0-memo**: 사이클을 이식 가능한 교훈·안티패턴·게이트로 변환. 개별 불만을 패턴으로 일반화(specifics는 증거로만), changelog 금지.
- **re0-work**: v0 재시작 — 계약·스키마·게이트·어휘·real-surface 테스트·negative corpus만 보존, 우발적 아키텍처는 복사 금지. 수직 루프 1개부터.
- **catchup**: 공백 후 복귀한 인간의 컨텍스트 재구축. 상태 기반(기억 아님), 결정 순서 구성(Needs you→Changed→New words), 읽기 전용.
- **nba**: 정체된 사이클의 단일 최고 레버리지 다음 행동 반환. 메뉴 금지, 상태 근거 필수, 회피 중인 행동을 반환.
- **prism** (user-invoked): 2~5개 독립 렌즈(고유 실패 모드당 1개)로 분할, 수렴/발산과 발산을 해소할 단일 질문 반환. 평균화 금지.

### 횡단 규약 3종 (인라인 복제, CLAUDE.md가 지도)

- **edit-safety**: 타깃 존재 확인(MISS 보고), unicode-safe(PYTHONUTF8=1), 발생 위치별 치환(일괄 스윕 금지), 구조 이동은 스크립트로.
- **negatives-as-corpus**: 삭제 대신 아카이브.
- **commit-economy**: re0-git이 정본, re0-release가 인라인 복제.

### invocation 이분법

- 기본은 model-invoked. `disable-model-invocation: true`는 (1) 트리거가 인간의 의도적 행동(commit/push/publish)이거나 (2) 존재 자체가 에이전트를 편향시킬 때만(hate, feynman 등).
- user-invoked 스킬은 model-invoked를 부를 수 있으나 user-invoked끼리 자동 호출 금지(유일 예외 페어링: re0-plan↔re0-release).

### file-based-planning-workflow (ahastudio) 구조

- 기능 폴더당 6문서: README(개요) / spec(PRD, 기술 배제) / plan(구현 계획, Critical Files, Outside-In 아키텍처) / tasks(Phase별 체크박스, Current Phase 표시) / findings(발견·결정 즉시 기록) / progress(세션별 시간순 로그).
- Phase: 1 Requirements & Discovery → 2 Planning & Structure → 3 Implementation → 4 Testing.

## Resources

### 문서

- [paperthin](https://github.com/LilMGenius/paperthin)
- [file-based-planning-workflow](https://github.com/ahastudio/file-based-planning-workflow)
- [워크플로우 원문 설명](https://github.com/ahastudio/til/blob/main/ai/file-based-planning-workflow.md)

### 코드 참조

- 리모트: origin=gbrinan/test, pr=gbrinan/soloforce2
- 스크래치패드 클론: paperthin / fbpw / soloforce (세션 임시)

## Decisions

- 이 리포에 `templates/`(fbpw 템플릿 원본)와 `docs/<기능명>/` 구조를 채택한다.
- 첫 기능 폴더는 `docs/paperthin-redesign/`로, soloforce 재설계 계획을 여기서 관리한다.

## /hate 공격 결과 (fresh critic, 격리 실행)

- **root**: "문서 엔트로피가 병"이라는 가정 자체가 의심. soloforce는 라이브 배포본(mycrew-program, 3456)이 개발 트리와 다른 살아있는 시스템 — README 4종의 불일치는 '한 사실의 네 사본'이 아니라 '네 배포 현실에 대한 네 사실'일 수 있다. 이 경우 정본 지정은 화해를 거부한 현실들 중 하나를 편집적 독단으로 승자 선정하는 것. 콜드리드 기준도 "내적으로 일관된 문서"를 검증할 뿐 "실행 중 시스템과의 일치"는 못 잡는다(깨끗한 confabulation이 지저분한 진실보다 잘 통과).
- **first_nail**: 재작성 전 반나절 프로브 — 정본화 대상 사실 5개(포트, 진입점, 설치 명령, 라이브 체크아웃 위치, '현재' README)를 문서끼리가 아니라 **실행 중 시스템/라이브 리포와 대조**. 2개 이상이 repo-vs-world 불일치면 이 리포 안의 정본화는 픽션의 정본화이므로, out-of-scope였던 라이브/형제 리포 정합을 선행 단계로 재배열해야 한다.
- 반영: spec Open Questions에 "라이브 대조 프로브"를 승인 게이트 앞 필수 단계로 추가 예정.

## /ssotize 감사 (읽기 전용, 1차 — README 4종)

| 사실 | 발생 위치 | 종류 | 제안 조치 |
| --- | --- | --- | --- |
| Node 최소 버전 | README.md "18 이상" / README-DISTRIBUTION.md "20 LTS 이상" | **모순** | reconcile — package.json engines를 정본 후보로, 인간 확인 필요 |
| 프로젝트 디렉토리명 | README.md `cd teamLGS` / DIST `cd mycrew-system` / WINDOWS 로그 `/tmp/teamLGS.log` | **모순**(구명칭 잔재) | reconcile — 배포 채널별 실명 확인 후 통일 |
| 실행 명령 | `npm run start`(README·WIN) vs `npm start`(DIST·USER) | 표기 분기 | dedupe — 동작 동일하면 한 표기로 |
| build 단계 | DIST는 `npm run build` 필수 / README.md 설치 절차엔 없음 | **부분·누락** | reconcile — 실제 필요 여부 라이브 대조 |
| 포트 3456 | 4종 전부 + .env.example, 하드코딩 다수(WINDOWS 6곳) | 사본 산재 | reference — 정본 1곳(.env.example) + "기본 포트" 참조화 |
| ENV 키 표 | README.md 19행 / DIST 10행 | 부분 중복 | reference — 정본 1곳, 나머지는 링크 |
| 문서 역할 | 4종 모두 설치+실행+개요를 각자 서술 | 구조적 중복 | 역할 재정의(개요/사용자/Windows설치/소스배포) 후 사실은 정본 참조 |

- 판정: doc-vs-doc 모순 최소 4건 확정. 단 hate의 root대로, 정본 선정은 **first nail 프로브(라이브 대조) 이후**로 보류.

## 결정: 리포 기준 정본화 (2026-08-28, 사용자 확정)

- first nail의 라이브 대조 프로브는 **명시적 스코프 아웃**. 이 재설계의 진실 기준은 "이 리포가 스스로 주장하는 것"이며, 라이브/형제 리포 정합은 별도 사이클로 이월.
- 결과적으로 콜드리드 성공 기준의 의미도 좁아진다: "리포 내적 일관성" 검증이지 "운영 현실 일치" 검증이 아님 — spec에 한계로 명기.

## /ssotize 2차 — 정본 지정 및 변이 계획 (승인 대기)

리포 내부 근거로 확정한 ground truth:

| 사실 | 리포 근거 | 정본 판정 |
| --- | --- | --- |
| 프로젝트명 | package.json `"name": "my-crew"` | **my-crew** 정본. `teamLGS`(README.md, WINDOWS 로그 경로)·`mycrew-system`(DIST)은 구명칭/채널 잔재 |
| 실행 방식 | `"start": "tsx src/index.ts"` | 소스 직접 실행 — **개발 리포에서 build는 start의 전제조건 아님**. DIST의 build 필수 서술은 배포 채널 한정으로 재서술 |
| Node 최소 버전 | engines 필드 **부재** | 정본이 없다가 진짜 문제. **package.json engines 신설**을 정본 홈으로 제안 (값은 인간 결정: tsx 요구 18+ vs DIST 주장 20 LTS → 20 권고) |
| 포트 기본값 | .env.example + 코드 기본값 | **.env.example** 정본, README들은 "기본 포트(.env 참조)"로 참조화. WINDOWS의 하드코딩 6곳은 예시로서 유지 가능(설치 안내서=운영 문서, detool의 provenance 예외) |
| ENV 키 목록 | .env.example | **.env.example** 정본. README.md 19행 표는 삭제 대신 "주요 키 발췌 + .env.example 참조"로, DIST 10행 표는 링크로 |

변이 계획 (승인 후 Phase 3에서 soloforce 대상 실행):

1. package.json에 `engines.node` 신설 (값 인간 확정 필요)
2. README.md: `cd teamLGS` → 실제 클론 디렉토리 서술, Node 버전을 engines 참조로, ENV 표 축약+참조
3. README-DISTRIBUTION.md: build 단계에 "배포 실행 모드 한정" 조건 명시(또는 실제 dist 실행 스크립트 확인 후 재서술), 디렉토리명 정합
4. README-WINDOWS.md: `/tmp/teamLGS.log` 경로가 실제 스크립트 산출과 일치하는지 확인 후 정합(스크립트가 정본)
5. 4종 역할 재정의 헤더: 개요(README) / 사용자(USER) / Windows 설치(WINDOWS) / 소스 배포(DISTRIBUTION), 각 문서 첫머리에 역할 1줄 + 타 문서 링크
6. 모순 잔여분은 인간 결정 목록으로: Node 버전 값, DIST build 필요성의 실증

## Phase 3 실행 결과 (soloforce 사본, 브랜치 claude/paperthin-ssot-pass)

- 실행됨: engines.node ">=20" 신설 / README.md Node·디렉토리명(cd my-crew)·ENV 표 참조화 / DIST build "선택" 명시 + ENV 정본 참조 / 4종 역할 헤더+상호 링크. 5파일 +16/-5, 커밋 1개.
- 실행 보류(절제 판단): `/tmp/teamLGS.log` — setup 스크립트 4곳이 실제로 쓰는 경로라 문서-스크립트 정합 상태. 리네임은 동작 변경이므로 인간 결정 목록으로.
- 인간 결정 잔여: ① teamLGS 로그 경로 리네임 여부 ② DIST 채널의 zip 이름(mycrew-system) 유지 여부

## soloforce2 및 클라우드 세션 병합 요건

- gbrinan/soloforce2는 **빈 리포**(공개, 브랜치 0) — 재설계 결과의 새 홈. push가 최초 population이 된다.
- 사용자 요건: claude.ai 클라우드 세션(session_01TijNmt2X66NNJxQDKLrGAT)의 내용도 병합 가능해야 함. 로컬 인덱스·리모트 브랜치 어디에도 아직 없음 → 그 세션에서 브랜치를 push하거나 산출물을 내려받아야 병합 가능. 구조적 대비: fbpw 기능 폴더 단위(docs/<기능명>/)로 세션 산출물을 수용하고, soloforce2에는 브랜치→PR로 합류시키는 규약 채택.

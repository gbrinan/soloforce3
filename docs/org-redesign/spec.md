# Feature Specification: 직원 조직 재설계 (원칙·케이스 기반)

## Overview

C안(최소수정+체인 명문화) 위에, 운영 원칙 4개와 실사용 케이스 3개(a/b/c)를 조직 설계에 인코딩한다.

## 원칙 (mandatory)

- P1 **모델 교체 가능**: 모든 직원의 모델은 `config/agents/<id>/meta.json`의 `model` 필드가 정본이며, UI에서 직원별 변경 가능해야 한다. (현행: 필드 존재 ✅ / UI 변경 경로 검증 필요)
- P2 **에이전트·스킬 별도 형상관리**: 주요 직원과 스킬은 각자 GitHub repo로 관리하며, 표준 수립 절차를 따른다:
  1. file-based-planning-workflow 구조로 repo 세팅 (docs/<기능>/ spec→plan→tasks→findings→progress)
  2. paperthin 철학(clean v0·SSOT·절제·negatives-as-corpus) 기반으로 재작성 요청 → `/shower`(콜드리드) → `/hate`(공격) 검증
  3. Agent Skills 공식 문서 기준 검증 Hook: 스킬 저장/설치 시 "이 문서(platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) 기준으로 잠재 문제를 확인하라" 프롬프트 훅 실행 — name 64자·소문자·하이픈·예약어, description 비어있지 않음·1024자·트리거 조건 포함 여부를 기계 검증 + LLM 검증 이중으로.
- P3 **온보딩 명명·변경**: 최초 설치 시 사용자·비서·CTO·CSO·CQO 이름 입력(현행 ✅), 이후 변경 가능해야 한다.
- P4 **배포 모드 2종**: ① 로컬(mycrew 방식) ② 도메인 선택 배포(사용자 임의 입력 또는 soloforce.app) — 도메인 모드에서는 Google OAuth로 접근 통제(기반: src/server/auth-google.ts 존재, 도메인 모드 강제 게이트 필요).

## User Scenarios (mandatory)

### Case a: 이메일 → 일정 → 조건 추적 → 프로젝트 폴더

- Given: 이메일 수신 (apps/mail)
- When: Jarvis가 메일을 읽고 일정 관련이면 캘린더 빈 슬롯 확인 → 사용자에게 등록 여부 질문 → 승인 시 등록
- Then: 캘린더 항목이 anandara(확장 앱, 호스트 가산 로스터)로 연결되어 금액·조건이 추적되고, 담당 직원이 관련 프로젝트 폴더(readPaths)를 조회할 수 있다
- 호출 체인: **Jarvis(수신·판단·질문·등록) → book-keeper(금액·조건 장부 반영) → 해당 프로젝트 담당(폴더 조회)**. 신규 직원 불필요 — Jarvis에 mail·calendar 도구 권한, anandara는 확장 로스터로 연결.

### Case b: 링크 수집 지시 → 인제스트 → 로컬+노션

- Given: 사용자가 링크를 공유하며 "이 내용 기억하고 관련 수집하자"
- When: Jarvis가 지시를 저장하고 지식관리 체인에 라우팅
- Then: **ingest-crab**(인제스트·정리·로컬 코퍼스 적재, ssotize/re0 반사) → **corpus-keeper**(노션 등 공유 표면 반영) → 꺼내보기·공유 가능
- 관련 수집이 필요하면 Jarvis가 scout류(trend/repo/data-collector)를 병렬 소집하고 산출물을 같은 체인으로 흘린다. (이 체인은 C안에서 지시서에 명문화됨 ✅)

### Case c: Orchestrator + hermes 결합 모드

- Given: 반복·배치·셸 작업이 많은 세션
- When: 사용자가 결합 모드를 켜면
- Then: Jarvis가 hermes를 상주 보조(오퍼레이터 셸)로 붙여 위임하고, hermes는 2회 이상 반복된 워크플로를 스킬로 승격한다(P2 절차로 형상관리). 모드는 genie-config 플래그로 전환.

## 지휘·실행 체계 (개정)

```text
사용자(아난) ⇄ Jarvis[Opus5] ── (모드c) hermes 상주 보조
                │
    ┌───────────┼───────────────┬─────────────────┐
    ▼           ▼               ▼                 ▼
 아샬(CTO)    동국(CSO)      Mr세균(CQO)      운영팀 직속
 개발팀        기획팀          감사팀           fleet-status(관제)
 backend/     doc-writer/    ↑ 전 직원        book-keeper*(케이스a)
 frontend/    image-prompt/    검증 게이트
 tester/      deck-factory
 retrospective
    │
 리서치팀(수집·검증): ax-scout·repo-scout·trend-scout·data-collector·
                     ax-consultant·insight-researcher·gpt-runner(교차검증)
    │ 산출물 인계
    ▼
 지식관리팀(체인): Jarvis → ingest-crab(적재·paperthin반사) → corpus-keeper(반영·노션)
                  + mentor-advisor(코퍼스 소비자)
    │
 SPF팀(퍼널): spf-news-scout → spf-sales → spf-logistics (+spf-comms)
 경영지원팀: book-keeper(장부) · lead-keeper(리드보드)
```

## Out of Scope (이번 사이클)

- Google OAuth 도메인 게이트 구현(P4) — 별도 SPEC
- 스킬 검증 Hook 코드 구현 — 별도 SPEC (설계는 본 문서 P2)
- Jarvis mail·calendar 도구 권한 배선(케이스 a) — 별도 SPEC

## Success Criteria

1. 케이스 b가 지시서만으로 재현된다 (체인 명문화 확인)
2. 모든 직원 meta.json에 model 필드가 있고 팀 소속이 실제 역할과 일치한다
3. P2 절차 문서가 존재하고, 첫 적용 사례(스킬 1개) 검증을 통과한다

## Related Documents & 용어 (콜드리드 지적 반영)

선행 결정·근거: [../paperthin-redesign/findings.md](../paperthin-redesign/findings.md) — "C안"의 원문(재배열 4안 비교), 구조 리뷰, first nail 결과가 모두 여기 있다. "지시서"란 `config/agents/<id>/role-directive.md`를 말한다.

| 용어 | 뜻 |
| --- | --- |
| 직원 | AI 에이전트. 정의 = `config/agents/<id>/`의 meta.json+role-directive.md |
| Jarvis / genie | 오케스트레이터 직원(id: genie). 이름은 온보딩 입력값 — 아샬·동국·Mr세균도 마찬가지로 P3의 입력 이름이지 고정 캐릭터가 아님 |
| genie-config | 런타임 설정 파일 `history/genie-config.json` (gitignore, src/agents/genie.ts가 로드) |
| hermes | 오퍼레이터 셸 직원 — 텔레그램 지시 수행 + 반복 워크플로 스킬화 |
| ingest-crab / corpus-keeper | 지식관리팀 체인의 적재/반영 담당 (인계 규칙은 각 role-directive.md 말미) |
| anandara | 리포 밖 확장 앱(`../mycrew-works/anandara`) — app-registry가 호스트에 존재할 때만 로스터에 가산 |
| SPF | 고객사 계란(egg) 사업 도메인명 (팀 이름의 유래) |
| paperthin / ssotize / re0 / shower / hate | 아티팩트 위생 스킬 스위트(LilMGenius/paperthin v0.17.4)와 그 개별 스킬 — "반사"란 해당 스킬의 규칙을 지시서에 상시 습관으로 내장했다는 뜻 |
| mycrew | 이 시스템의 제품명(MyCrew). 리포=soloforce2, 패키지=my-crew |
| UI (P1) | 웹 대시보드(포트 3456)의 직원 설정 화면 |

Out of Scope 3건의 착수 포인터:
- OAuth 게이트: `src/server/auth-google.ts`(현행 로그인) + `src/server/index.ts`(미들웨어 장착 지점) + P4의 도메인 모드 판별은 `.env`의 도메인 설정 유무
- 스킬 검증 Hook: 실행 지점 = `src/server/routes/store-github-skills.ts`의 설치 직전(파싱 함수 `parseFrontmatter` 이후)
- mail·calendar 배선: `apps/mail`(수신함) + genie의 allowedTools(`config/agents-default.json`의 genie 항목)에 도구 추가, 폴더 조회는 meta.json `readPaths`

## 중복·이음새 점검 (콜드리드 + 내부 판단, 2026-08-31)

콜드 리뷰어가 지목한 중복 7건을 내부 맥락으로 재판정:

| 지목 | 콜드 제안 | 내부 판단 |
| --- | --- | --- |
| data-collector ↔ scout 4종 | 폐지·흡수 | **부분 수용**: 전문 스카우트가 없는 도메인의 범용 수집 전담으로 스코프 명문화. staged 리서치(insight-researcher)의 실행 손발 역할은 유지 |
| tester ↔ Mr세균(CQO) | 통합 | **기각, 경계 명문화**: tester=개발 중 테스트 작성·실행(팀 내부), Mr세균=최종 승인 게이트(팀 외부·전사). 이중 검증은 의도된 설계 |
| hermes ↔ Jarvis | 어댑터로 흡수 | **부분 수용**: 흡수 대신 운영팀 이동 + 케이스 c의 "결합 모드"로 공식화. 스킬화 임무는 hermes 고유가치라 유지 |
| ax-consultant ↔ ax-scout | 모호 | 경계 명문화: scout=수집만, consultant=수집물 통합·설계. 조사 요청 기본 라우팅=scout |
| fleet-status ↔ book-keeper "비용" | 모호 | SSOT 명문화: 장부 정본=book-keeper(쓰기), fleet-status=읽기 전용 요약 뷰 |
| spf-comms ↔ spf-sales | 뒷절반 부재 | 경계 명문화: sales=신규 퍼널(발굴~미팅), comms=기존 고객 대화(카톡), logistics=배송 |
| doc-writer ↔ 동국(CSO) | 모호 | 경계 명문화: 동국=기획 판단·우선순위(관리), doc-writer=집필 실무. "써줘"의 기본 라우팅=doc-writer |

라우팅 규칙 원칙: **모호한 요청의 기본 수신자를 직원마다 한 줄로 지정**하고(예: "조사"→도메인 스카우트, 없으면 data-collector), Jarvis 프롬프트에 이 표를 내장한다.

승인 대기 변이: ① hermes 팀 이동(리서치→운영) ② 위 경계 7줄을 각 role-directive.md에 1줄씩 추가 ③ Jarvis 라우팅 표 내장.

## 추가 설계 3건 (2026-08-31, 콜드리드 결함 수정본)

### D1. 인제스트 2레인

- 즉시 레인(Jarvis 도구 호출·바로 적재): **화이트리스트 방식** — 사용자가 채팅에 직접 건넨 단건 링크·텍스트만. **로컬 파일은 크기·건수 무관 전부 배치 레인**(민감 판정이 필요한 대상은 파일뿐이므로, "판정 필요 여부를 판정해야 하는" 순환이 생기지 않음).
- 즉시 적재분도 사후 검증 큐에 남겨 다음 ingest-crab 배치가 재정산한다 (즉시성의 대가를 무결성에서 지불하지 않음).
- 자동 후속 위임의 동작 계층: Jarvis는 상주 서버 프로세스이며 작업 완료 이벤트를 이미 수신한다(`src/server/jobs.ts` + `job-notify-gate.ts`). "ingest-crab 잡 완료 → corpus-keeper 후속 잡 생성" 규칙은 이 이벤트 경로에 얹는다 — 프롬프트 관례가 아니라 잡 체인.

### D2. 도메인 팩 포맷

- `<pack>/` = agents/ + loops/ + app/ + skills/ + manifest. 포맷은 **SPF의 현재 실물에서 역설계**한다(미래 추측으로 확정하지 않음 — 추측 포맷은 추출 시점에 재설계됨).
- 물리 분리는 둘째 고객 도메인 등장 시. **기밀 분리는 지금의 이득이 아니라 분리 시점에 실현되는 이득**임을 명시 — 지금 문서가 사는 이유는 "그때 갈아엎지 않기 위한 포맷 합의"다.
- 동적 스캔의 에이전트·루프 확장은 팩 SPEC의 구현 항목(본 문서 범위 아님).

### D3. 브라우저 도구층 + aside 패널

- 브라우저는 직원이 아니라 도구층: 직원별 `allowedTools` 선별 부여. 부여: scouts(헤드리스), tester·CQO(실표면 증거), Jarvis(단건 링크 확인).
- **관전 메커니즘(①)을 구체화**: 실시간 스트리밍이 아니라 **주기 스크린샷 캡처 → 기존 대시보드 WebSocket으로 push → aside 패널 표시**. 개입은 신규 발명 없이 **기존 승인 시스템 재사용** — 브라우저 도구가 민감 액션(제출·결제·전송 셀렉터/URL 분류) 직전에 승인 요청을 올리고 응답까지 블록. "결제·전송류" 판별은 승인 시스템의 기존 민감 작업 분류를 확장.
- 실브라우저 연동(③)은 별도 SPEC + 위험 검토 필수 항목으로 격리. 착수 순서 ②→①→③ 유지.

콜드리드 이력: 설계 초안 판정 minor-gaps/stands/needs-work → 순환 경계·이득 상충·관전 공백 3건 수정 후 본 절 확정.

## /hate 실행묶음 공격 + first nail A/B 결과 (2026-08-31)

- hate root: "검증이 문서 품질만 측정했고, 지시서가 런타임 행동을 실제로 지배하는지는 미검증 — 통제하지 않는 control plane 위에 지시서를 쌓는 중일 수 있다."
- first nail 실행: 동일 과제(30건 적재 완료 시점의 마지막 단계)를 인계 규칙 유/무 지시서로 격리 A/B.
  - WITH: corpus-keeper에게 요약·산출물 위치 전달을 명시 수행 (지시서 문구 그대로)
  - WITHOUT: 오케스트레이터 보고만, corpus-keeper 언급 0회
- **판정: root 기각** — 지시서 문구 변경이 행동을 정확히 가른다. 프롬프트 거버넌스는 (이 표본에서) 통제한다.
- 한계 정직 기록: N=1, 서면 시뮬레이션(실제 파일 작업 아님), 단일 지시서, 동일 모델 계열. hate가 옳게 남긴 부분 — 기계 게이트(postValidation) 확대는 여전히 가치 있음(모델 불성실·긴 세션 드리프트 대비). 고위험 지시서는 배포 전 이 A/B를 표준 검증으로 채택한다 (P2 절차에 4단계로 추가 후보).

## ingesttiger 교체 실증 결과 (2026-08-31)

- 지시서 개정: ingest-crab 적재 규약을 ingesttiger로 교체 (로컬 파일 코퍼스 정본, DB는 지시 시에만 병행하는 파생 인덱스, 격리·골든 세트 내장).
- A/B: 구규약 대조군은 "색인 파일 안 만듦·DB 적재 중심" 응답 — 규약 문구가 행동을 가름 재확인.
- T1~T3 실배치(_fresh 픽스처 63건, 산출물 독립 검증 완료): 정산 등식 성립(63=51+9+3, 2배치), md/=meta/=51쌍, 격리 13건 사유서, pii_positive=건너뜀·pii_negative=적재(과잉차단 없음), 부재 함정 문항 "없음" 정답 유지, 원본 무수정.
- T4: 이 세션의 opencrab 인스턴스 index_size=0 — DB 정본은 인스턴스·데이터 디렉토리에 종속되어 가시성이 붙는 곳에 따라 달라짐을 실측. 파일 정본 교체 논거를 지지.
- 남은 결정: opencrab 완전 제거 여부는 mycrew 라이브 인스턴스에서 T5(병행 적재 이득 실측) 후. 현 지시서는 이미 "지시 시에만 병행"으로 강등 완료.

## opencrab → ingesttiger 데이터 연결 완료 (2026-08-31)

- 마이그레이션 배치 실행: opencrab 인스턴스 2곳(test/test 353노드·767엣지·77소스, mycrew live 21·30·19)을 읽기 전용으로 추출, ingestiger 코퍼스에 graph/nodes.md(374)·graph/edges.md(797) 신설 + meta/ 원본 JSON 보존 + index.md 소스 96행 + 골든 1문항 추가. 정산: 발견=적재 전건, 실패 0. 원본 DB 4곳 봉인.
- 잔여: mcp-base.json의 LOCAL_DATA_DIR가 빈 인스턴스(C:/mycrew/opencrab-data)를 가리키는 불일치 — opencrab을 파생 인덱스로 쓸 경우에만 수정 의미 있음(T5 결정과 연동).

## Case d: Voice 모드 통합 (2026-08-31 검토·3탭 반영)

### 검증된 사실 (코드·테스트 근거)
- 음성 위임은 `/api/voice/chat`이 **`/api/chat`과 동일한 위임 경로를 공유** (voice.ts:197 주석 명시) — 즉 라우팅 표·인제스트 2레인·자동 후속 위임이 음성 입력에도 그대로 적용된다. 별도 배선 불필요 ✅.
- 파이프: 웨이크워드(VAD+짧은 STT) → STT(Groq→Gemini 폴백) → Jarvis 위임 → TTS(사이드카 7788). "방금 거 취소"는 지시로 보내지 않고 턴 중단(J-R) — 취소 전용 로컬 처리.
- 테스트 54/54 통과(문장분절 32 포함). 라이브 프로세스는 구버전이라 /api/voice 404 — pull+재시작 필요.

### 통합설계 판정
- **설계 정합**: 음성은 별도 직원이 아니라 Jarvis의 입출력 표면 — "브라우저=도구층" 판단과 동형. 케이스 a/b/c의 모든 흐름이 음성으로도 동작해야 하며, 경로 공유 덕에 구조적으로 성립.
- **갭 3건**: ① 음성 승인 — 민감 액션 승인 요청이 음성 UI에 어떻게 표면화되는지 미정(자비스뷰에 승인 칩 필요, D3 승인 게이트와 공용화) ② 음성 지표(위임·재작업의심·웨이크 오탐 카운터)가 anti-patterns 레이더의 입력 소스에 미연결 ③ TTS 사이드카 가동이 route-golden 라이브 검사 대상 밖(SUPERTONIC_URL 헬스 추가 후보).
- **UI**: 헤더 토글 2개 → **3탭 세그먼트(채팅·터미널·Voice)** 로 교체 구현(App.tsx). photos 모드는 별도 진입 유지.

## 직원 보이스 배정 정책 (2026-08-31 확정)

가용 프리셋 6종(M1·M2·M3·F1·F2·F5) + 커스텀 임포트. 29명 전원 고유 음색은 불가능하며 시도하면 식별을 해친다 — 목소리의 가치는 "누가 보고하는가"의 귀 식별이다.

| 계층 | 대상 | 배정 |
|---|---|---|
| 1 고유 | Jarvis(soloforce-E)·아샬(M3)·동국(M1)·Mr세균(F5) | 각자 다른 음색 |
| 2 팀 공유 | fleet-status(M2), SPF팀(F2 공유: logistics·sales) | filler 문구로 개체 구분 |
| 3 기본값 | 나머지 전원 | voice.json 미생성 (파일 수 = 드리프트 표면 — 절제) |

규칙: ① 음색 color는 팀 톤과 정합 ② 이름은 voice.json에 넣지 않는다(표시명 정본은 온보딩 — 계급1 드리프트 예방) ③ filler는 역할 지시서 '성격' 절과 일치.

## P4 도메인 반영 구현 (2026-08-31)

- 발견: Google SSO(계정 허용 목록·세션 파일 유지)는 이미 구현돼 있었음 — P4의 실제 갭은 "외부 도메인 설정 + SSO 미설정" 조합의 무경고 통과(fail-open, 계급 5 동류).
- 구현: 기동 시 domain-gate — TUNNEL_URL/NGROK_URL/SOLOFORCE_DOMAIN 설정 시 SSO 필수, 아니면 exit 78. 의도적 공개는 SOLOFORCE_ALLOW_PUBLIC_NOAUTH=1 명시로만. 로컬(외부 URL 없음)은 기존대로 개방.
- 실증: 4조합 로직 테스트 — 로컬 BOOT / 도메인+무SSO REFUSE / 도메인+SSO BOOT / 명시적 공개 BOOT.
- SOLOFORCE_DOMAIN 신설: 배포 도메인 선언 키 (soloforce.app 또는 임의 도메인).

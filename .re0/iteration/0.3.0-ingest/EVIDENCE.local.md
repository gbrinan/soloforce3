# 0.3.0 ingest — EVIDENCE

`DESIGN.local.md`의 게이트를 증명면으로 옮긴 것. **결과가 아니라 채워야 할 바(bar)입니다.**
각 항목은 DESIGN의 한 줄에서 나왔습니다.

## G0 NAIL — 박힘 (2026-07-27)

`npx kordoc@4.2.9` 로 두 파일 통과. `Loading Plan & Report`(병합 90%)와 `Operation Checklist`.

- [x] 병합 — `colspan`/`rowspan` **258건 보존**. 열이 밀리지 않는다
- [x] serial 날짜 — `46388` → `2027-01-01`. **잔존 serial 0건**
- [x] 부동소수 조항 — `9.1999999999999993` → **`9.2` 4건**
- [x] 셀 밀림 — 없음

**판정: 툴킷은 corpus 저장소 전용.** 함정 1~4를 kordoc이 전부 처리하므로 soloforce·ingest-crab
경로에 넣을 이유가 없다. WORKFLOW 3단계의 "soloforce 확장"은 삭제한다.

**단, 못이 새 함정 둘을 캐냈다** — kordoc 경로 고유의 것이라 `ingest-pitfalls.md` 11·12번으로
추가했다:
- Duration(시간 간격)을 1899년 날짜로 오해석 — 21건
- `#REF!` 오류값을 문자열로 통과 — 23건

## G0b OpenCrab 이식성 — 확인됨 (2026-07-27)

Windows 전용인지 확인하기 위해 이 Mac(Apple Silicon)에 실제 설치.

- [x] `git clone` + `uv sync` 성공 (Python 3.11+ 자동 확보)
- [x] `opencrab --help` — `serve`·`ingest`·`query`·`manifest` 전부 노출
- [x] `opencrab status` — Graph(SQLite)·Vector(ChromaDB)·Docs(JSON)·SQL(SQLite) **4개 전부 OK**
- [x] `STORAGE_MODE=local` 이면 **Docker 불필요**
- [x] `opencrab serve` stdio 기동

**판정**: OpenCrab은 순수 Python(pip/uv) 패키지이고 프리빌트 바이너리가 없다. macOS에서
그대로 돈다. **Windows 머신은 코드나 MCP 때문에 필요한 것이 아니다** — 남은 이유는
`history/` 데이터가 거기 있다는 것과 상시 가동뿐이다.

## G1 중복 제거 — 채워짐 (2026-07-29)

client-corpus `252aaaa`. 파서 중복 151줄 제거.

- [x] 세 `build.py`가 `_shared/xlsx.py`를 import한다. 각자 들고 있던 파서는 없다
- [x] **실측**: `rows()` 한 곳에 표식을 넣고 세 프로젝트를 돌렸다 —
  SK E&S 4개 산출물 · 스파크펫 6개 산출물이 함께 바뀌었고,
  유진투자증권은 `ERROR: 청약이력 헤더 불일치` 로 멈췄다(헤더도 그 파서를 통과하므로).
  **세 프로젝트가 전부 이 파서를 지난다는 증거다.** 표식을 되돌리자 전부 복귀했다
- [x] 깊이를 세지 않고 `_shared`를 위로 훑는다 — 내보낸 번들은 `clients/` 층이 없다.
  이 함정에 실제로 한 번 걸렸다(번들에서 `ModuleNotFoundError`)

## G2 함정이 코드로 발동 — 채워짐 (2026-07-29)

`_shared/test_xlsx.py` **30건 통과 · 0 실패**.

- [x] 함정 1 (self-closing 셀로 값이 밀림) — `cargo_checklist` 픽스처(빈 셀 115개).
  옛 정규식(`naive_cells()`)을 대조군으로 함께 돌려 **좌표가 어긋나는 것**을 보인다
- [x] 함정 2 (병합셀) — 병합 445칸을 앵커로 펼친다. 비율로 양식 0.69 vs 표 0.14를 가른다
- [x] 함정 3 (Excel serial 날짜) — `46183` → `2026-06-10`. `12`·`0`·`3622321.7`은 건드리지 않는다
- [x] 함정 4 (부동소수 식별자) — `9.1999999999999993` → `9.2`. 픽스처 잔재 22건 전부 짧아진다
- [x] 함정 5 (시트명 엔티티·NFC) · 함정 12 (`t="e"` 오류값) 도 함께 코드로
- [x] 픽스처 넷 전부 **실제로 물렸던 시트**에서 떴다. 출처표는 `fixtures/make_fixtures.py`

**단, 픽스처는 값이 치환돼 있다.** `_shared/`는 클라이언트를 가로지르는 자리라 고객사 셀
값을 두면 하드 룰을 깬다. 구조(빈 셀 위치·`mergeCell`·`t="e"`·일련번호·부동소수)는 원본
그대로 두고 사람이 읽는 값만 `TEXT_n`으로 바꿨다. 숫자와 오류 리터럴은 함정 그 자체라
치환하지 않았다.

**측정 하나를 고쳤다.** 병합 비율을 "덮인 칸/값 있는 칸"으로 재면 1을 넘는다(양식은 병합
블록 대부분이 빈칸이라 분자가 분모를 앞지른다). 판정에 쓸 수 없는 수라 "병합 안에 있는
값/전체 값"으로 바꿨다. 그래서 앞서 기록된 `Loading Plan` **0.9는 0.74**가 맞다.

## G3 회귀 없음 — 채워짐 (2026-07-29)

- [x] 이관 전 산출물 34개의 sha256을 떴다
- [x] 이관 후 **34개 전부 바이트 동일**하게 재생성된다
- [x] 유진 `check.py` 7/7 · 스파크펫 8/8 · **SK E&S 12/12 (신설)** 통과
- [x] 내보낸 번들에서도 재생성된다 — `export.sh`가 `_shared/xlsx.py`를 함께 넣도록 고쳤다.
  고치기 전에는 받는 쪽에서 `build.py`가 아예 돌지 않았다(이관이 만든 회귀. 잡았다)

이관 뒤 **의도한 산출물 변경 한 줄**: 적재보고 머리말의 병합 비율을 손으로 적은 `90%`에서
`merge_ratio()` 계산값 `74%`로. 손으로 적은 수가 다시 어긋나지 않도록 계산값으로 바꿨다.

## G4 실행 가능
- [ ] ingest-crab이 수직 루프를 한 바퀴 돈 기록이 있다
- [ ] 그 배치가 정산(발견=적재+실패+건너뜀)을 만족한다
- [ ] 역추적 3건의 원본 좌표가 보고에 남았다
- [ ] 읽지 못한 값이 `미상`으로 기록됐다 (공백도 추측도 아님)

## G4b 새 직원 실동작 — 기전 검증됨 (2026-07-29). 라이브 반영만 남음

격리 인스턴스(`MYCREW_HOME` 을 스크래치로 분리, 서버 전체가 아니라 레지스트리만 구동)에서 확인.

- [x] `corpus-keeper` 가 **자동 등재된다** — `history/agents.json` 손편집도 `POST /api/staff` 도
  필요 없었다. `config/agents/*/meta.json` 스캔이 잡아 준다(`agent-registry.ts:217`).
  워커 17명에 포함, `코퍼스키퍼 / 클라이언트 코퍼스 구축 담당 / 지식관리팀 / normal`
- [x] `check-directive-sync.cjs` 가 인식한다 → **`corpus-keeper 일치`**.
  wiki 사본 69줄, `{{NAME}}`·`{{GENIE}}` 치환 완료, **폴백 아님**
- [x] **재동기화가 실제로 발동한다** — 옛 사본(3줄)을 심으니 `반영대기` 로 잡히고, 재기동에서
  `[Registry] ingest-crab role-directive 재동기화` 로그와 함께 63줄로 교체됐다.
  옛 사본은 `.bak` 으로 남았다. **이 사이클이 고치려던 버그가 고쳐졌다는 실증이다**
- [x] 기존 코퍼스 프로젝트를 다시 만들어 같은 산출물이 나왔다 — 세 프로젝트 34개 바이트 동일(G3)
- [ ] **직원이 지시서를 읽고 그 경로를 스스로 밟았다** — 아직. 위 재생성은 이 세션이 돌린 것이다

### 이전 절차 예행 (2026-07-30)

윈도우에서 시간을 쓰지 않도록 `LIVE-MIGRATION.local.md` 의 절차를 맥에서 그대로 돌렸다.
옛 설치본 모양을 만들어(워커 9명 = 라이브 명단, `ingest-crab` 사본 25줄) 검증했다.

- [x] GitHub에서 fresh clone → `MYCREW_HOME` 을 외부 폴더로 지정 → 대조기가 그 폴더를 읽는다
- [x] 기동 전 `반영대기 1 · 사본없음 17` 로 정확히 잡힌다
- [x] 재기동 → `[Registry] ingest-crab role-directive 재동기화` → **일치 17 · 사본없음 1**(genie)
- [x] `ingest-crab` 25 → **63줄**, 옛 판본 `.bak` 보존
- [x] `corpus-keeper` **69줄 생성**, 자동 등재
- [x] **`history/agents.json` 무변경 (9명 그대로)** — 자동 등재는 메모리에서만 일어난다.
  옛 데이터를 건드리지 않으므로 되돌리기가 쉽다

절차는 `scripts/migrate-to-checkout.ps1` 로 굳혔다(사전 점검 포함, 실패 시 아무것도 만들지 않음).
**PowerShell 구문 자체는 검사하지 못했다** — 이 맥에 pwsh 가 없다.

### 라이브 반영이 막혀 있던 진짜 이유 (앞 판본의 진단이 틀렸다)

`git pull` 이 `fatal: not a git repository` 로 죽는다. 스토어 zip이 `.git` 을 제외하고
패키징하기 때문이다(`package-program.mjs:262`, :414에 유출 시 빌드 중단 검사). WORKFLOW가
"라이브는 git 체크아웃"이라고 **가정**했고 검증된 적이 없었다.

스토어 자가 업데이트도 답이 아니다 — `0.2.35` 패키지는 **2026-07-16** 빌드로,
재동기화 코드(`0fb90b9`, 07-25)와 `corpus-keeper` 씨앗(`f6627ea`, 07-27)보다 **앞선다.**
누르면 설치본이 master보다 오래된 트리로 덮인다.

`origin/master` 에는 씨앗이 있다(확인함). 서버는 `tsx src/index.ts` 로 **소스에서 바로 돈다** —
재패키징도 컴파일도 필요 없다. 파일만 닿으면 된다.

2026-07-29 라이브 상태: 워커 9명 + 지니(무아), 세션 13:27 시작 — 오늘도 쓰이는 실사용
인스턴스다. `corpus-keeper` 없음, `ingest-crab` 지시서는 26줄(저장소 씨앗 63줄).
**폴백은 박히지 않았다** — 순서를 어긴 것이 없다.

## 곁가지 — 정리하다 유실된 패치를 찾았다 (2026-07-30)

이 사이클의 게이트는 아니다. 양방향 push 준비로 저장소 잡동사니를 치우다 나온 것이고,
**이전 절차에 단계를 하나 늘리게 만들었으므로** 남긴다.

`.bak-*` 112개를 지우기 전에 전부 base 파일과 대조했다 — "저장소가 잃어버린 수정이 있나".
하나 나왔다.

- `src/server/routes.ts.bak-presence` — `/api/sso/issue-token` 의 로컬 단일 사용자 폴백
- `git log -S 'MYCREW_OWNER_EMAIL' -- src/server/routes.ts` → **0건.** 한 번도 커밋된 적 없다
- 없으면 SSO 비활성 모드에서 401이 나가고 **iframe 서브앱 19개가 전부 자기 로그인 화면으로 떨어진다**
  (`getCurrentSession` 은 SSO 가 꺼져 있으면 무조건 null — `auth-google.ts:217`)

`hate` 를 걸어 "무엇으로 대체할까"를 물었더니 **질문 자체가 틀렸다**는 결론이 나왔다.
그 라우트의 유일한 호출자는 `AppHostFrame`(iframe 앱 공용 호스트)이고, 앞선 판본의 주석이
`서브앱(아난다라 등) SSO 브릿지용` 이라 적어 오해를 샀다. 아난다라 동기화는 이 라우트를
거치지 않고 `anandara-sync.ts:46` 에서 토큰을 직접 발급한다.

**같은 못이 캔 것**: `anandara-sync.ts:48` 이 소유자 토큰을 URL 쿼리스트링에 실어 보낸다.
기본값이 루프백이라 노출은 제한적이지만, 라이브의 `ANANDARA_BASE_URL` 이 무엇인지는 확인 안 됐다.
**이번 결정과 무관하게 그대로 남아 있다.**

처리 (`7222426`): 폴백 복원 · 오해를 산 주석 교정 · `MYCREW_OWNER_EMAIL` 을 `.env.example` 에
문서화(변수는 남아 있는데 읽는 코드가 사라져도 아무도 몰랐던 이유) · 임시 `host-debug` 계측 제거.

**이전 절차에 미친 영향**: `LIVE-MIGRATION.local.md` 에 `0b` 단계를 넣었다.
fresh clone 은 커밋 안 된 소스 패치를 전부 지운다. `재이식` 주석 넷이 말해 온 것이 이것이었다.

## G5 문서 정합 — 채워짐 (2026-07-29)

- [x] `ingest-crab/role-directive.md` **63줄 그대로.** 이 사이클에서 한 줄도 늘리지 않았다
      (`corpus-keeper` 는 69줄이나 이번에 만든 새 지시서라 기준선이 없다)
- [x] 새 기전은 코드(`_shared/`)와 `config/guides/ingest-pitfalls.md` 에 있다.
      지시서에는 "변환 결과가 이상하면 `ingest-pitfalls.md`를 SafeRead" 트리거만 있다
- [x] `config/guides/index.md` 의 `ingest-pitfalls` 행을 10종 → 12종으로 고치고,
      **1~5·12는 `_shared/xlsx.py`가 코드로 잡으니 산문보다 그쪽이 먼저**라는 라우팅을 넣었다
- [x] `npm test` **exit 0** (15단계 전부 PASS)

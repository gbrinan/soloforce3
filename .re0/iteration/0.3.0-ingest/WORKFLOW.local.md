# 0.3.0 ingest — WORKFLOW

이 사이클의 구체적 단계. `DESIGN.local.md`를 먼저 읽으십시오.

## 0. 시작 전

1. `DESIGN.local.md` 의 **"계획을 한 번 죽였습니다"** 절을 읽는다. 순서가 왜 이런지가 거기 있다.
2. `config/guides/ingest-pitfalls.md` 를 읽는다. 이 사이클이 코드로 옮기려는 대상이다.
3. `config/agents/corpus-keeper/role-directive.md` 를 읽는다. 새 직원의 게이트가 무엇을
   요구하는지 — 툴킷은 그 게이트를 기계적으로 채울 수 있어야 한다.

## 1. NAIL — 박혔습니다 (2026-07-27)

**이 단계는 끝났습니다.** 결과는 `EVIDENCE.local.md` G0·G0b.

- kordoc이 함정 1~4를 전부 처리합니다 → **툴킷은 corpus 저장소 전용**
- 대신 kordoc 경로 고유의 새 함정 둘을 캐냈고 `ingest-pitfalls.md` 11·12번에 넣었습니다
- OpenCrab은 macOS에서 그대로 돕니다 → **Windows 의존은 코드가 아니라 데이터 위치뿐**

## 2. 새 직원 등재 — 기전은 검증됨 (2026-07-29). 남은 건 라이브에 코드를 올리는 것뿐

### 앞 판본이 틀렸던 두 곳

이 문서는 검증되지 않은 가정 둘을 담고 있었다. 격리 인스턴스에서 실제로 돌려 보고 고쳤다.

**틀림 1 — "등재는 수동이다".** 아니다. `config/agents/<id>/meta.json` 이 있으면 레지스트리가
스캔해서 **자동 등재한다** (`src/agent-registry.ts:217`). `POST /api/staff` 도
`history/agents.json` 편집도 필요 없다. 서버가 새 코드로 뜨기만 하면 된다.

**틀림 2 — "라이브에서 `git pull` 하면 된다".** 라이브가 git 체크아웃이라는 가정이 검증된 적
없다. 스토어 zip은 `.git` 을 **제외하고** 패키징한다(`scripts/package-program.mjs:262`,
그리고 :414에 `.git/` 이 섞이면 빌드를 중단시키는 검사까지 있다). 스토어 설치본에는
`.git` 이 없으므로 `git pull` 은 `fatal: not a git repository` 로 죽는다.

**스토어 업데이트도 답이 아니다.** `0.2.35` 패키지는 **2026-07-16** 빌드다.

| | 날짜 |
|---|---|
| 스토어 `0.2.35` | 2026-07-16 |
| 재동기화 코드 `0fb90b9` | 2026-07-25 |
| `corpus-keeper` 씨앗 `f6627ea` | 2026-07-27 |

`/api/update-status/apply` 는 둘 다 가져오지 못하고 설치본을 master보다 오래된 트리로 덮는다.
**쓰지 마라.**

### 검증된 것 (격리 인스턴스, `MYCREW_HOME` 으로 분리)

씨앗만 있는 상태에서 레지스트리를 구동해 전 구간을 확인했다.

1. `corpus-keeper` **자동 등재** — 워커 17명에 잡힘. 이름·직무·팀·권한 모두 `meta.json` 대로
2. wiki 사본이 **씨앗에서 생성** — 69줄, `{{NAME}}`·`{{GENIE}}` 치환 완료, 폴백 아님
3. `check-directive-sync.cjs` → `corpus-keeper 일치`
4. **재동기화가 실제로 발동한다** — 옛 사본(3줄)을 심으니 `반영대기` 로 잡히고,
   재기동하니 `[Registry] ingest-crab role-directive 재동기화` 로그와 함께 63줄로 교체되고
   옛 사본은 `.bak` 으로 남았다. 이 사이클이 고치려던 버그가 고쳐졌다는 실증이다

즉 **씨앗이 든 코드가 그 머신에 닿기만 하면 나머지는 자동이다.**

### 순서 (라이브 머신에서) — 전문은 `LIVE-MIGRATION.local.md`

여전히 유효한 위험 하나: 씨앗이 없는 상태에서 `POST /api/staff` 로 손등재하면 폴백이 박힌다.
라이브에는 재동기화 코드도 없어서 나중에 코드가 와도 안 고쳐진다. **손등재하지 마라.**
자동 등재를 쓰면 씨앗과 코드가 함께 도착하므로 이 위험 자체가 사라진다.

1. 설치 폴더가 git 저장소인지 먼저 확인: `git rev-parse --show-toplevel`
   - 저장소면 → `git pull origin master`
   - 아니면 → 그 폴더에 저장소를 새로 clone하고 `MYCREW_HOME` 을 기존 데이터 폴더로 가리킨다
     (`check-directive-sync.cjs` 와 `src/config.ts:15` 가 `MYCREW_HOME` 을 인식한다)
2. `npm install` → `npm test`
3. 서버 재시작 — 이때 `corpus-keeper` 가 자동 등재되고, 기존 직원들의 낡은 사본도 따라온다
4. `node scripts/check-directive-sync.cjs` → `corpus-keeper 일치` 확인.
   `구조가 다르면` 폴백이 박힌 것이다

**타임스탬프를 보존하는 복사(`robocopy` 기본값 · `cp -p`)로 옮기지 마라.** 재동기화는
`씨앗.mtime > 사본.mtime` 으로 발동한다(`agent-registry.ts:158`). 보존 복사는 조용히
발동하지 않고, 겉으로는 갱신된 척하면서 옛 지시서가 남는다. `git clone`/`git pull` 은
체크아웃 시각을 새로 찍으니 안전하다.

### 첫 일감

기존 코퍼스 프로젝트 하나를 **다시 만들어 보는 것**. 새로 만들지 말고, 같은 원본으로 같은
산출물이 나오는지로 지시서가 실제로 작동하는지 본다. 산출물 쪽은 이미 확인됐다 —
세 프로젝트 34개 파일 바이트 동일(G3). 남은 것은 **직원이 지시서를 읽고 그 경로를 스스로
밟는지**다.

## 3. 공용 추출 툴킷 — 끝났습니다 (2026-07-29)

client-corpus 에 있다. **push 완료.** 커밋 해시는 적지 않는다 — 다음 세션에 낡는다. `git log` 로 본다.

증거는 `EVIDENCE.local.md` G1·G2·G3. 요약:

- `_shared/xlsx.py` — 함정 1~5·12를 코드로. `col_index()` 가 `AA`를 `A`로 뭉개던 것도 함께
- `_shared/fixtures/` 넷 + `test_xlsx.py` **30건 통과**
- 세 `build.py` 이관 → **산출물 34개 바이트 동일**, 중복 151줄 제거
- SK E&S `check.py` 신설 12건. 유진 7 · 스파크펫 8 그대로 통과

이관이 만든 회귀 하나를 잡았다: `export.sh` 로 내보낸 번들에 `_shared/` 가 없어
받는 쪽에서 `build.py` 가 `ModuleNotFoundError` 로 죽었다. 번들에 파서를 함께 넣고,
`_shared` 를 깊이가 아니라 위로 훑어 찾도록 고쳤다(번들은 `clients/` 층이 없다).

`_shared/xlsx.py` 는 클라이언트에게 나가므로 **어느 고객사 자료에서 물렸는지 적지 않는다.**
그 기록은 내보내지 않는 `_shared/README.md` 와 `fixtures/make_fixtures.py` 에 있다.

**주의는 그대로 유효하다.** 파이썬 버전을 가정하지 마라 — 이 Mac의 시스템 python3는 3.9.6이라
`str | None` 이 안 된다. macOS 파일명은 NFD라 glob 리터럴이 안 맞는다.

## 4. 마무리

1. 각 프로젝트 `check.py` · `npm test` 통과 확인.
2. 커밋은 저장소별로. 두 저장소가 섞이지 않게.
3. `EVIDENCE.local.md` 의 게이트를 채운다 — nail 결과부터.
4. 라이브 반영이 필요하면 그 머신에서:
   `git pull` → `npm test` → 재시작 → `node scripts/check-directive-sync.cjs compare`

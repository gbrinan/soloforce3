# 0.3.0-ingest — 이어서 시작하기

이 파일을 새 세션 첫 메시지로 그대로 붙여넣어도 되고, 경로만 줘도 된다.
읽는 순서가 곧 행동 순서다.

## 지금 어디인가

**1단계 nail · 3단계 툴킷 끝. 2단계는 기전까지 검증됐고 라이브 반영만 남았다.**

여기(맥·저장소)에서 더 밀 수 있는 것이 없다. 남은 것은 전부 윈도우 머신을 기다린다.
**없는 증거를 만들지 마라.**

| 남은 것 | 무엇을 기다리나 |
|---|---|
| G4b 나머지 절반 — 직원이 지시서를 읽고 스스로 그 경로를 밟는지 | 라이브 반영 |
| G4 — ingest-crab 수직 루프 한 바퀴 | 라이브 반영 |

## 저장소

| | 경로 | 원격 |
|---|---|---|
| soloforce | 이 저장소 | `gbrinan/soloforce` (private, master) |
| client-corpus | `~/Downloads/corpus` | `gbrinan/client-corpus` (private, main) |

**커밋 해시를 이 문서에 적지 않는다.** 매 세션 낡기 때문이다. 지금 상태는 직접 본다:

```bash
git log --oneline -1 && git status -sb | head -1
```

client-corpus는 클라이언트 3곳 — 유진투자증권(증권사 벤치마킹·공모주), 스파크펫(AI 도입 컨설팅),
SK E&S(LNG 오퍼레이션). 루트 `INDEX.md`가 진입점이다.

**원본 파일은 저장소에 없다.** `sources.csv`가 sha256으로 고정하고, 재생성은
`CORPUS_SRC=/원본/폴더 python3 build.py`.

되돌림용 `backup-pre-email-fix` 브랜치가 양쪽에 남아 있다 — **윈도우가 clone한 뒤에 지운다.**

## 라이브 반영 — 유일하게 남은 사람 손

Windows `pro22-03-21-55` (테일넷). `https://pro22-03-21-55.tail7ff62f.ts.net/`

**`git pull` 이 안 된다.** 스토어 zip이 `.git` 을 제외하므로 설치본에 `.git` 이 없다.
스토어 자가 업데이트도 답이 아니다 — `0.2.35` 는 2026-07-16 빌드라 씨앗보다 앞선다.
서버는 `tsx src/index.ts` 로 소스에서 돌므로 **파일만 닿으면 된다.**

이전 절차는 `scripts/migrate-to-checkout.ps1` 한 줄로 굳혀 뒀고 맥에서 예행 검증했다.
근거와 손절차는 `LIVE-MIGRATION.local.md`.

등재는 **자동**이다 — `meta.json` 이 있으면 레지스트리가 스캔해서 잡는다
(`src/agent-registry.ts:217`). **손등재하지 마라** — 씨앗 없이 `POST /api/staff` 하면
폴백 지시서가 박히고, 라이브에 재동기화 코드가 없어서 나중에 코드가 와도 안 고쳐진다.
격리 인스턴스에서 자동 등재·씨앗 생성·재동기화까지 전부 확인했다(EVIDENCE G4b).

**타임스탬프를 보존하는 복사로 옮기지 마라** (`robocopy` 기본값 · `cp -p`).
재동기화는 `씨앗.mtime > 사본.mtime` 으로 발동한다(`agent-registry.ts:158`).
보존 복사는 조용히 발동하지 않고 겉으로만 갱신된 척한다. `git clone` 은 시각을 새로 찍는다.

반영 확인: `node scripts/check-directive-sync.cjs` → `corpus-keeper 일치`.
`사본없음` 이면 등재 실패, **구조가 다르면 폴백이 박힌 것**이다.

## 읽어야 할 문서

| 문서 | 왜 |
|---|---|
| `WORKFLOW.local.md` | 단계별 절차. 2단계가 현재 지점 |
| `EVIDENCE.local.md` | 무엇이 증명됐고 무엇이 안 됐는지 |
| `LIVE-MIGRATION.local.md` | 라이브 이전 근거와 손절차 |
| `config/guides/ingest-pitfalls.md` | 실전에서 물린 함정 12종, 증상 색인 |
| `config/agents/corpus-keeper/role-directive.md` | 새 직원. 게이트는 조인 성립·정산·역추적·재실행 결정성 |
| `config/agents/ingest-crab/role-directive.md` | 기존 직원. 게이트는 정산·역추적·미상 보존 |
| `client-corpus/INDEX.md` | 코퍼스 규약 — 정본·대체됨·UNMAPPED |

## 이미 있는 도구

- `scripts/check-directive-sync.cjs` — 씨앗↔wiki 사본 대조. `snapshot`/`compare`
- `scripts/migrate-to-checkout.ps1` — 라이브를 스토어 설치본에서 git 체크아웃으로
- `client-corpus/export.sh` — 클라이언트별 히스토리 없는 번들 내보내기
- `client-corpus/_shared/xlsx.py` — 함정 1~5·12를 코드로. 세 `build.py` 가 공유
- 각 코퍼스 프로젝트의 `check.py` — 품질 게이트 (유진 7 · 스파크펫 8 · SK E&S 12)

## 하지 말 것

- 원본 파일 수정·이동 — 읽기 전용
- 두 저장소를 한 커밋에 섞기
- 지시서에 함정 규칙을 산문으로 추가 — 그게 이 사이클이 반대하는 것
- 클라이언트를 가로지르는 산출물 만들기 — 나중에 저장소를 쪼갤 여지를 막는다
- 라이브에서 `git pull` 또는 스토어 자가 업데이트 — 둘 다 안 되는 이유가 위에 있다
- 씨앗 없이 손등재
- 커밋 해시를 문서에 적기 — 다음 세션에 낡는다

# 라이브를 스토어 설치본 → git 체크아웃으로

## 끝났다 — 다시 하지 마라

Windows `pro22-03-21-55` 는 **이미 git 체크아웃으로 이전됐다.** 실제 배치:

| 경로 | 정체 |
|---|---|
| `C:\mycrew\soloforce` | 설치본 = git 체크아웃. `git pull` 이 동작한다 |
| `C:\mycrew\mycrew-program` | `MYCREW_HOME` — `history/` 가 여기 있다 |
| `C:\mycrew\mycrew-works` | 작업 폴더. 형제 배치라 `WORKSPACE_ROOT` 가 `C:\mycrew` 로 잡혀 유지됐다 |

근거(라이브 API `/api/jobs` 에서 관측): 서버 자기 로그가
`pre-warm mail: spawning 'npm start' in C:\mycrew\soloforce\apps\mail` 을 찍고,
07-30 잡에서 직원이 `dir` 로 대조해 `history` 는 `mycrew-program` 밑이라고 확인했다.

**아래 절차를 다시 실행하면 안 된다.** 이미 된 것을 다시 하는 것이고, 돌아가는 설치본을
망가뜨릴 수 있다. 아래는 (a) 무슨 일이 있었는지의 기록, (b) 되돌릴 때의 참조,
(c) 다음 머신을 붙일 때의 절차다. 일상 운용은 맨 아래 "끝난 뒤 — 일상 규율"만 보면 된다.

실제로 이 문서를 잘못 읽어 "clone부터 하세요"라고 안내한 적이 있다(2026-07-31).
그래서 이 절이 맨 위에 있다.

---

## (기록·재사용) 스크립트로 하려면

아래 1~4단계를 사전 점검과 함께 묶어 둔 것이 있다. 실패하면 **아무것도 만들지 않고 멈춘다.**

```powershell
git clone https://github.com/gbrinan/soloforce.git C:\tmp\sf   # 스크립트만 꺼내려고
C:\tmp\sf\scripts\migrate-to-checkout.ps1 -OldInstall "C:\경로\MyCrew"
```

또는 옛 설치본에 이 파일 하나만 내려받아 실행해도 된다. 서버 기동은 스크립트가 하지 않는다 —
거기서 멈추고 다음 명령을 찍어 준다.

**맥에서 전 구간 예행 검증했다.** 옛 설치본 모양(워커 9명 + 낡은 `ingest-crab` 사본)을 만들고
GitHub에서 fresh clone → `MYCREW_HOME` 지정 → 재기동까지 그대로 돌려서,
`corpus-keeper 69줄 생성` · `ingest-crab 25→63줄 교체 + .bak` · `agents.json 무변경` 을 확인했다.
다만 **PowerShell 구문 자체는 검사하지 못했다**(맥에 pwsh 없음).

아래는 스크립트가 하는 일을 손으로 하는 절차이자 근거다.

## 왜 이걸 하는가

`git pull` 이 `fatal: not a git repository` 로 죽는다. 스토어 zip이 `.git` 을 제외하고
패키징하기 때문이다(`scripts/package-program.mjs:262`). 스토어 자가 업데이트도 답이 아니다 —
`0.2.35` 는 2026-07-16 빌드라 재동기화 코드(07-25)와 `corpus-keeper` 씨앗(07-27)보다 앞선다.

끝나면 `git pull` 이 **실제로 동작하는** 설치본이 되고, 이후 세대 차이는 pull 한 번으로 좁혀진다.

## 방식: 나란히 clone하고 데이터는 옛 폴더를 가리킨다

옛 설치본을 지우지 않는다. 그대로 두면 언제든 되돌릴 수 있다.

```
<부모>/
  MyCrew/          ← 옛 설치본. history/ · .env · .sso-secret 이 여기 있다 (그대로 둔다)
  soloforce/       ← 새 clone. 코드만
```

**형제로 clone하는 이유**: `WORKSPACE_ROOT` 가 미설정이면 **설치 폴더의 부모**로 잡힌다
(`src/config.ts:19`). 부모가 같아야 `mycrew-works` 경로가 그대로 유지된다. 다른 데 두려면
`WORKSPACE_ROOT` 를 명시해야 한다.

## 절차

### 0. 옛 인스턴스를 먼저 멈춘다

둘이 같은 `history/` 와 같은 포트(3456)를 쓴다. 동시에 띄우면 데이터가 엉킨다.

### 0b. **커밋된 적 없는 로컬 패치가 있는지 먼저 훑는다** — 이걸 건너뛰면 잃는다

저장소 정리 중에 실물이 하나 나왔다. `src/server/routes.ts.bak-presence` 에는
SSO 비활성 시 `MYCREW_OWNER_EMAIL` 로 소유자 토큰을 발급하는 폴백이 있는데,
**`git log -S 'MYCREW_OWNER_EMAIL' -- src/server/routes.ts` 가 0건이다** — 한 번도
커밋된 적이 없다. 작업 사본에만 살던 패치라는 뜻이다.

`재이식` 주석 넷이 말해 온 것이 이것이다. **이 머신의 소스에는 git에 없는 수정이 더 있을 수
있고, fresh clone 은 그것을 전부 지운다.** clone 전에 반드시 대조한다.

```powershell
# 옛 설치본에서 — 저장소와 실제로 무엇이 다른지
cd <clone한 임시 저장소>
git --no-index diff --stat . <옛설치본경로>\src 2>&1 | Select-String -NotMatch "node_modules"
```

또는 더 간단하게, 옛 설치본에서 로컬 패치 마커만 훑는다:

```powershell
Select-String -Path "<옛설치본>\src\**\*.ts" -Pattern "\[로컬 패치" | Select-Object Path,Line
```

나온 것을 저장소의 같은 파일과 대조해서, **저장소에 없는 것이 있으면 먼저 커밋하고 push한다.**
그러고 나서 clone한다. 순서를 바꾸면 되돌릴 방법이 없다.

`.env`·`.sso-secret` 과 달리 소스 패치는 스크립트가 자동으로 옮기지 못한다 —
무엇이 의도된 수정이고 무엇이 잔재인지는 사람만 안다.

### 1. clone

```powershell
cd <부모폴더>
git clone https://github.com/gbrinan/soloforce.git
cd soloforce
npm install
```

`npm install` 은 생략할 수 없다. `tsx` 진입점이 없으면 safefs MCP와 워커 PTY가 전부
조용히 실패한다(`src/config.ts:31`의 경고 참조).

### 2. 저장소에 없는 것 셋을 옛 폴더에서 가져온다

`.gitignore` 가 막는 것들이라 clone에 없다. **셋 다 설치 폴더 루트에서 읽는다 —
`MYCREW_HOME` 이 아니다.**

```powershell
copy ..\MyCrew\.env .env
copy ..\MyCrew\.sso-secret .sso-secret
```

| 파일 | 어디서 읽나 | 빠지면 |
|---|---|---|
| `.env` | `src/index.ts:7` — `<설치폴더>/.env` | API 키·어댑터 설정 전부 없음 |
| `.sso-secret` | `src/server/sso-token.ts:14` — `<설치폴더>/.sso-secret` | 새로 생성되어 **기존 로그인 세션이 끊긴다** |

`history/` 는 복사하지 않는다 — 다음 단계에서 옛 폴더를 가리킨다.

### 2b. 양방향 push 설정 — 이 머신도 저작 머신이 된다

이 이전의 목적 절반이 여기 있다. `재이식` 주석이 네 번 나온다(`config.ts:26`,
`routes.ts:98`·`149`·`4263`, `app-registry.ts.bak-full:497` — 2026-07-07·07-13·07-15·07-18).
전부 **이 머신에서만 필요한 수정이 스토어 업데이트마다 날아가서 손으로 다시 심은 것**이다.
push할 수 있으면 그 비용이 0이 된다.

```powershell
winget install GitHub.cli
gh auth login                       # 브라우저 인증. 자격증명은 Windows 자격 증명 관리자에

git config user.name  "Anan Kim"
git config user.email "gbrielkim@gmail.com"
git config pull.rebase true
git config rebase.autoStash true
```

`user.email` 은 **맥과 같아야 한다.** 다르면 같은 사람 커밋이 GitHub에서 둘로 갈린다.

`pull.rebase true` 가 핵심이다. 없으면 양쪽이 pull할 때마다 머지 커밋이 쌓여 히스토리가
그물이 된다. 이 저장소는 문서로 결정을 추적하므로 선형 히스토리가 실제 값어치가 있다.
`rebase.autoStash` 는 작업 중이던 변경을 rebase가 알아서 넣었다 빼 준다.

**브랜치를 나누지 마라.** 두 머신이 같은 코드를 돌리는 것이 목적인데 브랜치를 나누면
머지 시점이 생기고 `재이식` 문제가 형태만 바뀐다. 같은 `master` 를 쓴다.

역할은 자연히 갈린다 — 맥은 저작(문서·툴킷·지시서), 이 머신은 여기서만 드러나는 것
(경로·spawn·줄바꿈). 지금까지의 `재이식` 항목이 전부 후자다. 그래서 충돌은 드물다.

줄바꿈은 `.gitattributes`(`648b876`)가 이미 못 박아 뒀다. 저장소 안은 LF 고정,
`.cmd`/`.bat`/`.ps1` 만 CRLF다. **손으로 `core.autocrlf` 를 건드리지 마라** —
`.gitattributes` 가 이긴다.

### 3. `MYCREW_HOME` 을 옛 폴더로 두고 기동

```powershell
npm test
$env:MYCREW_HOME = "<부모폴더>\MyCrew"
npm start
```

`MYCREW_HOME` 은 `history/` 의 루트다(`src/config.ts:15`). 이걸 안 주면 새 clone 안에
빈 `history/` 를 만들고 **직원 9명의 기억이 전부 안 보인다.**

상시 가동이면 서비스/작업 스케줄러 등록에도 이 환경변수를 넣어야 한다.

### 4. 확인 — 여기서 세 가지가 한꺼번에 증명된다

```powershell
node scripts/check-directive-sync.cjs
```

기대:

- `corpus-keeper 일치` — **자동 등재됐고 폴백이 아니라 씨앗이 갔다는 뜻**.
  `meta.json` 이 있으면 레지스트리가 스캔해서 잡는다(`agent-registry.ts:217`).
  `POST /api/staff` 도 `agents.json` 편집도 하지 마라
- `ingest-crab 일치` — 기존 직원의 낡은 사본(26줄)이 63줄로 교체됐다.
  콘솔에 `[Registry] ingest-crab role-directive 재동기화 (이전본 → role-directive.md.bak)`
  가 찍힌다. 옛 사본은 `.bak` 으로 남으니 되돌릴 수 있다
- `사본없음` 이 남아 있으면 → 등재가 안 된 것
- `구조가 다르면` → 폴백이 박힌 것

전부 격리 인스턴스에서 미리 돌려 본 결과다. EVIDENCE G4b 참조.

### 5. 되돌리기

새 clone을 멈추고 옛 설치본을 다시 켜면 끝이다. 옛 폴더는 손대지 않았고, 지시서 사본도
`.bak` 이 남아 있다.

## 함정 하나

**타임스탬프를 보존하는 복사로 코드를 옮기지 마라** — `robocopy` 기본값, `xcopy /D`, `cp -p`.
재동기화는 `씨앗.mtime > 사본.mtime` 으로 발동한다(`agent-registry.ts:158`). 보존 복사는
조용히 발동하지 않고, 겉으로는 갱신된 척하면서 옛 지시서가 그대로 남는다.

`git clone` 은 체크아웃 시각을 새로 찍으니 안전하다. 위 절차를 그대로 따르면 걸리지 않는다.

## 끝난 뒤 — 일상 규율

**받을 때는 서버를 멈추고.** 돌아가는 프로세스 밑에서 파일을 갈아끼우는 것이라 그렇다.

**`&&` 를 쓰지 마라.** 이 머신은 Windows PowerShell 5.1이고 `&&` 는 PowerShell 7부터다.
5.1에서는 `'&&' 토큰은 이 버전에서 올바른 문 구분 기호가 아닙니다` 로 죽는다.
`;` 는 앞이 실패해도 다음이 돌기 때문에 대체가 아니다 — `$LASTEXITCODE` 로 막는다.

```powershell
# 서버 중지 →
git pull
if ($LASTEXITCODE -eq 0) { npm install }
if ($LASTEXITCODE -eq 0) { npm test }
# 재시작 → node scripts/check-directive-sync.cjs
```

**보낼 때도 pull 먼저.** `pull.rebase true` 라 머지 커밋이 안 생긴다.

```powershell
git add -A
git commit -m "..."
git pull
if ($LASTEXITCODE -eq 0) { git push }
```

`git pull` 이 rebase 충돌로 멈췄는데 그대로 push하면 남의 커밋을 덮는다. 그래서 여기만은
반드시 종료코드를 본다.

이 머신에서 고친 것이 다음 업데이트에 날아가지 않는다. `재이식` 은 이걸로 끝이다.

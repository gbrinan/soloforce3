# 스토어 설치본 → git 체크아웃 이전 (Windows 라이브 머신)
#
#   .\scripts\migrate-to-checkout.ps1 -OldInstall "C:\경로\MyCrew"
#
# 왜: 스토어 zip은 .git 을 제외하고 패키징하므로(package-program.mjs:262) 설치본에서
# git pull 이 성립하지 않는다. 스토어 자가 업데이트도 답이 아니다 — 0.2.35 패키지는
# 2026-07-16 빌드라 재동기화 코드(07-25)와 corpus-keeper 씨앗(07-27)보다 앞선다.
#
# 이 스크립트는 옛 설치본을 **건드리지 않는다.** 나란히 clone하고 데이터만 옛 폴더를
# 가리킨다. 실패하거나 마음이 바뀌면 옛 인스턴스를 다시 켜면 끝이다.
#
# 절차 전문과 근거: .re0/iteration/0.3.0-ingest/LIVE-MIGRATION.local.md
# 이 스크립트가 하는 일은 맥에서 전 구간 예행 검증했다 (EVIDENCE G4b).

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OldInstall,
  [string]$Repo = "https://github.com/gbrinan/soloforce.git",
  [string]$Name = "Anan Kim",
  [string]$Email = "gbrielkim@gmail.com",
  [switch]$SkipTest,
  [switch]$AcceptPatchLoss
)

$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   OK   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   주의 $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "`n중단: $m" -ForegroundColor Red; exit 1 }

# ── 사전 점검 — 실패하면 아무것도 만들지 않고 멈춘다 ────────────────────────
Step "사전 점검"

foreach ($c in @("git", "node", "npm")) {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Die "$c 를 찾을 수 없습니다." }
}
Ok "git · node · npm"

$OldInstall = (Resolve-Path $OldInstall).Path
if (-not (Test-Path (Join-Path $OldInstall "history"))) {
  Die "$OldInstall 에 history\ 가 없습니다. 설치 폴더가 맞습니까?"
}
$agentsJson = Join-Path $OldInstall "history\agents.json"
if (-not (Test-Path $agentsJson)) { Die "history\agents.json 이 없습니다." }
# 직원 수는 안내용일 뿐이다 — 못 세도 이전에는 아무 영향이 없다.
# PowerShell 5.1 의 ConvertFrom-Json 은 Node 가 문제없이 읽는 JSON 도 거부하는 경우가 있고
# (중복 키 등), -Raw 는 BOM 없는 UTF-8 을 ANSI 로 잘못 읽어 한글을 깨뜨린다.
# 실제로 이 파일을 읽는 것은 Node 이므로 판정도 Node 에 맡긴다.
$workers = "?"
try {
  $workers = (& node -e "process.stdout.write(String((require(process.argv[1]).agents||[]).length))" $agentsJson 2>$null)
  if (-not $workers) { $workers = "?" }
} catch { $workers = "?" }
if ($workers -eq "?") {
  Warn "옛 설치본 $OldInstall — 직원 수를 세지 못했습니다 (표시용이라 진행에 지장 없음)"
} else {
  Ok "옛 설치본 $OldInstall — 직원 $workers 명"
}

# .env 와 .sso-secret 은 MYCREW_HOME 이 아니라 **설치 폴더 루트**에서 읽는다
# (src/index.ts:7, src/server/sso-token.ts:14). clone 에 안 가져가면
# API 키가 빠지고 기존 로그인 세션이 끊긴다.
$carry = @()
foreach ($f in @(".env", ".sso-secret")) {
  $p = Join-Path $OldInstall $f
  if (Test-Path $p) { $carry += $f; Ok "$f 발견 — clone 으로 가져갑니다" }
  else { Warn "$f 없음 — 원래 없었다면 정상입니다" }
}
if ($carry -notcontains ".env") { Warn ".env 가 없으면 API 키·어댑터 설정이 비어 기동에 실패할 수 있습니다" }

# 옛 인스턴스가 아직 돌고 있으면 같은 history\ 와 포트 3456 을 두고 다툰다.
$busy = Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue
if ($busy) { Die "포트 3456 이 사용 중입니다. 옛 인스턴스를 먼저 멈추십시오." }
Ok "포트 3456 비어 있음"

# 커밋된 적 없는 로컬 패치 — fresh clone 이 지워 버린다. 실물이 하나 확인됐다
# (routes.ts 의 MYCREW_OWNER_EMAIL 폴백은 git 히스토리에 한 번도 없다).
# 자동으로 옮기지 않는다 — 무엇이 의도된 수정이고 무엇이 잔재인지는 사람만 안다.
$src = Join-Path $OldInstall "src"
if (Test-Path $src) {
  $patches = Select-String -Path "$src\*.ts","$src\**\*.ts" -Pattern "\[로컬 패치" -ErrorAction SilentlyContinue
  if ($patches) {
    Write-Host ""
    Warn "옛 설치본에 로컬 패치 표시가 $($patches.Count) 곳 있습니다:"
    $patches | Select-Object -First 12 | ForEach-Object {
      Write-Host ("        " + $_.Path.Replace($OldInstall, "…") + ":" + $_.LineNumber) -ForegroundColor Yellow
    }
    Write-Host @"

   이 중 저장소에 없는 것이 있으면 clone 뒤에 사라집니다.
   먼저 대조해서 저장소에 커밋·push한 다음 다시 실행하십시오.
   확인했고 그대로 진행하려면 -AcceptPatchLoss 를 붙이십시오.
"@ -ForegroundColor Yellow
    if (-not $AcceptPatchLoss) { Die "로컬 패치 확인이 끝나지 않았습니다." }
    Warn "-AcceptPatchLoss — 확인된 것으로 보고 계속합니다"
  } else {
    Ok "로컬 패치 표시 없음"
  }
} else {
  Warn "$src 가 없습니다 — 소스 대조를 건너뜁니다"
}

# WORKSPACE_ROOT 는 미설정 시 **설치 폴더의 부모**로 잡힌다(src/config.ts:19).
# 그래서 형제로 clone해야 mycrew-works 경로가 그대로 유지된다.
$parent = Split-Path $OldInstall -Parent
$dest = Join-Path $parent "soloforce"
if (Test-Path $dest) { Die "$dest 가 이미 있습니다. 지우거나 옮기고 다시 실행하십시오." }
Ok "clone 위치 $dest (옛 폴더와 형제 — WORKSPACE_ROOT 유지)"

# ── 1. clone ────────────────────────────────────────────────────────────────
Step "1. clone"
git clone $Repo $dest
if ($LASTEXITCODE -ne 0) { Die "clone 실패. 프라이빗 저장소입니다 — 먼저 'gh auth login' 하십시오." }
Push-Location $dest
Ok "clone 완료 — $(git log --oneline -1)"

# ── 2. 의존성 ───────────────────────────────────────────────────────────────
# 생략할 수 없다. tsx 진입점이 없으면 safefs MCP 와 워커 PTY 가 전부 조용히 실패한다
# (src/config.ts:31 의 치명 경고).
Step "2. npm install"
npm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Die "npm install 실패" }
Ok "의존성 설치"

# ── 3. 저장소에 없는 것 가져오기 ────────────────────────────────────────────
Step "3. .env · .sso-secret 이전"
foreach ($f in $carry) {
  Copy-Item (Join-Path $OldInstall $f) (Join-Path $dest $f) -Force
  Ok "$f 복사"
}

# ── 4. 양방향 push 설정 ─────────────────────────────────────────────────────
# 이 이전의 목적 절반. '재이식' 주석이 넷(07-07·07-13·07-15·07-18) — 전부 이 머신에서만
# 필요한 수정이 업데이트마다 날아가서 손으로 다시 심은 흔적이다.
Step "4. git 설정"
git config user.name  $Name
git config user.email $Email
git config pull.rebase true
git config rebase.autoStash true
Ok "신원 $Name <$Email> · pull.rebase · autoStash"
Warn "core.autocrlf 은 건드리지 마십시오 — .gitattributes 가 이깁니다"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Warn "GitHub CLI 없음. push 하려면: winget install GitHub.cli 후 gh auth login"
}

# ── 5. 테스트 ───────────────────────────────────────────────────────────────
if (-not $SkipTest) {
  Step "5. npm test"
  npm test
  if ($LASTEXITCODE -ne 0) { Pop-Location; Die "npm test 실패. 기동하지 마십시오." }
  Ok "테스트 통과"
}

# ── 6. 기동 전 상태 ─────────────────────────────────────────────────────────
Step "6. 기동 전 지시서 상태"
$env:MYCREW_HOME = $OldInstall
node scripts\check-directive-sync.cjs
Pop-Location

# ── 안내 ────────────────────────────────────────────────────────────────────
Write-Host @"

준비 끝. 옛 설치본은 그대로 있습니다.

다음:
  cd $dest
  `$env:MYCREW_HOME = "$OldInstall"
  npm start

MYCREW_HOME 을 빠뜨리면 clone 안에 빈 history\ 를 만들고
기존 직원들의 기억이 전부 안 보입니다. 상시 가동이면 서비스 등록에도 넣으십시오.

기동 후:
  node scripts\check-directive-sync.cjs

기대 (맥에서 예행 검증한 결과):
  corpus-keeper  일치   자동 등재 + 씨앗. POST /api/staff 하지 마십시오
  ingest-crab    일치   낡은 사본이 63줄로 교체. 옛 판본은 .bak 으로 남습니다
  콘솔에 [Registry] ingest-crab role-directive 재동기화 가 찍힙니다

  '구조가 다르면' 이 나오면 폴백이 박힌 것입니다 — 멈추고 알리십시오.

history\agents.json 은 수정되지 않습니다. 자동 등재는 메모리에서만 일어납니다.

되돌리기: 이 인스턴스를 멈추고 옛 설치본을 다시 켜면 끝입니다.
"@ -ForegroundColor White

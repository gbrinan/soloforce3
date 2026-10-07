<#
.SYNOPSIS
    My Crew - Windows 원터치 설치 스크립트
.DESCRIPTION
    WSL2 + Ubuntu를 자동 설치한 뒤 setup-linux.sh를 호출하여 my crew 서버를 부팅합니다.
    WSL2 신규 설치 시 재부팅이 필요하면 RunOnce 레지스트리에 본 스크립트를 등록하여
    재부팅 후 자동으로 이어집니다.
.PARAMETER Resumed
    재부팅 후 RunOnce가 호출할 때 자동으로 전달되는 플래그 (수동 지정 불필요).
.EXAMPLE
    우클릭 → "PowerShell로 실행" 또는 PowerShell에서:
    powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
#>
param([switch]$Resumed)

# 한글 출력 인코딩 (PowerShell 5.1 cp949 대비)
try {
    chcp 65001 > $null
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$ErrorActionPreference = 'Stop'

# ===== 블록 1: 자가-elevate =====
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "관리자 권한으로 다시 실행합니다 (UAC 프롬프트가 뜹니다)..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    if ($Resumed) {
        $argList = "-ExecutionPolicy Bypass -File `"$scriptPath`" -Resumed"
    } else {
        $argList = "-ExecutionPolicy Bypass -File `"$scriptPath`""
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit
}

# 스크립트 위치로 이동
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  My Crew - Windows 자동 설치" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ===== 블록 2: 사전 점검 =====
$buildNum = [Environment]::OSVersion.Version.Build
if ($buildNum -lt 19041) {
    Write-Host "[X] Windows 빌드 $buildNum — WSL2가 정상 동작하려면 19041 이상이 필요합니다." -ForegroundColor Red
    Write-Host "    Windows Update를 먼저 실행해주세요." -ForegroundColor Red
    Read-Host "Enter를 누르면 종료됩니다"
    exit 1
}

$wslExe = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wslExe) {
    Write-Host "[X] wsl.exe를 찾을 수 없습니다. Windows Update를 먼저 진행해주세요." -ForegroundColor Red
    Read-Host "Enter를 누르면 종료됩니다"
    exit 1
}

Write-Host "[OK] Windows 빌드 $buildNum / wsl.exe 감지" -ForegroundColor Green

# ===== 블록 3: WSL2 + Ubuntu 상태 검사 =====
function Test-WSLUbuntu {
    try {
        $raw = & wsl.exe -l -v 2>&1 | Out-String
        # wsl -l -v는 UTF-16 LE로 출력될 수 있어 NUL 문자 제거
        $output = $raw -replace "`0", ''
        $hasUbuntu = $output -match '(?im)Ubuntu'
        $version2  = $output -match '(?im)Ubuntu\S*\s+\S+\s+2'
        return ($hasUbuntu -and $version2)
    }
    catch {
        return $false
    }
}

$ubuntuReady = Test-WSLUbuntu
if ($ubuntuReady) {
    Write-Host "[OK] WSL2 + Ubuntu 감지" -ForegroundColor Green
} else {
    Write-Host "[!] WSL2 또는 Ubuntu가 설치되어 있지 않습니다." -ForegroundColor Yellow
}

# ===== 블록 4: WSL2 + Ubuntu 자동 설치 + RunOnce + 재부팅 =====
if (-not $ubuntuReady -and -not $Resumed) {
    Write-Host ""
    Write-Host "[설치] WSL2 + Ubuntu를 자동으로 설치합니다 (시간이 걸릴 수 있습니다)..." -ForegroundColor Cyan

    & wsl.exe --install -d Ubuntu --no-launch
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] wsl --install 실행 실패 (코드: $LASTEXITCODE)" -ForegroundColor Red
        Write-Host "    BIOS의 가상화 기능(Intel VT-x / AMD-V)이 활성화되어 있어야 합니다." -ForegroundColor Yellow
        Read-Host "Enter를 누르면 종료됩니다"
        exit 1
    }

    # RunOnce에 본 스크립트 재실행 등록 (재부팅 후 1회 자동 실행)
    $scriptPath = $MyInvocation.MyCommand.Path
    $runOnceKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
    $runOnceCmd = "powershell.exe -ExecutionPolicy Bypass -File `"$scriptPath`" -Resumed"
    if (-not (Test-Path $runOnceKey)) {
        New-Item -Path $runOnceKey -Force | Out-Null
    }
    New-ItemProperty -Path $runOnceKey -Name 'mycrew_setup_resume' -Value $runOnceCmd -PropertyType String -Force | Out-Null
    Write-Host "[OK] 재부팅 후 자동 이어가기 등록 완료 (RunOnce)" -ForegroundColor Green

    Write-Host ""
    Write-Host "─────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host "  재부팅이 필요합니다." -ForegroundColor Yellow
    Write-Host "  재부팅 후 이 스크립트가 자동으로 이어집니다." -ForegroundColor Yellow
    Write-Host "─────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host ""
    $reboot = Read-Host "지금 재부팅하시겠습니까? [Y/n]"
    if ($reboot -eq '' -or $reboot -match '^[Yy]') {
        Restart-Computer -Force
    } else {
        Write-Host "[!] 나중에 직접 재부팅해주세요. 로그인하면 설치가 자동 재개됩니다." -ForegroundColor Yellow
    }
    exit 0
}

# ===== 블록 5: 재부팅 후 재진입 =====
if ($Resumed) {
    # RunOnce는 OS가 자동 삭제하지만 방어적으로 한 번 더 제거
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' `
        -Name 'mycrew_setup_resume' -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "[재진입] 재부팅 후 이어가는 중..." -ForegroundColor Cyan

    # WSL/Ubuntu 재검사 (재부팅으로 인해 이제 활성화됐을 것)
    if (-not (Test-WSLUbuntu)) {
        Write-Host "[!] WSL2 + Ubuntu가 아직 준비되지 않았습니다. 잠시 기다린 후 다시 확인합니다..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
        if (-not (Test-WSLUbuntu)) {
            Write-Host "[X] WSL2 + Ubuntu 설치를 확인할 수 없습니다." -ForegroundColor Red
            Write-Host "    수동으로 'wsl -l -v' 실행 후 결과를 확인해주세요." -ForegroundColor Yellow
            Read-Host "Enter를 누르면 종료됩니다"
            exit 1
        }
    }

    # Ubuntu 첫 실행(사용자명/비번 등록) 필요 여부 확인
    & wsl.exe -d Ubuntu --exec true 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "─────────────────────────────────────────" -ForegroundColor Yellow
        Write-Host "  Ubuntu 초기 설정이 필요합니다." -ForegroundColor Yellow
        Write-Host "  잠시 후 새 창에서 Ubuntu가 열립니다:" -ForegroundColor Yellow
        Write-Host "    1) 새 사용자명 (소문자/숫자) 입력" -ForegroundColor White
        Write-Host "    2) 비밀번호 입력 (2회)" -ForegroundColor White
        Write-Host "    3) `$` 프롬프트가 나오면 'exit' 입력하고 Enter" -ForegroundColor White
        Write-Host "─────────────────────────────────────────" -ForegroundColor Yellow
        Read-Host "준비되면 Enter를 누르세요"

        Start-Process wsl.exe -ArgumentList '-d', 'Ubuntu' -Wait

        Read-Host "Ubuntu 창을 닫으셨으면 Enter를 누르세요"
    }
}

# ===== 블록 6: 프로젝트 경로 WSL 변환 =====
$rawPath = & wsl.exe wslpath -a "$PSScriptRoot" 2>&1 | Out-String
$wslPath = ($rawPath -replace "`0", '').Trim()
if (-not $wslPath -or $wslPath -notmatch '^/') {
    Write-Host "[X] 프로젝트 경로 변환 실패: '$wslPath'" -ForegroundColor Red
    Read-Host "Enter를 누르면 종료됩니다"
    exit 1
}
Write-Host "[경로] WSL: $wslPath" -ForegroundColor Gray

# ===== 블록 7: setup-linux.sh 호출 =====
Write-Host ""
Write-Host "[실행] WSL Ubuntu에서 setup-linux.sh 실행..." -ForegroundColor Cyan
Write-Host ""

& wsl.exe -d Ubuntu --cd "$wslPath" bash ./setup-linux.sh
$linuxExitCode = $LASTEXITCODE

if ($linuxExitCode -ne 0) {
    Write-Host ""
    Write-Host "[X] setup-linux.sh 실패 (코드: $linuxExitCode)" -ForegroundColor Red
    Write-Host "    로그 확인: wsl -d Ubuntu cat /tmp/teamLGS.log" -ForegroundColor Yellow
    Read-Host "Enter를 누르면 종료됩니다"
    exit $linuxExitCode
}

# ===== 블록 8: 헬스체크 + 브라우저 자동 열기 =====
# .env에서 PORT 읽기
$envFile = Join-Path $PSScriptRoot '.env'
$port = 3456
if (Test-Path $envFile) {
    $portLine = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($portLine -and $portLine -match '^\s*PORT\s*=\s*(\d+)') {
        $port = [int]$Matches[1]
    }
}

Write-Host ""
Write-Host "[대기] 서버 부팅 대기 중 (최대 30초)..." -ForegroundColor Cyan
$url = "http://localhost:$port"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($res.StatusCode -eq 200) {
            $ready = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 1
    }
}

# ===== 블록 9: 종료 안내 + 트러블슈팅 =====
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
if ($ready) {
    Write-Host "  [OK] 설정 완료!" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  대시보드: $url" -ForegroundColor White
    Write-Host ""
    Write-Host "  브라우저를 자동으로 엽니다..." -ForegroundColor Gray
    Start-Process $url
} else {
    Write-Host "  [!] 서버 헬스체크 타임아웃" -ForegroundColor Yellow
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  서버가 아직 부팅 중일 수 있습니다." -ForegroundColor Yellow
    Write-Host "  잠시 후 브라우저에서 $url 접속을 시도해주세요." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  로그 확인:" -ForegroundColor Gray
    Write-Host "    wsl -d Ubuntu cat /tmp/teamLGS.log" -ForegroundColor Gray
}

# ===== 블록 10: 데스크톱 단축아이콘 생성 =====
try {
    $launcher = Join-Path $PSScriptRoot 'mycrew-launch.cmd'
    $iconFile = Join-Path $PSScriptRoot 'assets\installer\mycrew.ico'
    if (Test-Path $launcher) {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $linkPath = Join-Path $desktop 'MyCrew.lnk'
        $wsh = New-Object -ComObject WScript.Shell
        $sc = $wsh.CreateShortcut($linkPath)
        $sc.TargetPath = $launcher
        $sc.WorkingDirectory = $PSScriptRoot
        $sc.Description = 'MyCrew 대시보드 실행'
        if (Test-Path $iconFile) {
            $sc.IconLocation = "$iconFile,0"
        }
        $sc.WindowStyle = 7  # Minimized
        $sc.Save()
        Write-Host "  데스크톱 아이콘 생성: $linkPath" -ForegroundColor Gray
    } else {
        Write-Host "  [!] mycrew-launch.cmd 없음 — 단축아이콘 생성 건너뜀" -ForegroundColor DarkYellow
    }
} catch {
    Write-Host "  [!] 단축아이콘 생성 실패: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

Write-Host ""
Read-Host "Enter를 누르면 창이 닫힙니다"

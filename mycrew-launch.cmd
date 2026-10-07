@echo off
REM MyCrew Windows launcher.
REM Starts the Hono server in the background (build first if needed),
REM then opens the default browser to http://localhost:PORT.

setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

REM 1) Move to script directory (project root).
cd /d "%~dp0"

REM 2) Read PORT from .env (default 3456).
set "PORT=3456"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="PORT" set "PORT=%%B"
  )
)

REM 3) If server already responds, skip start.
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri http://localhost:%PORT%/api/health -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [MyCrew] server already running on :%PORT%
  goto open_browser
)

REM 4) Build if dist missing.
if not exist "dist" (
  echo [MyCrew] initial build...
  call npx tsc
  if errorlevel 1 goto build_failed
  call npx vite build
  if errorlevel 1 goto build_failed
)
if not exist "src\client\dist" (
  echo [MyCrew] client build...
  call npx vite build
  if errorlevel 1 goto build_failed
)

REM 5) Start server in background.
echo [MyCrew] starting server on :%PORT% ...
start "MyCrew Server" /MIN cmd /c "npx tsx src\index.ts > %TEMP%\mycrew-server.log 2>&1"

REM 6) Wait for health (max 15s).
for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri http://localhost:%PORT%/api/health -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
  if !ERRORLEVEL!==0 goto open_browser
  ping -n 1 127.0.0.1 >nul
)

:open_browser
start "" "http://localhost:%PORT%"
exit /b 0

:build_failed
echo [MyCrew] build failed. see console output above.
pause
exit /b 1

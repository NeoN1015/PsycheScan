@echo off
setlocal
cd /d "%~dp0"
title PsycheScan Dashboard

if not exist "server.py" (
  echo ERROR: server.py was not found in:
  echo   %CD%
  echo Run this file from the project folder containing server.py.
  goto failed
)

python --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python was not found. Install Python 3.10 or newer and add it to PATH.
  goto failed
)

python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 (
  echo ERROR: Python 3.10 or newer is required to run this server.
  python --version
  goto failed
)

if not defined PSYCHESCAN_LOCAL_TEST_MODE (
  echo.
  choice /C YN /N /M "Enable local test mode (skip sign-in, local use only)? [Y/N] "
  if errorlevel 2 (
    set "PSYCHESCAN_LOCAL_TEST_MODE=0"
  ) else (
    set "PSYCHESCAN_LOCAL_TEST_MODE=1"
  )
)

echo.
if "%PSYCHESCAN_LOCAL_TEST_MODE%"=="1" (
  set "PSYCHESCAN_HOST=127.0.0.1"
  echo Local test mode is ON. Sign-in is skipped for this computer only.
  echo Server address: http://127.0.0.1:8000
  python server.py
  set "SERVER_EXIT_CODE=%ERRORLEVEL%"
  goto finished
)

if not defined PSYCHESCAN_OPERATOR_PASSWORD (
  echo Secure sign-in mode is ON. Set an operator password when prompted.
  powershell -NoProfile -Command "$secure = Read-Host 'Set operator password' -AsSecureString; if ($secure.Length -eq 0) { Write-Error 'Password cannot be empty.'; exit 2 }; $env:PSYCHESCAN_OPERATOR_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password; python server.py; exit $LASTEXITCODE"
  set "SERVER_EXIT_CODE=%ERRORLEVEL%"
  goto finished
)

echo Secure sign-in mode is ON.
python server.py
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

:finished
echo.
if not "%SERVER_EXIT_CODE%"=="0" (
  echo The dashboard server stopped with exit code %SERVER_EXIT_CODE%.
)
echo Keep this window open while using the dashboard.
echo Open http://127.0.0.1:8000 in your browser.
pause
exit /b %SERVER_EXIT_CODE%

:failed
echo.
pause
exit /b 1

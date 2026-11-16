@echo off
cd /d "%~dp0"
if not defined PSYCHESCAN_OPERATOR_PASSWORD (
  powershell -NoProfile -Command "$secure = Read-Host 'Set operator password' -AsSecureString; $env:PSYCHESCAN_OPERATOR_PASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password; python server.py"
  exit /b %errorlevel%
)
python server.py

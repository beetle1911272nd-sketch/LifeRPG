@echo off
setlocal
PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-sandbox.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Check the diagnostic output.
  pause
)
endlocal

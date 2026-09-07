@echo off
rem ============================================================
rem  MetaClean for Windows - double-click to run
rem
rem  Starts a local (loopback-only) server and opens MetaClean
rem  in Google Chrome. No install, no admin, no dependencies.
rem
rem  Optional arguments are passed straight through, e.g.:
rem      MetaClean.bat -Mode App
rem      MetaClean.bat -Port 9090
rem      MetaClean.bat -NoAutoExit
rem ============================================================
setlocal
cd /d "%~dp0"

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Windows PowerShell was not found on this system.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Start-MetaClean.ps1" %*
endlocal

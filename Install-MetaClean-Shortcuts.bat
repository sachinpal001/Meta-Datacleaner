@echo off
rem ============================================================
rem  Adds MetaClean to your Desktop and Start Menu.
rem  Per-user only - no admin rights required.
rem  Run Uninstall-MetaClean-Shortcuts.bat to remove them again.
rem ============================================================
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Install-MetaClean.ps1" %*
pause
endlocal

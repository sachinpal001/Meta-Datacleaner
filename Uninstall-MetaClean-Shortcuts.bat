@echo off
rem ============================================================
rem  Removes the MetaClean Desktop / Start Menu shortcuts and
rem  the generated icon. Leaves the project folder untouched.
rem ============================================================
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Install-MetaClean.ps1" -Uninstall
pause
endlocal

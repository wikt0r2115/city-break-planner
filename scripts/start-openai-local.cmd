@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0start-openai-local.ps1"
set "planner_exit_code=%ERRORLEVEL%"
if not "%planner_exit_code%"=="0" pause
exit /b %planner_exit_code%

@echo off
setlocal
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
node --import tsx scripts/connect-openai.mjs
pause

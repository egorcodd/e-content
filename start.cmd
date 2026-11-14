@echo off
setlocal
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\npm.cmd" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  set "CONTENT_MANAGER_NPM=%ProgramFiles%\nodejs\npm.cmd"
) else (
  set "CONTENT_MANAGER_NPM=npm.cmd"
)
if not exist "node_modules\vite\package.json" (
  call "%CONTENT_MANAGER_NPM%" ci --workspaces=false
  if errorlevel 1 exit /b 1
)
call "%CONTENT_MANAGER_NPM%" run dev --workspaces=false

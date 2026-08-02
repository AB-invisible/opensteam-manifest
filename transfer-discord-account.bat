@echo off
setlocal
cd /d "%~dp0"

echo.
echo Starting OpenSteam Discord Account Transfer...
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo         Install Node.js 22.x and try again.
  exit /b 1
)

node scripts\transfer-discord-account.js
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% neq 0 (
  echo Transfer exited with error code %EXIT_CODE%.
) else (
  echo Done.
)

exit /b %EXIT_CODE%

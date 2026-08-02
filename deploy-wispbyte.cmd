@echo off
setlocal
cd /d "%~dp0"

echo Building Wispbyte bot bundle...
node scripts\build-wispbyte-bundle.js
if errorlevel 1 goto fail

echo.
echo Generating environment file from .env...
node scripts\generate-wispbyte-env.js
if errorlevel 1 goto fail

echo.
echo Ready:
echo   dist\wispbyte-opensteam-bot.zip  ^<- upload to Wispbyte file manager
echo   dist\wispbyte-env.txt          ^<- paste into Startup env vars
echo.
echo Next: https://wispbyte.com/client/create  (Node.js, Free plan)
echo Docs: docs\WISPBYTE.md
echo.
start "" "%CD%\dist"
goto end

:fail
echo Build failed.
exit /b 1

:end
pause

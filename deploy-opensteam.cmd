@echo off
setlocal
cd /d "%~dp0"

echo.
echo  OpenSteam cloud deploy (Fly.io + Neon)
echo  ======================================
echo.

set "PATH=%USERPROFILE%\.fly\bin;%PATH%"

where fly >nul 2>&1
if errorlevel 1 (
  echo Installing Fly CLI...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://fly.io/install.ps1 -useb | iex"
  set "PATH=%USERPROFILE%\.fly\bin;%PATH%"
)

echo Step 1: Fly login (browser will open)
fly auth login
if errorlevel 1 goto fail

echo.
echo Step 2: Sync secrets from .env
node scripts\fly-sync-secrets.js
if errorlevel 1 goto fail

echo.
echo Step 3: Create app if needed and import secrets
fly launch --yes --copy-config --name opensteam-manifest --region ams --no-deploy
if errorlevel 1 goto fail

fly secrets import < .fly.secrets
if errorlevel 1 goto fail

echo.
echo Step 4: Deploy web + bot (this takes several minutes)
fly deploy
if errorlevel 1 goto fail

echo.
echo Step 5: Stop local PM2 so only cloud bot runs
call pm2 stop manifest-bot manifest-web manifest-https manifest-tunnel 2>nul
call pm2 save 2>nul

echo.
echo Done. Open: https://opensteam-manifest.fly.dev
echo Point opensteam.lol DNS to Fly when ready: fly certs add opensteam.lol
goto end

:fail
echo.
echo Deploy failed. Fix the error above and run deploy-opensteam.cmd again.
exit /b 1

:end
pause

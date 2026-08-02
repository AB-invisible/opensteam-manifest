@echo off
cd /d "%~dp0"
echo === OpenSteam Manifest Render deploy ===
echo.

echo [1/4] Generating env files...
call node scripts\generate-render-env.js
if errorlevel 1 exit /b 1

echo.
echo [2/4] Committing and pushing to GitHub...
git add render.yaml Dockerfile .dockerignore scripts\render-keepalive.js scripts\render-health-server.js scripts\start-render-web.js scripts\start-render-bot.js scripts\generate-render-env.js scripts\setup-render.js scripts\bot-daemon.js deploy-render.cmd package.json
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Add Render deployment with S3 storage and keep-alive"
  git push origin HEAD
) else (
  echo Nothing new to commit — continuing.
)

echo.
echo [3/4] Stopping local manifest stack (same Discord token)...
powershell -NoProfile -Command "pm2 stop manifest-web,manifest-bot,manifest-tunnel,manifest-https -ErrorAction SilentlyContinue; pm2 save"

echo.
echo [4/4] Render API setup...
call node scripts\setup-render.js
if errorlevel 1 (
  echo.
  echo Manual step required:
  echo   1. Create API key: https://dashboard.render.com/u/settings#api-keys
  echo   2. Add RENDER_API_KEY=rnd_... to .env
  echo   3. Run: npm run render:setup
)

pause

@echo off
setlocal

cd /d "%~dp0"

echo.
echo   Restarting OpenSteam Discord bot...
echo.

node scripts/register-commands.js
if errorlevel 1 (
    echo.
    echo   Command registration failed — bot will still restart.
    echo.
)

pm2 restart manifest-bot --update-env
if errorlevel 1 (
    echo.
    echo   PM2 restart failed. Trying to start the bot instead...
    pm2 start ecosystem.config.js --only manifest-bot
)

echo.
pm2 status manifest-bot
echo.
pause

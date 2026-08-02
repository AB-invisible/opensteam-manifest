@echo off

cd /d "%~dp0"

pm2 stop manifest-web manifest-bot

pm2 status

pause


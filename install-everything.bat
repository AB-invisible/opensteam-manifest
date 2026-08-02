@echo off

setlocal



net session >nul 2>&1

if %errorlevel% neq 0 (

  echo Requesting administrator privileges...

  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"

  exit /b

)



echo.

echo ================================================================

echo   OpenSteam Manifest Platform - Install Everything

echo   (Separate from OpenSteam / denuvo - does NOT modify denuvo)

echo ================================================================

echo.

echo Requires Desktop\bot info.txt with the NEW bot credentials.

echo.

pause



powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"

if %errorlevel% neq 0 (

  echo.

  echo Setup failed. Read the error above and rerun this file.

  pause

  exit /b 1

)



echo.

pause


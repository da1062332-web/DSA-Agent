@echo off
title DSA-Agent Playwright Interactive UI
cd /d "%~dp0"
echo ========================================================
echo  Starting Playwright Interactive UI Mode
echo ========================================================
echo.
call npm run test:e2e:ui
pause

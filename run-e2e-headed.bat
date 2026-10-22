@echo off
title DSA-Agent Playwright Headed E2E
cd /d "%~dp0"
echo ========================================================
echo  Starting Playwright E2E Tests in Headed Mode (Live Browser)
echo ========================================================
echo.
call npm run test:e2e:headed
echo.
echo ========================================================
echo  Tests Completed!
echo ========================================================
pause

@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend\server.ps1"
echo.
echo Serveri u mbyll.
pause

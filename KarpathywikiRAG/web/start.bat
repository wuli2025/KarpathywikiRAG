@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Building static wiki site...
call node build.mjs
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)
echo.
echo Starting local server at http://localhost:3000
start "" http://localhost:3000
call npx serve dist -p 3000

@echo off
cd /d "%~dp0"
git config submodule.recurse false

REM Regenerate 404.html from index.html BEFORE staging, so the SPA fallback
REM that was just built is what actually ships. Without this the committed
REM 404.html drifts from index.html and deep links serve the wrong page.
node scripts\build-404.mjs
if errorlevel 1 (
  echo.
  echo BUILD FAILED - 404.html was not regenerated. Nothing was pushed.
  pause
  exit /b 1
)

git add index.html 404.html liveActivity.js *.js *.css *.json
git commit -m "Update refresh handlers and real-time features"
git push origin main
echo.
echo ========================================
echo Done! Press any key to exit.
echo ========================================
pause
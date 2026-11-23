@echo off
setlocal
pushd "%~dp0" || exit /b 1
if not exist "dist\index.html" (
  echo Build files are missing. Run npm.cmd run build first.
  pause
  exit /b 1
)
call npm.cmd run preview -- --open --port 4173 --strictPort
if errorlevel 1 pause
popd

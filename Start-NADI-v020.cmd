@echo off
setlocal
pushd "%~dp0" || exit /b 1
where node >nul 2>&1
if errorlevel 1 (
  echo NADI v020 needs Node.js 24.
  popd
  exit /b 1
)
if not exist ".nadi-server\server.mjs" (
  echo Build NADI v020 with npm ci, npm run build, then npm run build:server.
  popd
  exit /b 1
)
node ".nadi-server\server.mjs"
set "NADI_EXIT=%ERRORLEVEL%"
popd
exit /b %NADI_EXIT%

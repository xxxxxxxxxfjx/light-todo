@echo off
setlocal
set "APP_DIR=%~dp0release\win-unpacked"
set "LOG_DIR=%~dp0release\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Kill stale instances: a hung process holds the single-instance lock.
taskkill /IM LightTodo.exe /F >nul 2>&1
ping -n 3 127.0.0.1 >nul

REM DSH injects ELECTRON_RUN_AS_NODE=1, which turns Electron into Node.
set ELECTRON_RUN_AS_NODE=
set "LIGHTTODO_DATA_DIR=%~dp0release\data"
start "" "%APP_DIR%\LightTodo.exe" --no-sandbox --disable-gpu 1>"%LOG_DIR%\stdout.log" 2>"%LOG_DIR%\stderr.log"
endlocal

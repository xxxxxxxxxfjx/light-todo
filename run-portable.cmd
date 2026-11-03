@echo off
REM 便携版启动：数据放在 exe 旁边的 LightTodoData
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0LightTodo.exe"

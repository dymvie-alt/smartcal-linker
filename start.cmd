@echo off
set "PATH=%PATH%;C:\Program Files\nodejs"
echo Starting SmartCal Linker on http://localhost:3333 ...
start http://localhost:3333
node "%~dp0server.js"
pause

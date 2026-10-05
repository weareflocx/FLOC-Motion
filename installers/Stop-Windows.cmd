@echo off
"%~dp0runtime\node.exe" "%~dp0scripts\renderer-autostart.mjs" --stop
if errorlevel 1 pause

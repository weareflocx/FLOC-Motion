@echo off
"%~dp0runtime\node.exe" "%~dp0scripts\renderer-autostart.mjs"
if errorlevel 1 pause

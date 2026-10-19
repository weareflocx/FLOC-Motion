@echo off
"%~dp0runtime\node.exe" "%~dp0launcher.mjs" start
if errorlevel 1 pause

@echo off
if not exist "%~dp0runtime\node.exe" goto not_installed
if not exist "%~dp0launcher.mjs" goto not_installed
if not exist "%~dp0current.json" goto not_installed
"%~dp0runtime\node.exe" "%~dp0launcher.mjs" start
if errorlevel 1 pause
exit /b
:not_installed
echo FLOC Motion Renderer is not installed in this folder, or its installation did not finish.
echo Open Install-Windows.cmd from the extracted ZIP folder.
echo After installation, Start, Stop and Uninstall are in "%LOCALAPPDATA%\FLOC Motion\Renderer".
pause
exit /b 1

@echo off
setlocal DisableDelayedExpansion
set "SOURCE_DIR=%~dp0"
set "RENDERER_DIR=%LOCALAPPDATA%\FLOC Motion\Renderer"
set "NODE_VERSION=v22.23.3"
set "INSTALL_STEP=Checking extracted installer files"
for %%F in (package.json package-lock.json src\project.js server\renderer-version.mjs scripts\renderer-setup.mjs) do (
  if not exist "%SOURCE_DIR%%%F" (
    echo Extract the ENTIRE ZIP before running this installer.
    echo In File Explorer, right-click the ZIP, choose Extract All, then open Install-Windows.cmd from the extracted folder.
    echo Missing file: %%F
    goto failed
  )
)
set "INSTALL_STEP=Checking Windows architecture"
if /I not "%PROCESSOR_ARCHITECTURE%"=="AMD64" if /I not "%PROCESSOR_ARCHITEW6432%"=="AMD64" (
  echo This installer requires Windows x64.
  pause
  exit /b 1
)
set "NEED_FFMPEG=0"
set "INSTALL_STEP=Installing FFmpeg"
echo Checking FFmpeg...
where ffmpeg.exe >nul 2>nul
if errorlevel 1 set "NEED_FFMPEG=1"
where ffprobe.exe >nul 2>nul
if errorlevel 1 set "NEED_FFMPEG=1"
if "%NEED_FFMPEG%"=="1" (
  where winget.exe >nul 2>nul
  if errorlevel 1 goto missing_winget
  winget install --id Gyan.FFmpeg --exact --source winget --scope user --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto failed
)
set "INSTALL_STEP=Stopping the previous renderer"
if exist "%RENDERER_DIR%\runtime\node.exe" if exist "%RENDERER_DIR%\scripts\renderer-autostart.mjs" (
  "%RENDERER_DIR%\runtime\node.exe" "%RENDERER_DIR%\scripts\renderer-autostart.mjs" --stop
  if errorlevel 1 goto failed
)
set "INSTALL_STEP=Copying engine files"
echo Copying engine files...
if not exist "%RENDERER_DIR%" mkdir "%RENDERER_DIR%"
if errorlevel 1 goto failed
set "COPY_LOG=%RENDERER_DIR%\installation-copy.log"
for %%D in (src server scripts public) do (
  if exist "%RENDERER_DIR%\%%D" rmdir /S /Q "%RENDERER_DIR%\%%D"
  robocopy "%SOURCE_DIR%%%D" "%RENDERER_DIR%\%%D" /E /NFL /NDL /NJH /NJS /LOG+:"%COPY_LOG%" /TEE
  if errorlevel 8 goto failed
)
for %%F in (package.json package-lock.json Start-Windows.cmd Stop-Windows.cmd Uninstall-Windows.cmd) do (
  copy /Y "%SOURCE_DIR%%%F" "%RENDERER_DIR%\%%F" >nul
  if errorlevel 1 goto failed
)
set "INSTALL_STEP=Downloading the Node runtime"
echo Downloading the Node runtime...
set "DOWNLOAD_DIR=%TEMP%\floc-node-%RANDOM%-%RANDOM%"
mkdir "%DOWNLOAD_DIR%"
if errorlevel 1 goto failed
set "ARCHIVE=node-%NODE_VERSION%-win-x64.zip"
curl.exe --fail --location --proto =https "https://nodejs.org/dist/%NODE_VERSION%/%ARCHIVE%" -o "%DOWNLOAD_DIR%\%ARCHIVE%"
if errorlevel 1 goto failed
curl.exe --fail --location --proto =https "https://nodejs.org/dist/%NODE_VERSION%/SHASUMS256.txt" -o "%DOWNLOAD_DIR%\SHASUMS256.txt"
if errorlevel 1 goto failed
set "INSTALL_STEP=Verifying and extracting the Node runtime"
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $file=Join-Path $env:DOWNLOAD_DIR $env:ARCHIVE; $expected=(Get-Content (Join-Path $env:DOWNLOAD_DIR 'SHASUMS256.txt') | Where-Object { $_.EndsWith('  '+$env:ARCHIVE) }) -split '\s+'; if (!$expected -or (Get-FileHash $file -Algorithm SHA256).Hash -ne $expected[0]) { Write-Error 'Runtime download verification failed.'; exit 1 }; Expand-Archive -LiteralPath $file -DestinationPath $env:DOWNLOAD_DIR -Force"
if errorlevel 1 goto failed
robocopy "%DOWNLOAD_DIR%\node-%NODE_VERSION%-win-x64" "%RENDERER_DIR%\runtime" /E /NFL /NDL /NJH /NJS /LOG+:"%COPY_LOG%" /TEE
if errorlevel 8 goto failed
rmdir /S /Q "%DOWNLOAD_DIR%"
set "PATH=%RENDERER_DIR%\runtime;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
cd /D "%RENDERER_DIR%"
if errorlevel 1 goto failed
set "INSTALL_STEP=Installing engine dependencies"
echo Installing engine dependencies...
call runtime\npm.cmd ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto failed
set "INSTALL_STEP=Checking graphics and connecting the renderer"
runtime\node.exe scripts\renderer-setup.mjs
if errorlevel 1 goto failed
echo Ready. Return to FLOC Motion and choose Render MP4.
pause
exit /b 0
:missing_winget
echo WinGet is unavailable. Install or update App Installer from the Microsoft Store, then run this installer again.
goto failed
:failed
echo.
echo Installation did not finish.
echo Failed step: %INSTALL_STEP%
echo Installer folder: "%SOURCE_DIR%"
if defined COPY_LOG echo Copy diagnostics: "%COPY_LOG%"
echo Keep this window open and send a screenshot of the error above.
if defined DOWNLOAD_DIR if exist "%DOWNLOAD_DIR%" rmdir /S /Q "%DOWNLOAD_DIR%"
pause
exit /b 1

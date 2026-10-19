FLOC Motion Renderer

1. Open FLOC Motion in your browser, then Export > Connect this computer.
2. Extract this ZIP into a NEW empty folder. Open Install-Mac.command on Mac or Install-Windows.cmd on Windows.
3. Enter the connection code from Export when asked. Return to the browser and choose Render MP4.

The installer downloads a verified, private Node.js runtime and the engine's pinned dependencies. It checks FFmpeg, Chrome/Edge and hardware graphics before connecting. First installation needs internet access.
Windows x64 needs Windows 10/11 with WinGet. On Mac, missing FFmpeg is installed through Homebrew; install Homebrew from https://brew.sh first if requested. A compatible graphics driver and hardware acceleration are required.

On Windows, use File Explorer > Extract All before opening the installer. The installer replaces only its private runtime and invokes its bundled npm directly, rather than npm.cmd, which can select a globally installed npm. It preserves .data. If installation fails, keep the terminal open: the final message identifies the failed step. Copy errors are saved in installation-copy.log; Node/npm versions and engine installation output are saved in installation-dependencies.log in the installed folder. Share only the relevant diagnostic log, never .data.

On Mac, the verified Node archive is extracted before the previous private runtime is removed. The new runtime replaces it completely, so obsolete nested npm dependencies cannot survive an update. Node and its bundled npm are invoked directly; .data and global Node/npm installations are preserved.

Download the package and obtain the connection code from the same editor. Local and hosted editors can have different engine versions; the renderer must match the editor it connects to.

The renderer starts automatically when you sign in. Keep the computer awake while exporting. It connects outbound to the editor, opens no local network port, and only accepts jobs assigned to this browser. Use a new code to connect another browser.

Run Start, Stop or Uninstall from the installed folder:
Mac: ~/Library/Application Support/FLOC Motion/Renderer
Windows: %LOCALAPPDATA%\FLOC Motion\Renderer
Uninstall removes automatic startup and stops the renderer. It keeps your local files; remove the installation folder yourself if no longer needed.

Updates are automatic. When the editor publishes a new engine, the renderer downloads and verifies it between exports, then restarts into it; exports requested meanwhile wait in the queue. Use Update now in Export to check immediately. If the updated engine fails to start, the renderer returns to the previous engine and Export shows what needs attention. Exported videos stay on this computer.

Renderers installed before automatic updates need this installer once: run Install again with the latest package. It keeps the existing connection, so no new code is needed. A connection code is only needed for a new computer, or when the editor no longer recognises this renderer. Run Install again too when Export asks you to reinstall, for example when the private Node runtime changes.

The installed folder contains launcher.mjs, which keeps the renderer running, current.json naming the active engine, engines with the current and previous engine, deps with their shared dependencies, and .data, where connection credentials and diagnostics are stored; never share .data.

This is an unsigned internal installer. Windows runtime validation still requires a Windows x64 computer; a package build is not proof of Windows compatibility.

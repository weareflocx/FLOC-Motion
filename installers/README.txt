FLOC Motion Renderer

1. Open FLOC Motion in your browser, then Export > Connect this computer.
2. Extract this ZIP. Open Install-Mac.command on Mac or Install-Windows.cmd on Windows.
3. Enter the connection code from Export when asked. Return to the browser and choose Render MP4.

The installer downloads a verified, private Node.js runtime and the engine's pinned dependencies. It checks FFmpeg, Chrome/Edge and hardware graphics before connecting. First installation needs internet access.
Windows x64 needs Windows 10/11 with WinGet. On Mac, missing FFmpeg is installed through Homebrew; install Homebrew from https://brew.sh first if requested. A compatible graphics driver and hardware acceleration are required.

On Windows, use File Explorer > Extract All before opening the installer. If installation fails, keep the terminal open: the final message identifies the failed step. Copy errors are also saved in installation-copy.log in the installed folder.

The renderer starts automatically when you sign in. Keep the computer awake while exporting. It connects outbound to the editor, opens no local network port, and only accepts jobs assigned to this browser. Use a new code to connect another browser.

Run Start, Stop or Uninstall from the installed folder:
Mac: ~/Library/Application Support/FLOC Motion/Renderer
Windows: %LOCALAPPDATA%\FLOC Motion\Renderer
Uninstall removes automatic startup and stops the renderer. It keeps your local files; remove the installation folder yourself if no longer needed.

To update, finish active exports, download the latest package and run Install again with a fresh connection code. An outdated engine cannot export until updated. The installer preserves .data, where connection credentials and diagnostics are stored; never share that folder.

This is an unsigned internal installer. Windows runtime validation still requires a Windows x64 computer; a package build is not proof of Windows compatibility.

import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from '../server/process.mjs';
import { rendererDataDirectory } from './renderer-runtime.mjs';

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Installed renderers start the stable launcher, which survives engine updates.
// A direct checkout run starts its own worker, as before.
const home = process.env.FLOC_RENDERER_HOME ? path.resolve(process.env.FLOC_RENDERER_HOME) : null;
const root = home || engine;
const data = rendererDataDirectory(engine);
const script = home ? path.join(home, 'launcher.mjs') : path.join(engine, 'scripts/render-worker.mjs');
const stopping = process.argv.includes('--stop');
const uninstall = process.argv.includes('--uninstall');
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
if (process.platform === 'darwin') {
  const label = 'dev.floc.motion.personal-renderer';
  const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  if (!stopping && !uninstall) {
    const registered = await run('launchctl', ['print', `gui/${process.getuid()}/${label}`]).then(() => true, () => false);
    if (registered) { console.log('Renderer is already running.'); process.exit(0); }
  }
  await run('launchctl', ['bootout', `gui/${process.getuid()}/${label}`]).catch(() => {});
  if (uninstall) await rm(plist, { force: true });
  if (!stopping && !uninstall) {
    await mkdir(path.dirname(plist), { recursive: true });
    // The launcher exits 0 only when stopped or already running; anything else restarts.
    const keepAlive = home ? '<dict><key>SuccessfulExit</key><false/></dict>' : '<true/>';
    await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key>${keepAlive}<key>ThrottleInterval</key><integer>10</integer><key>StandardErrorPath</key><string>${xml(path.join(data, 'startup-error.log'))}</string></dict></plist>`);
    await run('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  }
} else if (process.platform === 'win32') {
  const startup = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Startup/FLOC Motion Renderer.vbs');
  const quote = value => value.replaceAll('"', '""');
  const command = `"${process.execPath}" "${script}"`;
  if (stopping || uninstall) {
    // Kill the launcher with its engine (or a directly started worker), but only when the
    // recorded pid still runs this installation's script.
    const targets = [[home ? 'launcher.pid' : 'worker.pid', script], ...(home ? [['worker.pid', path.join(home, 'engines')]] : [])];
    for (const [file, expected] of targets) {
      const pid = Number(await readFile(path.join(data, file), 'utf8').catch(() => '0'));
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const source = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p -and $p.CommandLine -and $p.CommandLine.IndexOf('${expected.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase) -ge 0) { & taskkill.exe /PID ${pid} /T /F }`;
      await run('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')]);
    }
    if (uninstall) await rm(startup, { force: true });
  } else {
    await mkdir(path.dirname(startup), { recursive: true });
    await writeFile(startup, `CreateObject("WScript.Shell").Run "${quote(command)}", 0, False\r\n`);
    await run('wscript.exe', [startup]);
  }
} else throw new Error('Automatic startup is available on Windows and macOS. Run render-worker.mjs manually on other platforms.');
console.log(uninstall ? 'Automatic startup removed. Your files have been kept.' : stopping ? 'Renderer stopped.' : 'Renderer starts automatically when you sign in.');

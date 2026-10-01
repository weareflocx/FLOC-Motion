import { mkdir, copyFile, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { runtimeConfig } from './runtime-config.mjs';
import { root, buildScene } from './build-scene.mjs';
import { FORMATS, validateProject, escapeHtml } from '../src/project.js';
import { ensureGifVideo } from './card-media.mjs';
import { cardMediaKind } from '../src/card-media.js';
import { stageMarkup } from '../src/scene.js';
export const jobs = new Map();
let running = false;
const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserPath = process.env.HYPERFRAMES_BROWSER_PATH || (existsSync(installedChrome) ? installedChrome : undefined);
export function run(command, args, options = {}, onData = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', ...options.env } });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { const text = stripVTControlCharacters(chunk.toString()); output = (output + text).slice(-12000); onData(text); });
    const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 2000).unref(); }, 20 * 60 * 1000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(output || `${command} failed (${code}).`)); });
  });
}
export async function prepareComposition(input, folder) {
  const original = validateProject(input);
  const p = structuredClone(original);
  await buildScene();
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const sources = [...p.images, ...p.layers.filter(l => l.src)];
  const copied = new Set();
  for (const item of sources) {
    const src = item.src;
    let local = src.startsWith('/assets/') ? path.join(runtimeConfig().data, src.slice(1)) : path.join(root, `public${src}`);
    // Normalize GIF cards, including GIFs in projects saved before video support.
    const gifCard = p.images.includes(item) && cardMediaKind(src) === 'gif';
    if (gifCard) { const video = local.replace(/\.gif$/i, '.webm'); await ensureGifVideo(local, video, run); local = video; }
    const dest = `assets/${path.basename(local)}`;
    if (!copied.has(local)) { await copyFile(local, path.join(folder, dest)); copied.add(local); }
    item.src = dest;
  }
  await copyFile(path.join(root, '.data/engine/scene.js'), path.join(folder, 'scene.js'));
  await copyFile(path.join(root, 'node_modules/gsap/dist/gsap.min.js'), path.join(folder, 'gsap.min.js'));
  for (const weight of [400, 600, 800]) await copyFile(path.join(root, `.data/engine/geist-${weight}.woff2`), path.join(folder, `geist-${weight}.woff2`));
  const [w, h] = FORMATS[p.format];
  // Music is mixed by FFmpeg after capture to support source offsets, looping and fades.
  const markup = stageMarkup({ ...p, layers: p.layers.filter(l => l.type !== 'music') });
  const serialized = JSON.stringify(p).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(p.name)}</title><style>${[400, 600, 800].map(weight => `@font-face{font-family:Geist;font-weight:${weight};src:url('./geist-${weight}.woff2')}`).join('')}*{box-sizing:border-box}body{margin:0;font-family:Geist,Arial,sans-serif}.composition{position:relative;width:${w}px;height:${h}px;overflow:hidden}</style></head><body><div class="composition" data-composition-id="main" data-floc-project="${escapeHtml(serialized)}" data-start="0" data-duration="${p.duration}" data-width="${w}" data-height="${h}">${markup}</div><script src="gsap.min.js"></script><script>window.__timelines=window.__timelines||{};const clock={time:0};const tl=gsap.timeline({paused:true});tl.to(clock,{time:${p.duration},duration:${p.duration},ease:"none",onUpdate:()=>window.dispatchEvent(new CustomEvent("hf-seek",{detail:{time:clock.time}}))},0);window.__timelines["main"]=tl;</script><script src="scene.js"></script></body></html>`;
  await writeFile(path.join(folder, 'index.html'), html);
  await writeFile(path.join(folder, 'hyperframes.json'), JSON.stringify({ name: 'motion-export', entry: 'index.html', fps: p.fps, width: w, height: h }));
  return original;
}
export async function startExport(input, { draft = false } = {}) {
  if (running) throw new Error('Another export is running. Wait until it finishes.');
  const p = validateProject(input);
  if (!p.images.length) throw new Error('Add at least one carousel image before exporting.');
  const id = randomUUID();
  const folder = path.join(runtimeConfig().data, 'renders', id);
  const job = { id, state: 'queued', progress: 0, message: 'Preparing local assets', name: p.name, createdAt: new Date().toISOString() };
  jobs.set(id, job); running = true;
  void (async () => {
    try {
      await prepareComposition(p, folder);
      const bin = path.join(root, 'node_modules/hyperframes/bin/hyperframes.mjs');
      job.state = 'rendering'; job.message = 'Rendering frames locally';
      await run(process.execPath, [bin, 'render', folder, '--output', path.join(folder, 'silent.mp4'), '--fps', String(p.fps), '--workers', '1', '--strict', '--quality', draft ? 'draft' : 'standard'], { cwd: folder, env: browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {} }, text => {
        const match = text.match(/(\d+)(?:\s*\/\s*(\d+))?\s*(?:frames|%)/i);
        if (match) job.progress = Math.min(90, match[2] ? Number(match[1]) / Number(match[2]) * 90 : Number(match[1]) * 0.9);
      });
      const music = p.layers.find(l => l.type === 'music');
      if (music.src && music.visible) {
        job.message = 'Mixing soundtrack'; job.progress = 92;
        const audioPath = path.join(folder, 'assets', path.basename(music.src));
        const args = ['-y', '-i', path.join(folder, 'silent.mp4')];
        args.push('-ss', String(music.offset), '-i', audioPath);
        const length = music.end - music.start;
        const fade = Math.min(music.fade, length / 2);
        const metadata = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', audioPath]));
        const remaining = Number(metadata.format.duration) - music.offset;
        if (!(remaining > 0)) throw new Error('Audio offset must be before the end of the soundtrack.');
        const filters = ['aresample=48000', `atrim=duration=${remaining}`, 'asetpts=PTS-STARTPTS'];
        if (music.loop) filters.push(`aloop=loop=-1:size=${Math.ceil(remaining * 48000)}`);
        filters.push(`atrim=duration=${length}`, 'asetpts=PTS-STARTPTS', `volume=${music.volume}`);
        if (fade > 0) filters.push(`afade=t=in:st=0:d=${fade}`, `afade=t=out:st=${length - fade}:d=${fade}`);
        filters.push(`adelay=${Math.round(music.start * 1000)}:all=1`, 'apad');
        await run('ffmpeg', [...args, '-filter_complex', `[1:a]${filters.join(',')}[music]`, '-map', '0:v', '-map', '[music]', '-c:v', 'copy', '-c:a', 'aac', '-t', String(p.duration), '-movflags', '+faststart', path.join(folder, 'video.mp4')]);
      } else await copyFile(path.join(folder, 'silent.mp4'), path.join(folder, 'video.mp4'));
      const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path.join(folder, 'video.mp4')]));
      if (Number(info.format.duration) < p.duration - 0.15 || !(await stat(path.join(folder, 'video.mp4'))).size) throw new Error('Export verification failed.');
      job.state = 'done'; job.progress = 100; job.message = 'MP4 ready'; job.url = `/exports/${id}/video.mp4`; job.duration = Number(info.format.duration);
      await writeFile(path.join(folder, 'job.json'), JSON.stringify(job));
    } catch (error) { job.state = 'failed'; job.message = error.message.slice(-2500); } finally { running = false; }
  })();
  return job;
}

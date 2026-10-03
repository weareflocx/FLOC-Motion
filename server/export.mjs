import { mkdir, copyFile, writeFile, readFile, stat } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FONT_FILES, fontFaceCss } from '../src/fonts.js';
import { runtimeConfig } from './runtime-config.mjs';
import { root, buildScene } from './build-scene.mjs';
import { FORMATS, validateProject, escapeHtml } from '../src/project.js';
import { validateExportSettings, exportDimensions } from '../src/export-settings.js';
import { ensureGifVideo } from './card-media.mjs';
import { cardMediaKind } from '../src/card-media.js';
import { extractCardFrames } from './card-frames.mjs';
import { stageMarkup } from '../src/scene.js';
export const jobs = new Map();
let running = false;
export { run } from './process.mjs';
import { run } from './process.mjs';
const browserPath = process.env.HYPERFRAMES_BROWSER_PATH;
export async function prepareComposition(input, folder, settings = {}) {
  const original = validateProject(input);
  const { resolution } = validateExportSettings(settings);
  const [outputWidth, outputHeight] = exportDimensions(original.format, resolution);
  const p = structuredClone(original);
  await buildScene();
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const cards = [...p.images, ...p.layers.filter(l => l.type === 'carousel').flatMap(l => l.images || [])];
  const sources = [...cards, ...p.layers.filter(l => l.src)];
  const copied = new Set();
  for (const item of sources) {
    const src = item.src;
    let local = src.startsWith('/assets/') ? path.join(runtimeConfig().data, src.slice(1)) : path.join(root, `public${src}`);
    // Normalize GIF cards, including GIFs in projects saved before video support.
    const gifCard = (cards.includes(item) || item.type === 'media') && cardMediaKind(src) === 'gif';
    if (gifCard) { const video = local.replace(/\.gif$/i, '.webm'); await ensureGifVideo(local, video, run); local = video; }
    const dest = `assets/${path.basename(local)}`;
    if (!copied.has(local)) { await copyFile(local, path.join(folder, dest)); copied.add(local); }
    item.src = dest;
  }
  await copyFile(path.join(root, '.data/engine/scene.js'), path.join(folder, 'scene.js'));
  const notices = path.join(folder, 'licenses/paper-shaders');
  await mkdir(notices, { recursive: true });
  for (const name of ['LICENSE', 'NOTICE']) await copyFile(path.join(root, 'public/licenses/paper-shaders', name), path.join(notices, name));
  await copyFile(path.join(root, 'node_modules/gsap/dist/gsap.min.js'), path.join(folder, 'gsap.min.js'));
  for (const font of FONT_FILES) await copyFile(path.join(root, '.data/engine', font.file), path.join(folder, font.file));
  const cardFrames = await extractCardFrames(p, folder, run);
  const [w, h] = FORMATS[p.format];
  // Music is mixed by FFmpeg after capture to support source offsets, looping and fades.
  const markup = stageMarkup({ ...p, layers: p.layers.filter(l => l.type !== 'music') });
  const serialized = JSON.stringify(p).replace(/</g, '\\u003c');
  const scale = outputWidth / w;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(p.name)}</title><style>${fontFaceCss('./')}*{box-sizing:border-box}body{margin:0;font-family:Geist,Arial,sans-serif}.composition{position:relative;width:${outputWidth}px;height:${outputHeight}px;overflow:hidden}.export-scene{position:relative;width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:top left}</style></head><body><div class="composition" data-composition-id="main" data-floc-project="${escapeHtml(serialized)}" data-render-scale="${scale}" data-start="0" data-duration="${p.duration}" data-width="${outputWidth}" data-height="${outputHeight}"><div class="export-scene">${markup}</div></div><script src="gsap.min.js"></script><script>window.__timelines=window.__timelines||{};const clock={time:0};const tl=gsap.timeline({paused:true});tl.to(clock,{time:${p.duration},duration:${p.duration},ease:"none",onUpdate:()=>window.dispatchEvent(new CustomEvent("hf-seek",{detail:{time:clock.time}}))},0);window.__timelines["main"]=tl;</script><script src="scene.js"></script></body></html>`;
  const frameData = JSON.stringify(cardFrames).replace(/</g, '\\u003c');
  await writeFile(path.join(folder, 'index.html'), html.replace('<script src="scene.js">', `<script id="floc-card-frames" type="application/json">${frameData}</script><script src="scene.js">`));
  await writeFile(path.join(folder, 'hyperframes.json'), JSON.stringify({ name: 'motion-export', entry: 'index.html', fps: p.fps, width: outputWidth, height: outputHeight }));
  await writeFile(path.join(folder, 'render-input.json'), JSON.stringify({ project: original, settings: validateExportSettings(settings) }));
  return original;
}
export async function renderPreparedComposition(input, folder, options = {}, onProgress = () => {}) {
  const p = validateProject(input);
  const settings = validateExportSettings(options);
  const [width, height] = exportDimensions(p.format, settings.resolution);
  const bin = path.join(root, 'node_modules/hyperframes/bin/hyperframes.mjs');
  onProgress({ message: 'Rendering frames', progress: 0 });
  let logError;
  // Auto keeps PNG for alpha and avoids costly PNG extraction for opaque video.
  await run(process.execPath, [bin, 'render', folder, '--output', path.join(folder, 'silent.mp4'), '--fps', String(p.fps), '--workers', '1', '--strict', '--sdr', '--quality', settings.quality, '--video-frame-format', 'auto'], { cwd: folder, env: browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {} }, text => {
    try { appendFileSync(path.join(folder, 'render.log'), text); } catch (error) { logError = error; }
    const match = text.match(/(\d+)(?:\s*\/\s*(\d+))?\s*(?:frames|%)/i);
    if (match) onProgress({ progress: Math.min(90, match[2] ? Number(match[1]) / Number(match[2]) * 90 : Number(match[1]) * 0.9) });
  });
  if (logError) throw new Error(`Could not store render diagnostics: ${logError.message}`);
  const tracks = p.layers.filter(l => l.type === 'music' && l.src && l.visible);
  if (tracks.length) {
    onProgress({ message: 'Mixing soundtrack', progress: 92 });
    const args = ['-y', '-i', path.join(folder, 'silent.mp4')];
    const graph = [];
    for (const [index, music] of tracks.entries()) {
      const audioPath = path.join(folder, 'assets', path.basename(music.src));
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
      graph.push(`[${index + 1}:a]${filters.join(',')}[track${index}]`);
    }
    graph.push(`${tracks.map((_, i) => `[track${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0[music]`);
    await run('ffmpeg', [...args, '-filter_complex', graph.join(';'), '-map', '0:v', '-map', '[music]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', String(p.duration), '-movflags', '+faststart', path.join(folder, 'video.mp4')]);
  } else await copyFile(path.join(folder, 'silent.mp4'), path.join(folder, 'video.mp4'));
  return verifyExport(p, path.join(folder, 'video.mp4'), settings);
}
export async function verifyExport(input, filename, options = {}) {
  const p = validateProject(input);
  const [width, height] = exportDimensions(p.format, validateExportSettings(options).resolution);
  const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filename]));
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const [numerator, denominator] = (video?.avg_frame_rate || '0/1').split('/').map(Number);
  // Match the renderer's tolerance for durations within 0.001 frames of a boundary.
  const expectedFrames = Math.ceil(p.duration * p.fps - 1e-3);
  if (Number(info.format.duration) < p.duration - 0.15 || !video || video.width !== width || video.height !== height || numerator / denominator !== p.fps || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || Number(video.nb_frames) !== expectedFrames || !(await stat(filename)).size) throw new Error('Export verification failed: duration, dimensions, frame rate or codec did not match.');
  return { width, height, fps: p.fps, duration: Number(info.format.duration) };
}
export async function startExport(input, options = {}) {
  if (running) throw new Error('Another export is running. Wait until it finishes.');
  const p = validateProject(input);
  const settings = validateExportSettings(options);
  const [width, height] = exportDimensions(p.format, settings.resolution);
  if (!p.layers.some(l => l.visible && l.type !== 'music')) throw new Error('Add a visible visual layer before exporting.');
  const id = randomUUID();
  const folder = path.join(runtimeConfig().data, 'renders', id);
  const job = { id, state: 'queued', progress: 0, message: 'Preparing local assets', name: p.name, ...settings, width, height, fps: p.fps, createdAt: new Date().toISOString() };
  jobs.set(id, job); running = true;
  void (async () => {
    try {
      await mkdir(folder, { recursive: true });
      await prepareComposition(p, folder, settings);
      job.state = 'rendering';
      const result = await renderPreparedComposition(p, folder, settings, update => Object.assign(job, update));
      job.state = 'done'; job.progress = 100; job.message = 'MP4 ready'; job.url = `/exports/${id}/video.mp4`; job.duration = result.duration;
    } catch (error) {
      job.state = 'failed'; job.message = error.message.slice(-2500);
      try { appendFileSync(path.join(folder, 'render.log'), `\nExport failed: ${error.message}\n`); } catch {}
    } finally {
      try { await writeFile(path.join(folder, 'job.json'), JSON.stringify(job)); }
      catch (error) { job.state = 'failed'; job.message = `Could not persist export result: ${error.message}`; }
      finally { running = false; }
    }
  })();
  return job;
}

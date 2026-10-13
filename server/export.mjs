import { mkdir, copyFile, writeFile, readFile, readdir, stat, rename, rm, open } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { FONT_FILES, fontFaceCss } from '../src/fonts.js';
import { runtimeConfig } from './runtime-config.mjs';
import { root, buildScene } from './build-scene.mjs';
import { FORMATS, validateProject, escapeHtml } from '../src/project.js';
import { validateExportSettings, exportDimensions, exportFormat } from '../src/export-settings.js';
import { ensureGifVideo } from './card-media.mjs';
import { cardMediaKind } from '../src/card-media.js';
import { extractCardFrames } from './card-frames.mjs';
import { stageMarkup } from '../src/scene.js';
import { readJson, writeJsonAtomic } from './json-store.mjs';
import { isTerminalJobState, RESTART_MESSAGE, CANCELLED_MESSAGE } from '../src/export-jobs.js';
export const jobs = new Map();
const controllers = new Map();
let running = null;
export { run } from './process.mjs';
import { run } from './process.mjs';
const browserPath = process.env.HYPERFRAMES_BROWSER_PATH;
// Each worker is a separate Chrome (~256 MB). Frames depend only on the supplied time, so
// parallel capture matches one worker; machines with 8 GB or less stay on one.
export function renderWorkers({ env = process.env, cpus = os.availableParallelism(), memory = os.totalmem() } = {}) {
  const override = env.FLOC_RENDER_WORKERS;
  if (override !== undefined && override !== '') {
    if (!/^\d+$/.test(override) || Number(override) < 1 || Number(override) > 16) throw new Error('FLOC_RENDER_WORKERS must be a whole number from 1 to 16.');
    return Number(override);
  }
  return memory <= 8 * 1024 ** 3 ? 1 : Math.min(4, Math.max(1, cpus - 1));
}
export async function prepareComposition(input, folder, settings = {}, signal) {
  const original = validateProject(input);
  const { resolution, format, transparent } = validateExportSettings(settings);
  const [outputWidth, outputHeight] = exportDimensions(original.format, resolution);
  const p = structuredClone(original);
  // Transparent exports keep only the foreground; every WebGL canvas already clears to alpha 0.
  if (transparent) p.layers = p.layers.filter(l => l.type !== 'background');
  // Opaque MOV/PNG keep the white page an MP4 shows behind empty areas.
  const backdrop = exportFormat(format).alpha && !transparent ? 'html{background:#fff}' : '';
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
    if (gifCard) { const video = local.replace(/\.gif$/i, '.webm'); await ensureGifVideo(local, video, run); local = video; signal?.throwIfAborted(); }
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
  signal?.throwIfAborted();
  const cardFrames = await extractCardFrames(p, folder, (command, args, options = {}, onData) => run(command, args, { ...options, signal }, onData));
  const [w, h] = FORMATS[p.format];
  // Music is mixed by FFmpeg after capture to support source offsets, looping and fades.
  const markup = stageMarkup({ ...p, layers: p.layers.filter(l => l.type !== 'music') });
  const serialized = JSON.stringify(p).replace(/</g, '\\u003c');
  const scale = outputWidth / w;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(p.name)}</title><style>${fontFaceCss('./')}*{box-sizing:border-box}${backdrop}body{margin:0;font-family:Geist,Arial,sans-serif}.composition{position:relative;width:${outputWidth}px;height:${outputHeight}px;overflow:hidden}.export-scene{position:relative;width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:top left}</style></head><body><div class="composition" data-composition-id="main" data-floc-project="${escapeHtml(serialized)}" data-render-scale="${scale}" data-start="0" data-duration="${p.duration}" data-width="${outputWidth}" data-height="${outputHeight}"><div class="export-scene">${markup}</div></div><script src="gsap.min.js"></script><script>window.__timelines=window.__timelines||{};const clock={time:0};const tl=gsap.timeline({paused:true});tl.to(clock,{time:${p.duration},duration:${p.duration},ease:"none",onUpdate:()=>window.dispatchEvent(new CustomEvent("hf-seek",{detail:{time:clock.time}}))},0);window.__timelines["main"]=tl;</script><script src="scene.js"></script></body></html>`;
  const frameData = JSON.stringify(cardFrames).replace(/</g, '\\u003c');
  await writeFile(path.join(folder, 'index.html'), html.replace('<script src="scene.js">', `<script id="floc-card-frames" type="application/json">${frameData}</script><script src="scene.js">`));
  await writeJsonAtomic(path.join(folder, 'hyperframes.json'), { name: 'motion-export', entry: 'index.html', fps: p.fps, width: outputWidth, height: outputHeight });
  await writeJsonAtomic(path.join(folder, 'render-input.json'), { project: original, settings: validateExportSettings(settings) });
  return original;
}
export async function renderPreparedComposition(input, folder, options = {}, onProgress = () => {}, signal) {
  const p = validateProject(input);
  const settings = validateExportSettings(options);
  const output = exportFormat(settings.format), png = settings.format === 'png';
  const captured = path.join(folder, png ? 'frames' : `silent.${output.extension}`), result = path.join(folder, output.file);
  const bin = path.join(root, 'node_modules/hyperframes/bin/hyperframes.mjs');
  onProgress({ message: 'Rendering frames', progress: 0 });
  let logError;
  // Auto keeps PNG for alpha and avoids costly PNG extraction for opaque video.
  await run(process.execPath, [bin, 'render', folder, '--output', captured, '--format', png ? 'png-sequence' : settings.format, '--fps', String(p.fps), '--workers', String(renderWorkers()), '--strict', '--sdr', '--quality', settings.quality, '--video-frame-format', 'auto'], { cwd: folder, signal, env: browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {} }, text => {
    try { appendFileSync(path.join(folder, 'render.log'), text); } catch (error) { logError = error; }
    const match = text.match(/(\d+)(?:\s*\/\s*(\d+))?\s*(?:frames|%)/i);
    if (match) onProgress({ progress: Math.min(90, match[2] ? Number(match[1]) / Number(match[2]) * 90 : Number(match[1]) * 0.9) });
  });
  if (logError) throw new Error(`Could not store render diagnostics: ${logError.message}`);
  const tracks = musicTracks(p);
  const audio = path.join(folder, 'audio.wav');
  if (tracks.length) {
    onProgress({ message: 'Mixing soundtrack', progress: 92 });
    // A PNG sequence carries its soundtrack as a separate WAV.
    const args = ['-y', ...(png ? [] : ['-i', captured])], first = png ? 0 : 1;
    const graph = [];
    for (const [index, music] of tracks.entries()) {
      const audioPath = path.join(folder, 'assets', path.basename(music.src));
      args.push('-ss', String(music.offset), '-i', audioPath);
      const length = music.end - music.start;
      const fade = Math.min(music.fade, length / 2);
      const metadata = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', audioPath], { signal }));
      const remaining = Number(metadata.format.duration) - music.offset;
      if (!(remaining > 0)) throw new Error('Audio offset must be before the end of the soundtrack.');
      const filters = ['aresample=48000', `atrim=duration=${remaining}`, 'asetpts=PTS-STARTPTS'];
      if (music.loop) filters.push(`aloop=loop=-1:size=${Math.ceil(remaining * 48000)}`);
      filters.push(`atrim=duration=${length}`, 'asetpts=PTS-STARTPTS', `volume=${music.volume}`);
      if (fade > 0) filters.push(`afade=t=in:st=0:d=${fade}`, `afade=t=out:st=${length - fade}:d=${fade}`);
      filters.push(`adelay=${Math.round(music.start * 1000)}:all=1`, 'apad');
      graph.push(`[${index + first}:a]${filters.join(',')}[track${index}]`);
    }
    graph.push(`${tracks.map((_, i) => `[track${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0[music]`);
    const maps = png ? ['-map', '[music]'] : ['-map', '0:v', '-map', '[music]', '-c:v', 'copy'];
    const codec = settings.format === 'mp4' ? ['-c:a', 'aac', '-b:a', '320k'] : ['-c:a', 'pcm_s16le'];
    const target = png ? [audio] : ['-movflags', '+faststart', result];
    await run('ffmpeg', [...args, '-filter_complex', graph.join(';'), ...maps, ...codec, '-ar', '48000', '-t', String(p.duration), ...target], { signal });
  } else if (settings.format === 'mp4') await copyFile(captured, result);
  else if (!png) await rename(captured, result);
  if (png) {
    if (tracks.length) {
      const wav = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', audio], { signal }));
      if (wav.streams[0]?.codec_name !== 'pcm_s16le' || Number(wav.format.duration) < p.duration - 0.15) throw new Error('Export verification failed: the soundtrack WAV is incomplete.');
    }
    onProgress({ message: 'Packing PNG frames', progress: 95 });
    const frames = (await readdir(captured)).filter(name => /\.png$/i.test(name)).sort();
    await writeStoredZip(result, [...frames.map((name, i) => ({ name: frameEntry(i), file: path.join(captured, name) })), ...(tracks.length ? [{ name: 'audio.wav', file: audio }] : [])], signal);
  }
  signal?.throwIfAborted();
  const verified = await verifyExport(p, result, settings);
  // The archive or mixed MOV already holds these frames; keep large intermediates off disk.
  if (settings.format !== 'mp4') await rm(captured, { recursive: true, force: true });
  return verified;
}
const frameEntry = index => `frames/frame_${String(index + 1).padStart(6, '0')}.png`;
const musicTracks = p => p.layers.filter(l => l.type === 'music' && l.src && l.visible);
const ZIP64_LIMIT = 0xffffffff;
// Stored ZIP (PNG and WAV gain nothing from deflate) with ZIP64 offsets past 4 GB.
export async function writeStoredZip(filename, entries, signal) {
  const now = new Date();
  const time = now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1;
  const date = Math.max(0, now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate();
  const handle = await open(filename, 'w'), central = [];
  let offset = 0;
  try {
    for (const { name, file } of entries) {
      signal?.throwIfAborted();
      const data = await readFile(file), nameBytes = Buffer.from(name), crc = crc32(data);
      if (data.length >= ZIP64_LIMIT) throw new Error(`${name} exceeds the 4 GB archive entry limit.`);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
      await handle.write(Buffer.concat([local, nameBytes])); await handle.write(data);
      central.push({ nameBytes, crc, size: data.length, offset });
      offset += local.length + nameBytes.length + data.length;
    }
    const records = central.flatMap(entry => {
      const zip64 = entry.offset >= ZIP64_LIMIT, header = Buffer.alloc(46), extra = Buffer.alloc(zip64 ? 12 : 0);
      if (zip64) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(entry.offset), 4); }
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(45, 4); header.writeUInt16LE(zip64 ? 45 : 20, 6); header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(time, 12); header.writeUInt16LE(date, 14); header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.size, 20); header.writeUInt32LE(entry.size, 24); header.writeUInt16LE(entry.nameBytes.length, 28);
      header.writeUInt16LE(extra.length, 30); header.writeUInt32LE(zip64 ? ZIP64_LIMIT : entry.offset, 42);
      return [header, entry.nameBytes, extra];
    });
    const directory = Buffer.concat(records), zip64 = offset >= ZIP64_LIMIT, tail = [];
    if (zip64) {
      const record = Buffer.alloc(56), locator = Buffer.alloc(20);
      record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
      record.writeBigUInt64LE(BigInt(central.length), 24); record.writeBigUInt64LE(BigInt(central.length), 32);
      record.writeBigUInt64LE(BigInt(directory.length), 40); record.writeBigUInt64LE(BigInt(offset), 48);
      locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(offset + directory.length), 8); locator.writeUInt32LE(1, 16);
      tail.push(record, locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(zip64 ? ZIP64_LIMIT : offset, 16);
    await handle.write(Buffer.concat([directory, ...tail, end]));
  } finally { await handle.close(); }
}
// Reads the stored ZIP written above and checks every frame header without extracting it.
async function verifyFrameArchive(p, filename, width, height, expectedFrames) {
  const handle = await open(filename, 'r');
  try {
    const { size } = await handle.stat();
    const read = async (position, length) => {
      const buffer = Buffer.alloc(length);
      if (position < 0 || (await handle.read(buffer, 0, length, position)).bytesRead !== length) throw new Error('Export verification failed: the archive is truncated.');
      return buffer;
    };
    const end = await read(size - 22, 22);
    if (end.readUInt32LE(0) !== 0x06054b50) throw new Error('Export verification failed: the archive has no directory.');
    let count = end.readUInt16LE(10), length = end.readUInt32LE(12), start = end.readUInt32LE(16);
    if (start === ZIP64_LIMIT) {
      const record = await read(Number((await read(size - 42, 20)).readBigUInt64LE(8)), 56);
      count = Number(record.readBigUInt64LE(32)); length = Number(record.readBigUInt64LE(40)); start = Number(record.readBigUInt64LE(48));
    }
    const directory = await read(start, length), entries = [];
    for (let at = 0; entries.length < count; ) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error('Export verification failed: the archive directory is corrupt.');
      const nameLength = directory.readUInt16LE(at + 28), extraLength = directory.readUInt16LE(at + 30), commentLength = directory.readUInt16LE(at + 32);
      let offset = directory.readUInt32LE(at + 42);
      if (offset === ZIP64_LIMIT) offset = Number(directory.readBigUInt64LE(at + 46 + nameLength + 4));
      const local = await read(offset, 30);
      entries.push({ name: directory.toString('utf8', at + 46, at + 46 + nameLength), method: directory.readUInt16LE(at + 10), data: offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28) });
      at += 46 + nameLength + extraLength + commentLength;
    }
    const audio = musicTracks(p).length > 0;
    const frames = entries.filter(entry => entry.name !== 'audio.wav');
    let valid = frames.length === expectedFrames && entries.length === expectedFrames + (audio ? 1 : 0);
    for (const [index, frame] of frames.entries()) {
      if (!valid) break;
      const header = await read(frame.data, 26);
      // PNG signature, IHDR width/height, 8-bit RGBA or RGB (Chrome drops alpha from fully opaque frames).
      valid = frame.name === frameEntry(index) && frame.method === 0 && header.readUInt32BE(0) === 0x89504e47 && header.readUInt32BE(16) === width && header.readUInt32BE(20) === height && header[24] === 8 && [2, 6].includes(header[25]);
    }
    if (!valid) throw new Error('Export verification failed: frame count, dimensions or PNG format did not match.');
  } finally { await handle.close(); }
}
export async function verifyExport(input, filename, options = {}) {
  const p = validateProject(input);
  const settings = validateExportSettings(options);
  const [width, height] = exportDimensions(p.format, settings.resolution);
  // Match the renderer's tolerance for durations within 0.001 frames of a boundary.
  const expectedFrames = Math.ceil(p.duration * p.fps - 1e-3);
  if (!(await stat(filename)).size) throw new Error('Export verification failed: the file is empty.');
  if (settings.format === 'png') {
    await verifyFrameArchive(p, filename, width, height, expectedFrames);
    return { width, height, fps: p.fps, duration: expectedFrames / p.fps };
  }
  const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filename]));
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  const [numerator, denominator] = (video?.avg_frame_rate || '0/1').split('/').map(Number);
  // MOV is ProRes 4444 with an alpha plane; MP4 is H.264 4:2:0 with AAC when music is mixed.
  const codec = settings.format === 'mov' ? video?.codec_name === 'prores' && /^4444/.test(video.profile) && /^yuva444p/.test(video.pix_fmt) : video?.codec_name === 'h264' && video.pix_fmt === 'yuv420p';
  const music = musicTracks(p).length > 0;
  const soundtrack = !music || audio?.codec_name === (settings.format === 'mov' ? 'pcm_s16le' : 'aac');
  if (Number(info.format.duration) < p.duration - 0.15 || !video || video.width !== width || video.height !== height || numerator / denominator !== p.fps || !codec || !soundtrack || Number(video.nb_frames) !== expectedFrames) throw new Error('Export verification failed: duration, dimensions, frame rate, codec or soundtrack did not match.');
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
  const controller = new AbortController(), { signal } = controller;
  jobs.set(id, job); controllers.set(id, controller); running = id;
  void (async () => {
    try {
      // Persist each transition so a crash leaves a record that startup recovery can mark as failed.
      await mkdir(folder, { recursive: true });
      await writeJsonAtomic(path.join(folder, 'job.json'), job);
      await prepareComposition(p, folder, settings, signal);
      signal.throwIfAborted();
      job.state = 'rendering';
      await writeJsonAtomic(path.join(folder, 'job.json'), job);
      const result = await renderPreparedComposition(p, folder, settings, update => { if (!signal.aborted) Object.assign(job, update); }, signal);
      // A cancelled export never becomes done, even if FFmpeg finished first.
      signal.throwIfAborted();
      const output = exportFormat(settings.format);
      job.state = 'done'; job.progress = 100; job.message = `${output.name} ready`; job.url = `/exports/${id}/${output.file}`; job.duration = result.duration;
    } catch (error) {
      if (!signal.aborted) {
        job.state = 'failed'; job.message = error.message.slice(-2500);
        try { appendFileSync(path.join(folder, 'render.log'), `\nExport failed: ${error.message}\n`); } catch {}
      }
    } finally {
      controllers.delete(id);
      try { await writeJsonAtomic(path.join(folder, 'job.json'), job); }
      catch (error) { if (!signal.aborted) { job.state = 'failed'; job.message = `Could not persist export result: ${error.message}`; } }
      finally { if (running === id) running = null; }
    }
  })();
  return job;
}
// Stops the HyperFrames/FFmpeg subprocesses of a local export and frees the queue at once.
export async function cancelExport(id) {
  const job = jobs.get(id), controller = controllers.get(id);
  if (job && isTerminalJobState(job.state)) throw Object.assign(new Error('This export already ended and cannot be cancelled.'), { status: 409 });
  if (!job || !controller) throw Object.assign(new Error('Export not found.'), { status: 404 });
  Object.assign(job, { state: 'cancelled', message: CANCELLED_MESSAGE });
  controller.abort(); controllers.delete(id);
  if (running === id) running = null;
  await writeJsonAtomic(path.join(runtimeConfig().data, 'renders', id, 'job.json'), job);
  return job;
}

async function storedJobs(data) {
  const directory = path.join(data, 'renders');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const stored = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const filename = path.join(directory, entry.name, 'job.json');
    try { stored.push({ filename, job: await readJson(filename) }); }
    catch (error) { if (!['ENOENT', 'EINVALIDJSON'].includes(error.code)) throw error; }
  }
  return stored;
}
// Runs once before the editor accepts requests: nothing that was in flight survives a restart.
export async function recoverInterruptedJobs(data) {
  let recovered = 0;
  for (const { filename, job } of await storedJobs(data)) {
    if (isTerminalJobState(job.state)) continue;
    Object.assign(job, { state: 'failed', message: RESTART_MESSAGE });
    await writeJsonAtomic(filename, job); recovered++;
  }
  return recovered;
}
const PUBLIC_JOB_FIELDS = ['id', 'state', 'progress', 'message', 'name', 'quality', 'resolution', 'format', 'transparent', 'width', 'height', 'fps', 'createdAt', 'duration', 'url', 'file'];
// Shared jobs plus the jobs of the requesting browser's renderer, newest first.
export async function listJobs(data, live, rendererId, limit = 20) {
  const merged = new Map((await storedJobs(data)).map(({ job }) => [job.id, job]));
  for (const job of live.values()) merged.set(job.id, job);
  return [...merged.values()]
    .filter(job => !job.rendererId || job.rendererId === rendererId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit)
    .map(job => Object.fromEntries(PUBLIC_JOB_FIELDS.filter(key => job[key] !== undefined).map(key => [key, job[key]])));
}

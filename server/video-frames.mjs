import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { carouselImages } from '../src/project.js';
import { cardMediaKind } from '../src/card-media.js';

function videoConsumers(project) {
  const sources = new Map();
  const add = (src, layer, carousel = false) => {
    if (cardMediaKind(src) !== 'video') return;
    if (!sources.has(src)) sources.set(src, []);
    sources.get(src).push({ layer, carousel });
  };
  for (const layer of project.layers) {
    if (layer.type === 'carousel') for (const card of carouselImages(project, layer)) add(card.src, layer, true);
    else if (layer.type === 'media' || (layer.type === 'background' && layer.mode === 'video')) add(layer.src, layer);
  }
  return sources;
}

// Keep source-clock coordinates even when only a late, short window is decoded.
function sourceWindow(project, consumers, duration) {
  let first = Infinity, end = 0;
  const lastFrame = Math.max(0, Math.ceil(duration * project.fps - 1e-6) - 1);
  for (const { layer, carousel } of consumers) {
    const elapsed = Math.max(0, Math.min(project.duration, layer.end ?? project.duration) - (layer.start ?? 0));
    const offset = carousel ? 0 : Math.max(0, layer.offset ?? 0);
    const remaining = Math.max(0, duration - offset);
    const wraps = (carousel || layer.loop) && elapsed >= remaining;
    const from = Math.min(lastFrame, Math.floor(offset * project.fps + 1e-6));
    const to = Math.min(lastFrame + 1, Math.max(from + 1, Math.ceil((wraps ? duration : offset + Math.min(elapsed, remaining)) * project.fps - 1e-6)));
    first = Math.min(first, from);
    end = Math.max(end, to);
  }
  return { firstFrame: first, count: end - first };
}

// Export derivatives never change saved sources or native preview playback.
export async function extractVideoFrames(project, folder, run) {
  const manifest = {};
  for (const [index, [src, consumers]] of [...videoConsumers(project)].entries()) {
    const input = path.join(folder, src);
    const metadata = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input]));
    const video = metadata.streams.find(stream => stream.codec_type === 'video');
    const duration = Number(video?.duration || metadata.format?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error(`Video has no finite duration: ${src}`);
    const alpha = /^(yuva|gbrap|rgba|bgra|argb|abgr)/.test(video.pix_fmt || '') || Number(video.tags?.alpha_mode) === 1;
    const extension = alpha ? 'png' : 'jpg';
    const directory = `video-frames/${index}`;
    const output = path.join(folder, directory);
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    const { firstFrame, count } = sourceWindow(project, consumers, duration);
    const args = ['-hide_banner', '-loglevel', 'error', '-xerror', '-y'];
    // The native VP9 decoder drops WebM alpha; libvpx preserves it.
    if (alpha && video.codec_name === 'vp9') args.push('-c:v', 'libvpx-vp9');
    // Retain the preceding keyframe's negative timestamps so fps can hold its last
    // decoded image at the seek boundary, including offsets beyond the source end.
    // Input seeking avoids decoding a long prefix; only the requested window is written.
    args.push('-ss', String(firstFrame / project.fps), '-noaccurate_seek', '-err_detect', 'explode', '-i', input, '-map', `0:${video.index}`, '-an');
    // A legitimate final image may precede the final CFR tick (e.g. 1 fps -> 30 fps).
    // Extend that image before resampling; decoding errors still fail via -xerror.
    args.push('-vf', `tpad=stop_mode=clone:stop_duration=${duration + 1},fps=${project.fps}:start_time=0,setpts=PTS-STARTPTS`, '-frames:v', String(count), '-start_number', '0');
    args.push(...(alpha ? ['-pix_fmt', 'rgba'] : ['-q:v', '2']), path.join(output, `%06d.${extension}`));
    // Measured ~20 ms per 4K JPEG and ~150 ms per 4K alpha PNG; allow 500 ms per frame.
    await run('ffmpeg', args, { timeoutMs: Math.max(300000, count * 500) });
    const files = (await readdir(output)).filter(name => new RegExp(`^\\d{6}\\.${extension}$`).test(name)).sort();
    if (files.length !== count || files.some((name, i) => name !== `${String(i).padStart(6, '0')}.${extension}`)) throw new Error(`Video frame extraction was incomplete: ${src}`);
    manifest[src] = { directory, extension, duration, fps: project.fps, count: files.length, firstFrame, width: video.width, height: video.height };
  }
  return manifest;
}

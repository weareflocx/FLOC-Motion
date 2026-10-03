import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { carouselImages } from '../src/project.js';
import { cardMediaKind } from '../src/card-media.js';

// Export derivatives do not change saved sources or preview playback.
export async function extractCardFrames(project, folder, run) {
  const sources = new Set(project.layers.filter(layer => layer.type === 'carousel').flatMap(layer => carouselImages(project, layer)).filter(card => cardMediaKind(card.src) === 'video').map(card => card.src));
  const manifest = {};
  for (const [index, src] of [...sources].entries()) {
    const input = path.join(folder, src);
    const metadata = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input]));
    const video = metadata.streams.find(stream => stream.codec_type === 'video');
    const duration = Number(video?.duration || metadata.format?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error(`Carousel video has no finite duration: ${src}`);
    const alpha = /^(yuva|gbrap|rgba|bgra|argb|abgr)/.test(video.pix_fmt || '') || Number(video.tags?.alpha_mode) === 1;
    const extension = alpha ? 'png' : 'jpg';
    const directory = `card-frames/${index}`;
    const output = path.join(folder, directory);
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    const length = Math.min(duration, project.duration);
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    // The native VP9 decoder drops WebM alpha; libvpx preserves it.
    if (alpha && video.codec_name === 'vp9') args.push('-c:v', 'libvpx-vp9');
    args.push('-i', input, '-an', '-t', String(length), '-vf', `fps=${project.fps}`, '-start_number', '0');
    args.push(...(alpha ? ['-pix_fmt', 'rgba'] : ['-q:v', '2']), path.join(output, `%06d.${extension}`));
    await run('ffmpeg', args, { timeoutMs: 300000 });
    const files = (await readdir(output)).filter(name => new RegExp(`^\\d{6}\\.${extension}$`).test(name)).sort();
    const expected = Math.ceil(length * project.fps - 1e-3);
    if (!files.length || files.length < expected - 1 || files.some((name, i) => name !== `${String(i).padStart(6, '0')}.${extension}`)) throw new Error(`Carousel frame extraction was incomplete: ${src}`);
    manifest[src] = { directory, extension, duration, fps: project.fps, count: files.length };
  }
  return manifest;
}

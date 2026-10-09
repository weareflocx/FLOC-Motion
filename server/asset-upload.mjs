import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateGlb, validateSvg } from './asset-validation.mjs';

export const MAX_ASSET_BYTES = 75e6;
export const MAX_MEDIA_DIMENSION = 4096;
export const MAX_MEDIA_PIXELS = 20e6;
export const MAX_MEDIA_DURATION = 600;
export const UPLOAD_IDLE_TIMEOUT_MS = 15000;

const mediaExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4', 'webm', 'mp3', 'wav', 'm4a', 'ogg']);
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
const videoExtensions = new Set(['mp4', 'webm']);
const audioExtensions = new Set(['mp3', 'wav', 'm4a', 'ogg']);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

function mediaFormat(format = '') {
  const names = String(format).toLowerCase().split(',').map(value => value.trim());
  if (names.includes('image2') || names.includes('png_pipe')) return 'png';
  if (names.includes('jpeg_pipe')) return 'jpg';
  if (names.includes('webp_pipe')) return 'webp';
  if (names.includes('gif')) return 'gif';
  if (names.includes('avif') || names.includes('mov') || names.includes('mp4') || names.includes('m4a') || names.includes('3gp')) return 'mp4';
  if (names.includes('matroska') || names.includes('webm')) return 'webm';
  if (names.includes('mp3')) return 'mp3';
  if (names.includes('wav')) return 'wav';
  if (names.includes('ogg')) return 'ogg';
  return '';
}

export async function streamUpload(req, filename, { limit = MAX_ASSET_BYTES, idleTimeoutMs = UPLOAD_IDLE_TIMEOUT_MS } = {}) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw failure('File is too large. Maximum upload size is 75 MB.', 413);
  const handle = await open(filename, 'wx');
  let size = 0, timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => req.destroy(failure('Upload timed out.', 408)), idleTimeoutMs);
  };
  try {
    reset();
    for await (const chunk of req) {
      reset();
      size += chunk.length;
      if (size > limit) throw failure('File is too large. Maximum upload size is 75 MB.', 413);
      await handle.write(chunk);
    }
    if (!size) throw failure('Empty upload.');
    return size;
  } catch (error) {
    await rm(filename, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
    await handle.close();
  }
}

export async function validateUploadedAsset(filename, ext, run) {
  if (ext === 'svg') return validateSvg(await readFile(filename));
  if (ext === 'glb') return validateGlb(await readFile(filename));
  if (!mediaExtensions.has(ext)) throw failure('Unsupported upload type.');
  let probe;
  try {
    probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filename], { timeoutMs: 15000 }));
  } catch (cause) {
    throw new Error('Uploaded file content does not match its extension.', { cause });
  }
  const actual = mediaFormat(probe.format?.format_name);
  const compatible = ext === actual || (ext === 'jpeg' && actual === 'jpg') || (ext === 'm4a' && actual === 'mp4') || (ext === 'avif' && actual === 'mp4');
  if (!compatible) throw failure('Uploaded file content does not match its extension.');
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
  if (imageExtensions.has(ext) || videoExtensions.has(ext)) {
    const width = Number(video?.width), height = Number(video?.height);
    if (!video || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw failure('Uploaded media has no readable video or image stream.');
    if (width > MAX_MEDIA_DIMENSION || height > MAX_MEDIA_DIMENSION || width * height > MAX_MEDIA_PIXELS) throw failure('Images and video must be at most 4096 px per edge and 20 megapixels.');
  }
  if (audioExtensions.has(ext) && !audio) throw failure('Uploaded audio has no readable audio stream.');
  if (videoExtensions.has(ext) || audioExtensions.has(ext)) {
    const duration = Number(video?.duration || audio?.duration || probe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MEDIA_DURATION) throw failure('Audio and video must be 10 minutes or shorter.');
  }
}

export async function acceptAssetUpload(req, { directory, ext, run, convertGif, beforePublish = () => {}, afterPublish = () => {} }) {
  const id = randomUUID(), temporary = path.join(directory, `${id}.upload`), target = path.join(directory, `${id}.${ext}`);
  try {
    await streamUpload(req, temporary);
    await validateUploadedAsset(temporary, ext, run);
    const size = (await stat(temporary)).size;
    await beforePublish({ id, size, temporary, target });
    await rename(temporary, target);
    if (ext === 'gif') await convertGif(target, path.join(directory, `${id}.webm`), run);
    await afterPublish({ id, size, target });
    return { id, filename: target, size };
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(target, { force: true });
    await rm(path.join(directory, `${id}.webm`), { force: true });
    throw error;
  }
}

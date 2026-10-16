import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './json-store.mjs';
import { run } from './process.mjs';

const AUDIO_ASSET = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(mp3|wav|m4a|ogg)$/;
const FORMATS = { mp3: 'mp3', wav: 'wav', m4a: 'mov', ogg: 'ogg' };
const BINS = 2048;
const VERSION = 1;
const invalidAudio = cause => Object.assign(new Error('Audio waveform could not be generated from this file.', { cause }), { status: 422 });
const sourceVersion = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String).join(':');

// One decoder per server, including probes. A full queue rejects instead of retaining
// an unbounded number of pending decodes when the media library is opened repeatedly.
let active = false;
const waiting = [];
async function withDecoder(task) {
  if (active) {
    if (waiting.length >= 32) throw Object.assign(new Error('Audio waveform service is busy. Try again shortly.'), { status: 503 });
    await new Promise(resolve => waiting.push(resolve));
  }
  active = true;
  try { return await task(); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else active = false;
  }
}

function validWaveform(value) {
  return value && Number.isFinite(value.duration) && value.duration > 0 && Array.isArray(value.peaks)
    && value.peaks.length > 0 && value.peaks.length <= BINS
    && value.peaks.every(peak => Number.isFinite(peak) && peak >= 0 && peak <= 1);
}

async function decode(filename, format) {
  let metadata;
  try {
    metadata = JSON.parse(await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format,
      '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels,duration:format=duration', '-of', 'json', filename], { timeoutMs: 15000 }));
  } catch (cause) { throw invalidAudio(cause); }
  const stream = metadata.streams?.[0];
  const duration = Number(metadata.format?.duration || stream?.duration);
  const sampleRate = Number(stream?.sample_rate), channels = Number(stream?.channels);
  if (!(duration > 0 && Number.isFinite(duration)) || !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 384000
    || !Number.isInteger(channels) || channels < 1 || channels > 64) throw invalidAudio();
  // Keep a fine envelope, merging adjacent buckets only when its fixed storage
  // fills. This handles gapless MP3 duration/padding without retaining PCM or
  // trusting a container's estimated duration for the waveform's time axis.
  const envelope = new Float32Array(BINS * 16);
  const frameBytes = channels * 4;
  let framesPerBucket = 1, frames = 0, pending = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-threads', '1',
      '-protocol_whitelist', 'file,pipe', '-f', format, '-i', filename, '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-t', String(duration), '-threads', '1', '-acodec', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let failure, stderr = '';
    const stop = error => { failure ||= error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error('Audio decoding timed out.')), 5 * 60 * 1000);
    timer.unref();
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.stdout.on('data', chunk => {
      if (failure) return;
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const complete = bytes.length - bytes.length % frameBytes;
      for (let offset = 0; offset < complete; offset += frameBytes) {
        if (frames === envelope.length * framesPerBucket) {
          for (let bin = 0; bin < envelope.length / 2; bin++) envelope[bin] = Math.max(envelope[bin * 2], envelope[bin * 2 + 1]);
          envelope.fill(0, envelope.length / 2);
          framesPerBucket *= 2;
        }
        const bucket = Math.floor(frames++ / framesPerBucket);
        let peak = envelope[bucket];
        for (let channel = 0; channel < channels; channel++) {
          const amplitude = Math.abs(bytes.readFloatLE(offset + channel * 4));
          if (!Number.isFinite(amplitude)) { stop(new Error('Audio contains invalid samples.')); return; }
          peak = Math.max(peak, Math.min(1, amplitude));
        }
        envelope[bucket] = peak;
      }
      pending = Buffer.from(bytes.subarray(complete));
    });
    child.once('error', error => { clearTimeout(timer); reject(invalidAudio(error)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0 || !frames || pending.length) reject(invalidAudio(failure || new Error(stderr || 'No complete audio samples.')));
      else resolve();
    });
  });
  const binCount = Math.min(BINS, frames), peaks = new Float32Array(binCount);
  // Conservatively project the fine envelope into successive equal-duration
  // output bins. A boundary transient may span neighboring bins, never vanish.
  for (let bucket = 0; bucket < Math.ceil(frames / framesPerBucket); bucket++) {
    const first = Math.floor(bucket * framesPerBucket * binCount / frames);
    const last = Math.floor((Math.min(frames, (bucket + 1) * framesPerBucket) - 1) * binCount / frames);
    for (let bin = first; bin <= last; bin++) peaks[bin] = Math.max(peaks[bin], envelope[bucket]);
  }
  return { duration: frames / sampleRate, peaks: Array.from(peaks, peak => Math.round(peak * 100000) / 100000) };
}

export function createAudioWaveforms({ data }) {
  const assets = path.join(data, 'assets'), cache = path.join(data, 'cache', 'audio-waveforms');
  const flights = new Map();
  return {
    async get(asset) {
      const match = AUDIO_ASSET.exec(asset);
      if (!match) throw Object.assign(new Error('Audio asset not found.'), { status: 404 });
      const filename = path.join(assets, asset);
      const info = await lstat(filename, { bigint: true });
      if (!info.isFile()) throw Object.assign(new Error('Audio asset not found.'), { status: 404 });
      const version = sourceVersion(info);
      const key = createHash('sha256').update(`${VERSION}:${asset}:${version}`).digest('hex');
      if (flights.has(key)) return flights.get(key);
      const work = (async () => {
        const cached = path.join(cache, `${key}.json`);
        try {
          const value = JSON.parse(await readFile(cached, 'utf8'));
          if (validWaveform(value)) return value;
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        return withDecoder(async () => {
          const waveform = await decode(filename, FORMATS[match[1]]);
          if (sourceVersion(await lstat(filename, { bigint: true })) !== version) throw Object.assign(new Error('Audio source changed. Try again.'), { status: 409 });
          await writeJsonAtomic(cached, waveform);
          return waveform;
        });
      })();
      flights.set(key, work);
      try { return await work; }
      finally { flights.delete(key); }
    }
  };
}

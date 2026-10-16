import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAudioWaveforms } from '../server/audio-waveform.mjs';
import { run } from '../server/process.mjs';

function wav({ duration = 1, channels = 1, sample = () => 0 } = {}) {
  const rate = 8000, frames = Math.floor(rate * duration), bytes = frames * channels * 2;
  const result = Buffer.alloc(44 + bytes);
  result.write('RIFF', 0); result.writeUInt32LE(36 + bytes, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(channels, 22);
  result.writeUInt32LE(rate, 24); result.writeUInt32LE(rate * channels * 2, 28);
  result.writeUInt16LE(channels * 2, 32); result.writeUInt16LE(16, 34);
  result.write('data', 36); result.writeUInt32LE(bytes, 40);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    result.writeInt16LE(Math.round(sample(frame, channel, frames) * 32767), 44 + (frame * channels + channel) * 2);
  }
  return result;
}

async function workspace(t) {
  const data = await mkdtemp(path.join(tmpdir(), 'floc-waveform-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const assets = path.join(data, 'assets');
  await mkdir(assets);
  return { data, assets, waveforms: createAudioWaveforms({ data }), cache: path.join(data, 'cache', 'audio-waveforms') };
}

async function withoutMediaTools(task) {
  const original = process.env.PATH;
  process.env.PATH = '';
  try { return await task(); }
  finally { if (original === undefined) delete process.env.PATH; else process.env.PATH = original; }
}

test('waveforms retain absolute multichannel peaks, silence and the final sample in bounded bins', async t => {
  const { assets, waveforms } = await workspace(t), asset = `${randomUUID()}.wav`;
  // Opposite-polarity stereo must not cancel; transients cannot disappear between bins.
  const source = wav({ channels: 2, sample: (frame, channel, frames) => {
    const amplitude = frame === 1000 ? .65 : frame === frames - 1 ? .9 : frame >= 2000 && frame < 4000 ? .2 : 0;
    return channel ? -amplitude : amplitude;
  } });
  await writeFile(path.join(assets, asset), source);
  const waveform = await waveforms.get(asset);
  assert.equal(waveform.duration, 1);
  assert.equal(waveform.peaks.length, 2048);
  assert(waveform.peaks.every(peak => peak >= 0 && peak <= 1));
  assert(waveform.peaks.slice(0, 250).every(peak => peak === 0));
  assert(Math.abs(waveform.peaks[256] - .65) < .001);
  assert(Math.abs(waveform.peaks[700] - .2) < .001);
  assert(waveform.peaks.slice(1100, 1900).every(peak => peak === 0));
  assert(Math.abs(waveform.peaks.at(-1) - .9) < .001);
  assert(Buffer.byteLength(JSON.stringify(waveform)) < 20000);
  assert.deepEqual(await readFile(path.join(assets, asset)), source, 'original audio is immutable');
});

test('silent and quiet audio are not normalized or replaced with fake peaks', async t => {
  const { assets, waveforms } = await workspace(t);
  for (const amplitude of [0, .125]) {
    const asset = `${randomUUID()}.wav`;
    await writeFile(path.join(assets, asset), wav({ duration: .5, sample: () => amplitude }));
    const waveform = await waveforms.get(asset);
    assert.equal(waveform.duration, .5);
    assert(waveform.peaks.every(peak => Math.abs(peak - amplitude) < .0001));
  }
});

test('long multichannel tracks retain final transients while the streaming envelope compacts', async t => {
  const { assets, waveforms } = await workspace(t), asset = `${randomUUID()}.wav`;
  await writeFile(path.join(assets, asset), wav({ duration: 9, channels: 3, sample: (frame, channel, frames) => {
    if (channel !== 2) return 0;
    return frame === frames - 1 ? .8 : frame === 33000 ? .6 : 0;
  } }));
  const waveform = await waveforms.get(asset);
  assert.equal(waveform.duration, 9);
  assert.equal(waveform.peaks.length, 2048);
  assert.equal(waveform.peaks[0], 0);
  assert(Math.abs(waveform.peaks[Math.floor(33000 / 72000 * 2048)] - .6) < .001);
  assert(Math.abs(waveform.peaks.at(-1) - .8) < .001);
});

test('concurrent requests share generation; fresh instances reuse atomic disk cache without media tools', async t => {
  const { data, assets, waveforms, cache } = await workspace(t), asset = `${randomUUID()}.wav`;
  await writeFile(path.join(assets, asset), wav({ sample: frame => frame % 2 ? .3 : -.3 }));
  const results = await Promise.all(Array.from({ length: 8 }, () => waveforms.get(asset)));
  assert(results.every(result => result === results[0]), 'one shared decode result');
  const files = await readdir(cache);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  const cacheFile = path.join(cache, files[0]), before = await stat(cacheFile);
  await withoutMediaTools(async () => {
    assert.deepEqual(await createAudioWaveforms({ data }).get(asset), results[0]);
  });
  assert.equal((await stat(cacheFile)).mtimeMs, before.mtimeMs);
  assert.deepEqual(JSON.parse(await readFile(cacheFile, 'utf8')), results[0]);
});

test('source changes invalidate cache and damaged derived cache is regenerated', async t => {
  const { assets, waveforms, cache } = await workspace(t), asset = `${randomUUID()}.wav`;
  await writeFile(path.join(assets, asset), wav());
  assert((await waveforms.get(asset)).peaks.every(peak => peak === 0));
  const [cached] = await readdir(cache);
  await writeFile(path.join(cache, cached), '{invalid cache');
  assert((await waveforms.get(asset)).peaks.every(peak => peak === 0));
  await writeFile(path.join(cache, cached), JSON.stringify({ duration: 1, peaks: [] }));
  assert((await waveforms.get(asset)).peaks.every(peak => peak === 0));
  await writeFile(path.join(assets, asset), wav({ duration: 2, sample: () => .4 }));
  const changed = await waveforms.get(asset);
  assert.equal(changed.duration, 2);
  assert(changed.peaks.every(peak => Math.abs(peak - .4) < .001));
  assert.equal((await readdir(cache)).length, 2);
});

test('missing, non-audio, traversal, symlink and undecodable sources fail without successful empty cache', async t => {
  const { assets, waveforms, cache } = await workspace(t);
  await assert.rejects(waveforms.get(`${randomUUID()}.wav`), { code: 'ENOENT' });
  for (const asset of ['../../outside.wav', `${randomUUID()}.mp4`, `${randomUUID()}.png`, 'not-a-uuid.wav']) {
    await assert.rejects(waveforms.get(asset), { status: 404 });
  }
  const target = `${randomUUID()}.wav`, alias = `${randomUUID()}.wav`;
  await writeFile(path.join(assets, target), wav());
  await symlink(path.join(assets, target), path.join(assets, alias));
  await assert.rejects(waveforms.get(alias), { status: 404 });
  for (const bytes of [Buffer.from('not audio'), wav({ duration: 0 }), Buffer.from('RIFFbroken')]) {
    const asset = `${randomUUID()}.wav`;
    await writeFile(path.join(assets, asset), bytes);
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(waveforms.get(asset), { status: 422 });
  }
  assert.deepEqual(await readdir(cache).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
});

test('failed media tools release single-flight state so the same source can be retried', async t => {
  const { assets, waveforms } = await workspace(t), asset = `${randomUUID()}.wav`;
  await writeFile(path.join(assets, asset), wav());
  await withoutMediaTools(() => assert.rejects(waveforms.get(asset), { status: 422 }));
  assert((await waveforms.get(asset)).peaks.every(peak => peak === 0));
});

test('MP3, M4A and OGG originals decode real peaks and duration without modifying their sources', async t => {
  const { assets, waveforms } = await workspace(t), source = path.join(assets, `${randomUUID()}.wav`);
  await writeFile(source, wav({ duration: .75, sample: frame => .4 * Math.sin(frame * Math.PI / 10) }));
  for (const ext of ['mp3', 'm4a', 'ogg']) {
    const asset = `${randomUUID()}.${ext}`, filename = path.join(assets, asset);
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', source, filename]);
    const before = await readFile(filename), waveform = await waveforms.get(asset);
    assert(waveform.duration >= .7 && waveform.duration < 1.1);
    assert(waveform.peaks.some(peak => peak > .2 && peak < .7));
    assert(waveform.peaks.slice(-150).some(peak => peak > .1), `${ext} retains the end of the audio`);
    assert.deepEqual(await readFile(filename), before);
  }
});

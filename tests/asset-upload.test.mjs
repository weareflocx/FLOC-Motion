import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { acceptAssetUpload, streamUpload, validateUploadedAsset } from '../server/asset-upload.mjs';
import { run } from '../server/process.mjs';

const folder = async t => {
  const value = await mkdtemp(path.join(os.tmpdir(), 'floc-upload-'));
  t.after(() => rm(value, { recursive: true, force: true }));
  return value;
};
const probe = value => async () => JSON.stringify(value);

test('streamed uploads reject declared and actual oversize bodies and remove partial files', async t => {
  const directory = await folder(t), declared = path.join(directory, 'declared.upload'), actual = path.join(directory, 'actual.upload');
  const request = Readable.from(['x']); request.headers = { 'content-length': '11' };
  await assert.rejects(streamUpload(request, declared, { limit: 10 }), error => error.status === 413);
  const chunks = Readable.from(['123456', '78901']); chunks.headers = {};
  await assert.rejects(streamUpload(chunks, actual, { limit: 10 }), error => error.status === 413);
  assert.deepEqual(await readdir(directory), []);
});

test('inactive uploads time out and remove their temporary file', async t => {
  const directory = await folder(t), target = path.join(directory, 'idle.upload');
  class IdleRequest extends EventEmitter {
    headers = {};
    destroy(error) { this.error = error; this.emit('error', error); }
    async *[Symbol.asyncIterator]() { await new Promise((resolve, reject) => { this.once('error', reject); }); }
  }
  const request = new IdleRequest();
  await assert.rejects(streamUpload(request, target, { limit: 10, idleTimeoutMs: 10 }), error => error.status === 408);
  assert.deepEqual(await readdir(directory), []);
});

test('media validation rejects extension mismatches, oversized pixels and long sources', async t => {
  const directory = await folder(t), target = path.join(directory, 'asset.mp4'); await writeFile(target, 'probe input');
  await assert.rejects(validateUploadedAsset(target, 'png', probe({ format: { format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', width: 100, height: 100 }] })), /does not match/);
  await assert.rejects(validateUploadedAsset(target, 'mp4', probe({ format: { format_name: 'mov,mp4', duration: '1' }, streams: [{ codec_type: 'video', width: 5000, height: 100, duration: '1' }] })), /4096 px/);
  await assert.rejects(validateUploadedAsset(target, 'mp4', probe({ format: { format_name: 'mov,mp4', duration: '601' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, duration: '601' }] })), /10 minutes/);
  await assert.doesNotReject(validateUploadedAsset(target, 'avif', probe({ format: { format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', width: 100, height: 100 }] })));
  await assert.doesNotReject(validateUploadedAsset(target, 'mp4', probe({ format: { format_name: 'mov,mp4', duration: '600' }, streams: [{ codec_type: 'video', width: 4096, height: 2160, duration: '600' }] })));
});

test('failed validation never publishes an asset', async t => {
  const directory = await folder(t), request = Readable.from(['not a png']); request.headers = {};
  await assert.rejects(acceptAssetUpload(request, { directory, ext: 'png', run: async () => { throw new Error('invalid'); }, convertGif() {} }), /does not match/);
  assert.deepEqual(await readdir(directory), []);
});

test('real probing accepts bounded PNG bytes and publishes them atomically', async t => {
  const directory = await folder(t), source = path.join(directory, 'source.png');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', source]);
  const bytes = await readFile(source); await rm(source);
  const request = Readable.from([bytes]); request.headers = { 'content-length': String(bytes.length) };
  const asset = await acceptAssetUpload(request, { directory, ext: 'png', run, convertGif() {} });
  assert.equal(await readFile(asset.filename).then(value => value.length), bytes.length);
  assert.deepEqual(await readdir(directory), [`${asset.id}.png`]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMediaKind, cardVideoSource, cardMediaTime, seekCardVideo, waitForVideo, playMedia, pauseMedia } from '../src/card-media.js';
import { demoProject, validateProject } from '../src/project.js';

const asset = ext => `/assets/12345678-1234-1234-1234-123456789abc.${ext}`;
test('playback cancellation is expected while genuine playback failures are reported', async () => {
  const errors = [];
  for (const name of ['AbortError', 'NotAllowedError', 'NotSupportedError']) {
    const error = new DOMException('Playback rejected', name);
    await playMedia({ play: () => Promise.reject(error) }, value => errors.push(value));
  }
  assert.deepEqual(errors.map(error => error.name), ['NotAllowedError', 'NotSupportedError']);
  await playMedia({ play: () => Promise.resolve() }, value => errors.push(value));
  assert.equal(errors.length, 2);
});
test('audio and video playback requests are grouped and rejected sessions retry only after pausing', async () => {
  for (const tagName of ['AUDIO', 'VIDEO']) {
    const errors = []; let calls = 0, reject;
    const media = { tagName, play() { calls++; return new Promise((resolve, fail) => { reject = fail; }); }, pause() {} };
    const first = playMedia(media, error => errors.push(error));
    assert.equal(playMedia(media, error => errors.push(error)), first);
    assert.equal(calls, 1);
    reject(new DOMException('Playback denied', 'NotAllowedError')); await first;
    await playMedia(media, error => errors.push(error));
    assert.equal(calls, 1); assert.equal(errors.length, 1);
    pauseMedia(media);
    const retry = playMedia(media, error => errors.push(error));
    assert.equal(calls, 2);
    reject(new DOMException('Playback interrupted', 'AbortError')); await retry;
    assert.equal(errors.length, 1);
  }
});
test('synchronous playback failures also reach the error handler', async () => {
  const errors = [];
  await playMedia({ play() { throw new DOMException('Unsupported media', 'NotSupportedError'); } }, error => errors.push(error));
  assert.equal(errors[0].name, 'NotSupportedError');
});
test('carousel accepts local static images, GIFs and videos but rejects audio and remote sources', () => {
  for (const ext of ['png', 'gif', 'mp4', 'webm']) {
    const p = demoProject(); p.images = [{ id: 'card', src: asset(ext), name: 'Card' }];
    assert.equal(validateProject(p).images[0].src, asset(ext));
  }
  for (const src of [asset('mp3'), 'https://example.com/card.mp4']) {
    const p = demoProject(); p.images[0].src = src; assert.throws(() => validateProject(p));
  }
});
test('GIF derivatives and video clocks are shared, local, looping and seek-safe', () => {
  assert.equal(cardMediaKind(asset('gif')), 'gif'); assert.equal(cardMediaKind(asset('mp4')), 'video');
  assert.equal(cardVideoSource(asset('gif')), asset('webm')); assert.equal(cardVideoSource(asset('png')), asset('png'));
  assert.equal(cardMediaTime(0, 2, 3), 0); assert.equal(cardMediaTime(5, 2, 3), 0);
  assert.equal(cardMediaTime(6.5, 2, 3), 1.5); assert.equal(cardMediaTime(6.5, 2, 3), cardMediaTime(6.5, 2, 3));
  assert.equal(cardMediaTime(3, 0, Infinity), 0);
});
test('paused video seeking waits for decode, handles errors and skips already decoded frames', async () => {
  const video = new EventTarget(); video.currentTime = 0; video.readyState = 2; video.seeking = false;
  await seekCardVideo(video, 0);
  const ready = seekCardVideo(video, 1); assert.equal(video.currentTime, 1);
  let decoded = false; ready.then(() => { decoded = true; }); await Promise.resolve(); assert.equal(decoded, false);
  video.dispatchEvent(new Event('seeked')); await ready; assert.equal(decoded, true);
  const failed = waitForVideo(video, 'loadeddata', () => video.dispatchEvent(new Event('error')));
  await assert.rejects(failed, /could not be decoded/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackClock, sampleTime } from '../src/editor/usePlayback.js';

function harness({ time = 0.65, duration = 4 } = {}) {
  let now = 1000, next = 1, pending = new Map();
  const clock = createPlaybackClock({ time, duration: () => duration, now: () => now,
    request(callback) { const id = next++; pending.set(id, callback); return id; }, cancel(id) { pending.delete(id); } });
  const frame = ms => { now += ms; const callbacks = [...pending.values()]; pending = new Map(); for (const callback of callbacks) callback(now); };
  return { clock, frame, pending: () => pending.size, setDuration(value) { duration = value; } };
}

test('playback advances from the current time, pauses on the shown frame and resumes from it', () => {
  const h = harness();
  h.clock.setPlaying(true);
  h.frame(500);
  assert.ok(Math.abs(h.clock.get().time - 1.15) < 1e-9);
  h.clock.setPlaying(value => !value);
  assert.deepEqual([h.clock.get().playing, h.pending()], [false, 0]);
  h.frame(2000);
  assert.ok(Math.abs(h.clock.get().time - 1.15) < 1e-9);
  h.clock.setPlaying(true); h.frame(250);
  assert.ok(Math.abs(h.clock.get().time - 1.4) < 1e-9);
});

test('reaching the composition duration repeats without stopping and preserves elapsed time', () => {
  const h = harness({ time: 11.5, duration: 12 });
  h.clock.setPlaying(true);
  h.frame(500);
  assert.deepEqual(h.clock.get(), { time: 0, playing: true, origin: 0 });
  assert.equal(h.pending(), 1);
  h.frame(12250);
  assert.deepEqual(h.clock.get(), { time: 0.25, playing: true, origin: 0 });
  assert.equal(sampleTime(h.clock.get(), Infinity), 0, 'React readers restart at the loop origin');
  h.frame(500);
  assert.equal(h.clock.get().time, 0.75, 'the next frame continues from the wrapped time');
  h.clock.setPlaying(false);
  assert.equal(h.pending(), 0, 'Pause still cancels the next frame after a repeat');
});

test('delayed frames can cross several loops without drift or extra scheduled callbacks', () => {
  const h = harness({ time: 0.5, duration: 12 });
  h.clock.setPlaying(true);
  h.frame(36500);
  assert.deepEqual(h.clock.get(), { time: 1, playing: true, origin: 0 });
  h.frame(250);
  assert.equal(h.clock.get().time, 1.25);
  assert.equal(h.pending(), 1);
});

test('shortening the composition while playing repeats within the new duration', () => {
  const h = harness({ time: 3.5 });
  h.clock.setPlaying(true);
  h.frame(400);
  h.setDuration(3.8);
  h.frame(100);
  assert.ok(Math.abs(h.clock.get().time - 0.2) < 1e-9);
  assert.equal(h.clock.get().playing, true);
  h.frame(100);
  assert.ok(Math.abs(h.clock.get().time - 0.3) < 1e-9);
});

test('Play from the end of the timeline repeats from the beginning', () => {
  const h = harness({ time: 12, duration: 12 });
  h.clock.setPlaying(true);
  h.frame(16);
  assert.ok(Math.abs(h.clock.get().time - 0.016) < 1e-9);
  assert.equal(h.clock.get().playing, true);
});

test('seeking while playing continues from the new time instead of snapping back', () => {
  const h = harness();
  h.clock.setPlaying(true); h.frame(1000);
  h.clock.setTime(3);
  h.frame(100);
  assert.ok(Math.abs(h.clock.get().time - 3.1) < 1e-9);
  assert.equal(h.clock.get().playing, true);
});

test('sampled React time stays put across playback frames and is exact once paused', () => {
  const h = harness({ time: 1 });
  const seen = { origin: [], text: [] };
  h.clock.subscribe(() => { seen.origin.push(sampleTime(h.clock.get(), Infinity)); seen.text.push(sampleTime(h.clock.get(), 0.1)); });
  h.clock.setPlaying(true);
  for (let i = 0; i < 30; i++) h.frame(1000 / 60);
  assert.deepEqual([...new Set(seen.origin)], [1]);
  assert.ok(new Set(seen.text).size <= 6, 'text readouts change at most 10 times per second');
  h.clock.setPlaying(false);
  const paused = h.clock.get().time;
  assert.equal(sampleTime(h.clock.get(), Infinity), paused);
  assert.equal(sampleTime(h.clock.get(), 0.1), paused);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createWaveformCache, visibleWaveformPeaks, waveformURL } from '../src/editor/audio-waveform.js';

const src = '/assets/5c6e62a1-59b0-4b79-a752-a943d49cd13d.wav';
const summary = { duration: 8, peaks: [0, 0, .25, .25, .8, .8, .4, .4] };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Consumers share immutable data, but never share their cancellation lifecycle.
test('waveform requests deduplicate clips and retain successful summaries across reopen', async () => {
  const pending = deferred(), calls = [];
  const cache = createWaveformCache((url, options) => { calls.push({ url, ...options }); return pending.promise; });
  const first = cache.load(src), second = cache.load(src);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/api${src}/waveform`);
  pending.resolve(summary);
  assert.equal(await first, summary);
  assert.equal(await second, summary);
  assert.equal(cache.peek(src), summary);
  assert.equal(await cache.load(src), summary);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false);
});

test('aborting one waveform consumer leaves other clips alive and ignores late completion for it', async () => {
  const pending = deferred(), controller = new AbortController();
  let fetchSignal;
  const cache = createWaveformCache((url, { signal }) => { fetchSignal = signal; return pending.promise; });
  const first = cache.load(src, { signal: controller.signal });
  const second = cache.load(src);
  const rejection = assert.rejects(first, { name: 'AbortError' });
  await Promise.resolve();
  controller.abort();
  await rejection;
  assert.equal(fetchSignal.aborted, false);
  pending.resolve(summary);
  assert.equal(await second, summary);
  assert.equal(cache.peek(src), summary);
});

test('last-consumer abort cannot poison a new request or overwrite its successful cache', async () => {
  const requests = [], controller = new AbortController();
  const cache = createWaveformCache((url, { signal }) => { const pending = deferred(); requests.push({ ...pending, signal }); return pending.promise; });
  const abandoned = cache.load(src, { signal: controller.signal });
  const rejection = assert.rejects(abandoned, { name: 'AbortError' });
  await Promise.resolve();
  controller.abort();
  await rejection;
  assert.equal(requests[0].signal.aborted, true);
  const fresh = cache.load(src);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  requests[1].resolve(summary);
  assert.equal(await fresh, summary);
  requests[0].reject(new DOMException('Aborted', 'AbortError'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await cache.load(src), summary);
  assert.equal(requests.length, 2);
});

test('failed or malformed summaries can retry, and missing sources never request data', async () => {
  let calls = 0;
  const cache = createWaveformCache(async () => { calls++; if (calls === 1) throw new Error('Unavailable'); if (calls === 2) return { ...summary, peaks: [NaN] }; return summary; });
  assert.equal(await cache.load(''), null);
  assert.equal(await cache.load('/assets/a.png'), null);
  assert.equal(calls, 0);
  await assert.rejects(cache.load(src), /Unavailable/);
  assert.equal(cache.peek(src), undefined);
  await assert.rejects(cache.load(src), /Invalid audio waveform/);
  assert.equal(await cache.load(src), summary);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cache.load(src, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(cache.peek(src), summary);
});

test('waveform columns follow source trims, moves, restoration, silence and the existing remaining-source loop', () => {
  const range = { start: 0, end: 8, offset: 0, loop: false };
  assert.deepEqual(visibleWaveformPeaks(summary, range, 24), summary.peaks);
  const trimmed = { ...range, start: 2, end: 6, offset: 2 };
  assert.deepEqual(visibleWaveformPeaks(summary, trimmed, 12), [.25, .25, .8, .8]);
  assert.deepEqual(visibleWaveformPeaks(summary, { ...trimmed, start: 1, end: 5 }, 12), [.25, .25, .8, .8]);
  assert.deepEqual(visibleWaveformPeaks(summary, { ...trimmed, start: 0, offset: 0 }, 18), [0, 0, .25, .25, .8, .8]);
  assert.deepEqual(visibleWaveformPeaks(summary, { ...range, end: 4, offset: 6 }, 12), [.4, .4, 0, 0]);
  assert.deepEqual(visibleWaveformPeaks(summary, { ...range, end: 6, offset: 3, loop: true }, 18), [.25, .8, .8, .4, .4, .25]);
  assert.deepEqual(visibleWaveformPeaks(summary, { ...range, offset: 8, loop: true }, 6), [0, 0]);
  assert.deepEqual(visibleWaveformPeaks({ duration: 4, peaks: [.9, .1, .2, .3] }, { ...range, end: 4, offset: 1, loop: true }, 6), [.2, .3]);
  assert.deepEqual(visibleWaveformPeaks(summary, { ...range, offset: 2, loop: true }, 0), [.8]);
  assert.equal(visibleWaveformPeaks(summary, range, 100000).length, 512);
  assert.deepEqual(visibleWaveformPeaks({ duration: 2, peaks: [0, .00001] }, { ...range, end: 2 }, 6), [0, .00001]);
});

const source = fs.readFileSync(new URL('../src/editor/components/AudioWaveform.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''), { loader: 'jsx' })).code;

function waveformUI(cache) {
  const slots = [], effects = [], cleanups = [];
  let cursor = 0;
  const context = { audioWaveforms: cache, waveformURL, visibleWaveformPeaks, AbortController,
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useMemo: compute => compute(),
    useState(initial) { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useEffect(effect, dependencies) { const index = cursor++; const previous = slots[index]; if (!previous || dependencies.some((value, i) => value !== previous[i])) { slots[index] = dependencies; effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); }); } }
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.hook = useAudioWaveforms; this.Status = AudioWaveformStatus; this.Waveform = AudioWaveform;', context);
  return { render(layers = [{ type: 'music', src }]) { cursor = 0; const result = context.hook(layers); while (effects.length) effects.shift()(); return result; }, dispose() { cleanups.forEach(cleanup => cleanup?.()); }, status: context.Status, waveform: context.Waveform };
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('waveform UI exposes loading, actionable errors, retry and safe unmount without project fields', async () => {
  let calls = 0;
  const pending = deferred();
  const cache = createWaveformCache(() => ++calls === 1 ? Promise.reject(new Error('Offline')) : pending.promise);
  const h = waveformUI(cache), layers = [{ type: 'music', src }, { type: 'music', src }, { type: 'music', src: '' }];
  h.render(layers);
  assert.equal(h.render(layers).summaries[src].status, 'loading');
  await flush();
  const error = h.render(layers);
  assert.equal(error.summaries[src].status, 'error');
  assert.equal(calls, 1);
  const status = h.status({ src, state: error.summaries[src], onRetry: error.retry });
  assert.equal(status.type, 'button');
  status.props.onClick({ stopPropagation() {} });
  h.render(layers);
  assert.equal(h.render(layers).summaries[src].status, 'loading');
  await flush();
  pending.resolve(summary);
  await flush();
  assert.equal(h.render(layers).summaries[src].data, summary);
  assert.equal(h.status({ src, state: h.render(layers).summaries[src] }), null);
  assert.equal(h.status({ src: '' }), null);
  assert.equal(h.waveform({ summary: { duration: 1, peaks: [0] }, range: { start: 0, end: 1, offset: 0, loop: false }, width: 100 }).children[1].props.d, '');
  assert.equal(Object.hasOwn(layers[0], 'peaks'), false);
  h.dispose();
  const reopened = waveformUI(cache);
  reopened.render(layers);
  assert.equal(reopened.render(layers).summaries[src].data, summary);
  assert.equal(calls, 2);
  reopened.dispose();
});

test('waveform hook aborts obsolete sources and pending unmounts without publishing stale metadata', async () => {
  const otherSrc = '/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.m4a';
  const calls = [];
  const cache = createWaveformCache((url, { signal }) => { const pending = deferred(); calls.push({ url, signal, ...pending }); return pending.promise; });
  const h = waveformUI(cache);
  h.render();
  await flush();
  h.render([{ type: 'music', src: otherSrc }]);
  await flush();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  calls[0].resolve(summary);
  await flush();
  assert.equal(h.render([{ type: 'music', src: otherSrc }]).summaries[src].status, 'loading');
  assert.equal(cache.peek(src), undefined);
  h.dispose();
  assert.equal(calls[1].signal.aborted, true);
  calls[1].resolve(summary);
  await flush();
  assert.equal(cache.peek(otherSrc), undefined);
  const reopened = waveformUI(cache);
  reopened.render([{ type: 'music', src: otherSrc }]);
  await flush();
  calls[2].resolve(summary);
  await flush();
  assert.equal(reopened.render([{ type: 'music', src: otherSrc }]).summaries[otherSrc].data, summary);
  reopened.dispose();
});

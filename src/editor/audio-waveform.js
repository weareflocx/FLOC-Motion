import { request } from './request.js';

export function waveformURL(src) {
  return /^\/assets\/[0-9a-f-]+\.(mp3|wav|m4a|ogg)$/i.test(src || '') ? `/api${src}/waveform` : null;
}

// Only successful immutable source summaries survive after the last consumer leaves.
export function createWaveformCache(fetchSummary = request) {
  const entries = new Map();
  return {
    peek(src) { return entries.get(src)?.data; },
    load(src, { signal } = {}) {
      const url = waveformURL(src);
      if (!url) return Promise.resolve(null);
      if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      let entry = entries.get(src);
      if (!entry) {
        entry = { controller: new AbortController(), consumers: 0 };
        entries.set(src, entry);
        entry.promise = Promise.resolve().then(() => fetchSummary(url, { signal: entry.controller.signal })).then(data => {
          if (!Number.isFinite(data?.duration) || data.duration <= 0 || !Array.isArray(data.peaks) || !data.peaks.length || data.peaks.length > 8192 || data.peaks.some(peak => !Number.isFinite(peak) || peak < 0 || peak > 1)) throw new Error('Invalid audio waveform.');
          entry.data = data;
          return data;
        }).catch(error => {
          if (entries.get(src) === entry) entries.delete(src);
          throw error;
        });
      }
      entry.consumers++;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          entry.consumers--;
          if (!entry.consumers && !entry.data && entries.get(src) === entry) {
            entries.delete(src);
            entry.controller.abort();
          }
          callback(value);
        };
        const abort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        entry.promise.then(data => finish(resolve, data), error => finish(reject, error));
      });
    }
  };
}

export const audioWaveforms = createWaveformCache();

// Aggregate source bins into at most one column per three screen pixels. A zero
// stays zero; neither quiet material nor silent tails are normalized into noise.
export function visibleWaveformPeaks(summary, { start, end, offset, loop }, width) {
  const count = Math.max(1, Math.min(512, Math.ceil(width / 3)));
  const { duration, peaks } = summary;
  const remaining = Math.max(0, duration - offset);
  const maximum = (from, to) => {
    if (to <= from) return 0;
    const first = Math.max(0, Math.floor(from / duration * peaks.length));
    const last = Math.min(peaks.length, Math.ceil(to / duration * peaks.length));
    let peak = 0;
    for (let i = first; i < last; i++) peak = Math.max(peak, peaks[i]);
    return peak;
  };
  const span = end - start;
  let loopMaximum;
  return Array.from({ length: count }, (_, index) => {
    if (remaining <= 0) return 0;
    const from = index / count * span, to = (index + 1) / count * span;
    if (!loop) return from >= remaining ? 0 : maximum(offset + from, Math.min(duration, offset + to));
    if (to - from >= remaining) return loopMaximum ??= maximum(offset, duration);
    const at = from % remaining, length = to - from;
    return at + length <= remaining ? maximum(offset + at, offset + at + length) : Math.max(maximum(offset + at, duration), maximum(offset, offset + at + length - remaining));
  });
}

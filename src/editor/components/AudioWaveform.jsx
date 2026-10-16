import React, { useEffect, useMemo, useState } from 'react';
import { audioWaveforms, visibleWaveformPeaks, waveformURL } from '../audio-waveform.js';
import './audio-waveform.css';

export function useAudioWaveforms(layers) {
  const sources = JSON.stringify([...new Set(layers.filter(layer => layer.type === 'music' && waveformURL(layer.src)).map(layer => layer.src))].sort());
  const [summaries, setSummaries] = useState({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controllers = [];
    for (const src of JSON.parse(sources)) {
      const cached = audioWaveforms.peek(src);
      if (cached) {
        setSummaries(current => ({ ...current, [src]: { status: 'ready', data: cached } }));
        continue;
      }
      const controller = new AbortController();
      controllers.push(controller);
      setSummaries(current => ({ ...current, [src]: { status: 'loading' } }));
      audioWaveforms.load(src, { signal: controller.signal }).then(data => {
        if (!controller.signal.aborted) setSummaries(current => ({ ...current, [src]: { status: 'ready', data } }));
      }).catch(error => {
        if (!controller.signal.aborted) setSummaries(current => ({ ...current, [src]: { status: 'error', error } }));
      });
    }
    return () => controllers.forEach(controller => controller.abort());
  }, [sources, attempt]);
  return { summaries, retry: () => setAttempt(value => value + 1) };
}

export function AudioWaveform({ summary, range, width }) {
  const { start, end, offset, loop } = range;
  const path = useMemo(() => visibleWaveformPeaks(summary, { start, end, offset, loop }, width).map((peak, index, columns) => {
    if (!peak) return '';
    const x = ((index + 0.5) / columns.length * 1000).toFixed(2);
    return `M${x},${(12 - peak * 11).toFixed(3)}V${(12 + peak * 11).toFixed(3)}`;
  }).join(''), [summary, start, end, offset, loop, width]);
  return <svg className="audio-waveform" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true"><path className="audio-waveform-baseline" d="M0 12H1000"/><path d={path}/></svg>;
}

export function AudioWaveformStatus({ src, state, onRetry }) {
  if (!waveformURL(src) || state?.status === 'ready') return null;
  return state?.status === 'error'
    ? <button type="button" className="audio-waveform-status error" aria-label="Waveform unavailable. Retry loading waveform" title={state.error.message} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onRetry(); }}>Waveform unavailable · Retry</button>
    : <span className="audio-waveform-status" role="status">Loading waveform…</span>;
}

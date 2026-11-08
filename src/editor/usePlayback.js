import { useEffect, useState, useSyncExternalStore } from 'react';

// The clock lives outside React so playback frames drive the stage without re-rendering the editor.
// `origin` is the time playback started from (or the latest seek), so React readers can sample coarsely.
export function createPlaybackClock({ time = 0, duration, now = () => performance.now(), request = callback => requestAnimationFrame(callback), cancel = frame => cancelAnimationFrame(frame) }) {
  let state = { time, playing: false, origin: time }, start = 0, frame = null;
  const listeners = new Set();
  const publish = next => { state = next; for (const listener of [...listeners]) listener(); };
  const tick = at => {
    frame = null;
    const elapsed = (at - start) / 1000, length = duration();
    frame = request(tick);
    if (elapsed >= length) {
      // Keep the fractional frame after the boundary, even if a delayed RAF spans several loops.
      const time = elapsed % length;
      start = at - time * 1000;
      publish({ time, playing: true, origin: 0 });
    } else publish({ ...state, time: elapsed });
  };
  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setTime(value) {
      const time = typeof value === 'function' ? value(state.time) : value;
      if (Object.is(time, state.time) && Object.is(time, state.origin)) return;
      if (state.playing) start = now() - time * 1000;
      publish({ ...state, time, origin: time });
    },
    setPlaying(value) {
      const playing = Boolean(typeof value === 'function' ? value(state.playing) : value);
      if (playing === state.playing) return;
      if (playing) { start = now() - state.time * 1000; frame = request(tick); }
      else if (frame !== null) { cancel(frame); frame = null; }
      publish({ ...state, playing, origin: state.time });
    }
  };
}

// Exact time while paused; while playing, `step` seconds of granularity (Infinity holds the playback origin).
export const sampleTime = ({ time, playing, origin }, step = 0) => !playing || !step ? time : step === Infinity ? origin : origin + Math.floor((time - origin) / step) * step;

export function usePlaybackTime(clock, step = 0) {
  return useSyncExternalStore(clock.subscribe, () => sampleTime(clock.get(), step));
}

export function usePlayback({ projectRef, duration, step = 0.1 }) {
  const [clock] = useState(() => createPlaybackClock({ duration: () => projectRef.current.duration }));
  const playing = useSyncExternalStore(clock.subscribe, () => clock.get().playing);
  const time = usePlaybackTime(clock, step);
  useEffect(() => () => clock.setPlaying(false), [clock]);
  useEffect(() => { if (clock.get().time > duration) clock.setTime(0); }, [clock, duration, time]);
  return { clock, time, playing, setTime: clock.setTime, setPlaying: clock.setPlaying };
}

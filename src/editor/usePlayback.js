import { useEffect, useState } from 'react';

export function usePlayback({ projectRef, duration }) {
  const [time, setTime] = useState(0.65);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - time * 1000;
    let frame;
    const tick = now => {
      const next = (now - start) / 1000;
      if (next >= projectRef.current.duration) { setTime(0); setPlaying(false); }
      else { setTime(next); frame = requestAnimationFrame(tick); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => { if (time > duration) setTime(0); }, [duration, time]);

  return { time, playing, setTime, setPlaying };
}

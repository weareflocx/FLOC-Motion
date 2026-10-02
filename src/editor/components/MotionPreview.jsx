import visibility from '../../catalog/preview-visibility.json';
import React, { useEffect, useRef, useState } from 'react';

export function MotionPreview({ item, collection, playing }) {
  const ref = useRef(null);
  const warning = collection === 'catalog' ? visibility[item.id] : '';
  const folder = collection === 'catalog' ? 'preset-previews' : 'motion-previews';
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    let visible = false;
    function update() {
      if (visible && playing && !warning && !document.hidden) video.play().catch(() => {});
      else video.pause();
    }
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }, { threshold: 0.15 });
    observer.observe(video);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); video.pause(); };
  }, [playing, warning]);
  return <><video ref={ref} className="motion-preview" src={`/${folder}/${item.id}.mp4`} poster={`/${folder}/${item.id}.jpg`} muted loop playsInline preload="none" disablePictureInPicture aria-label={`${item.name} sample animation`} onError={() => setFailed(true)}/>{(failed || warning) && <span>{failed ? 'Preview unavailable' : 'No visible cards'}</span>}{warning && <div className="motion-preview-empty">{warning}</div>}</>;
}

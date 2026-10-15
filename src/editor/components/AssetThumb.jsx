import React, { useEffect, useRef, useState } from 'react';
import { Cube, MusicNotes } from '@phosphor-icons/react';
import { cardVideoSource } from '../../card-media.js';
import { assetKind } from '../media-library.js';

// Thumbnails load only once scrolled into view, so a large library does not fetch every file.
function useInView() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return undefined;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: '120px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

const BADGES = { gif: 'GIF', video: 'VIDEO' };
export function AssetThumb({ asset, className = 'asset-preview' }) {
  const [ref, visible] = useInView();
  const kind = assetKind(asset.src);
  return <div ref={ref} className={className} data-kind={kind}>
    {kind === 'audio' ? <MusicNotes size={20} aria-hidden="true"/>
      : kind === 'model' ? <Cube size={20} aria-hidden="true"/>
      : visible && (kind === 'video' ? <video src={cardVideoSource(asset.src)} muted playsInline preload="metadata" aria-label={asset.name}/> : <img src={asset.src} alt={asset.name} draggable={false}/>)}
    {BADGES[kind] && <span className="asset-kind">{BADGES[kind]}</span>}
  </div>;
}

// Height / width of a rendered thumbnail, so a dropped visual is centered on the pointer.
export function thumbAspect(node) {
  const media = node?.querySelector('img, video');
  const width = media?.naturalWidth || media?.videoWidth, height = media?.naturalHeight || media?.videoHeight;
  return width && height ? height / width : undefined;
}

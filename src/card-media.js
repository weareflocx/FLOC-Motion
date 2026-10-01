export function cardMediaKind(src) {
  return /\.(mp4|webm)$/i.test(src) ? 'video' : /\.gif$/i.test(src) ? 'gif' : 'image';
}
export function cardVideoSource(src) {
  return cardMediaKind(src) === 'gif' ? src.replace(/\.gif$/i, '.webm') : src;
}
export function cardMediaTime(time, start, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, time - start) % duration;
}
export function waitForVideo(video, event, action, ready = () => false) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('A carousel video could not be decoded.')); };
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error('Timed out loading a carousel video frame.')); }, 15000);
    try { action(); if (ready()) done(); } catch (error) { cleanup(); reject(error); }
  });
}
export function seekCardVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2 && !video.seeking) return Promise.resolve();
  return waitForVideo(video, 'seeked', () => { video.currentTime = time; });
}

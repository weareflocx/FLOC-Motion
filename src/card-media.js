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
const playback = new WeakMap();
export function playMedia(media, onError) {
  const previous = playback.get(media);
  if (previous?.pending || previous?.failed) return previous.promise;
  const request = { pending: true, failed: false };
  playback.set(media, request);
  let result;
  try { result = media.play(); } catch (error) { result = Promise.reject(error); }
  request.promise = Promise.resolve(result).catch(error => {
    // Pausing or replacing media can cancel a pending playback request.
    if (error.name !== 'AbortError') {
      request.failed = true;
      onError(error);
    }
  }).finally(() => { request.pending = false; });
  return request.promise;
}
export function pauseMedia(media) {
  media.pause();
  // A new playback session may retry a rejected request.
  playback.delete(media);
}
export function waitForVideo(video, event, action, ready = () => false) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('A video could not be decoded.')); };
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error('Timed out loading a video frame.')); }, 15000);
    try { action(); if (ready()) done(); } catch (error) { cleanup(); reject(error); }
  });
}
export function seekCardVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2 && !video.seeking) return Promise.resolve();
  return waitForVideo(video, 'seeked', () => { video.currentTime = time; });
}

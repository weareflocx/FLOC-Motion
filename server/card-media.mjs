import { stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const conversions = new Map();
let conversionQueue = Promise.resolve();
// A local, seekable derivative preserves GIF alpha and its authored frame timing.
export async function ensureGifVideo(input, output, run) {
  try { if ((await stat(output)).size) return output; } catch {}
  if (conversions.has(output)) return conversions.get(output);
  const action = conversionQueue.catch(() => {}).then(async () => {
    const temp = path.join(path.dirname(output), `${randomUUID()}.webm`);
    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ignore_loop', '1', '-i', input, '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '28', '-b:v', '0', '-fps_mode', 'vfr', temp], { timeoutMs: 300000 });
      if (!(await stat(temp)).size) throw new Error('GIF conversion produced no video.');
      await rename(temp, output); return output;
    } finally { await rm(temp, { force: true }); }
  });
  conversionQueue = action;
  conversions.set(output, action);
  try { return await action; } finally { conversions.delete(output); }
}

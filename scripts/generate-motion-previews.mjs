import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { demoProject, TEMPLATES, validateProject } from '../src/project.js';
import { prepareComposition, run } from '../server/export.mjs';
import { CATALOG } from '../src/catalog.js';
import { root } from '../server/build-scene.mjs';

// Local samples use the same scene and frame-driven export path as the editor.
const presets = process.argv.includes('--presets');
const filter = process.argv.find(argument => argument.startsWith('--id='))?.slice(5);
const items = (presets ? CATALOG : TEMPLATES).filter(item => !filter || item.id === filter);
if (!items.length) throw new Error(`Unknown preview: ${filter}`);
const collection = presets ? 'preset' : 'template';
const output = path.join(root, `public/${collection}-previews`);
const work = path.join(root, `.data/${collection}-preview-build`);
await mkdir(output, { recursive: true });
await mkdir(work, { recursive: true });
const jobs = [];
for (const template of items) {
  const project = demoProject();
  project.name = `${template.name} sample`;
  project.format = 'landscape';
  project.duration = template.defaults?.loopDuration || 6;
  project.layers.forEach(layer => { layer.end = project.duration; layer.visible = ['background', 'carousel'].includes(layer.type); });
  Object.assign(project.layers[1], presets ? template.carouselPatch : { template: template.id, motionVariant: 'default', cardCount: 6, loopDuration: 6, speed: 18, x: 50, y: 50, tilt: ['arc', 'flip'].includes(template.id) ? 0 : -12, yaw: 0, roll: 0, shader: 'none' });
  if (!presets && template.defaults) {
    Object.assign(project.layers[1], template.defaults);
    project.format = 'landscape43';
    project.fps = 30;
  }
  // A light front card makes the deck silhouette readable against the black sample.
  if (template.id === 'stack-shuffle') project.images.push(project.images.shift());
  const folder = path.join(work, template.id);
  await prepareComposition(validateProject(project), folder);
  jobs.push({ template, folder, duration: project.duration, fps: project.fps });
}
const visibility = {};
let index = 0;
async function worker() {
  while (index < jobs.length) {
    const { template, folder, duration, fps } = jobs[index++];
    console.log(`Rendering ${template.name}…`);
    const log = await run(process.execPath, [path.join(root, 'node_modules/hyperframes/bin/hyperframes.mjs'), 'render', folder, '--output', path.join(folder, 'sample.mp4'), '--fps', String(fps), '--workers', '1', '--quality', 'draft', '--strict'], { cwd: folder, env: { HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
    await writeFile(path.join(folder, 'render.log'), log);
    const video = path.join(output, `${template.id}.mp4`);
    await run('ffmpeg', ['-y', '-i', path.join(folder, 'sample.mp4'), '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video]);
    await run('ffmpeg', ['-y', '-ss', template.id === 'stack-shuffle' ? '0.2' : '0.5', '-i', video, '-frames:v', '1', '-q:v', '3', path.join(output, `${template.id}.jpg`)]);
    const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', video]));
    if (Math.abs(Number(info.format.duration) - duration) > 0.1 || info.streams[0].width !== 480 || info.streams[0].height !== 270) throw new Error(`Invalid preview: ${template.id}`);
    if (presets) {
      const gray = path.join(folder, 'visibility.gray');
      await run('ffmpeg', ['-y', '-i', video, '-vf', 'fps=2,scale=64:36,format=gray', '-f', 'rawvideo', gray]);
      const frames = await readFile(gray);
      let maxMean = 0;
      for (let offset = 0; offset < frames.length; offset += 64 * 36) {
        let sum = 0;
        for (let i = 0; i < 64 * 36; i++) sum += frames[offset + i];
        maxMean = Math.max(maxMean, sum / (64 * 36));
      }
      if (maxMean < 0.3) visibility[template.id] = 'No cards visible with these settings.';
    }
    console.log(`Ready: ${template.name}`);
  }
}
await Promise.all([worker(), worker()]);
if (presets && !filter) await writeFile(path.join(root, 'src/catalog/preview-visibility.json'), JSON.stringify(visibility, null, 2) + '\n');
await rm(work, { recursive: true, force: true });
console.log(`Generated ${items.length} motion samples.`);

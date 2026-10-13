import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { demoProject, FORMATS, CAROUSEL_EFFECTS, patchLayer, validateProject } from '../src/project.js';
import { exportDimensions, validateExportSettings } from '../src/export-settings.js';
import { prepareComposition, startExport, jobs, renderWorkers, verifyExport, writeStoredZip, run } from '../server/export.mjs';
import { createTools } from '../src/webmcp.js';

test('invalid export settings fail before queuing a render', async () => {
  const count = jobs.size;
  for (const settings of [null, [], { quality: 'ultra' }, { quality: null }, { resolution: '8k' }, { resolution: 2160 }, { format: 'webm' }, { format: null }, { format: 'mov', transparent: 'yes' }, { transparent: true }, { format: 'mp4', transparent: true }]) {
    assert.throws(() => validateExportSettings(settings));
    await assert.rejects(startExport(demoProject(), settings));
  }
  assert.equal(jobs.size, count);
  assert.deepEqual(validateExportSettings(), { quality: 'high', resolution: '1080p', format: 'mp4', transparent: false });
  assert.deepEqual(validateExportSettings({ format: 'png', transparent: true }), { quality: 'high', resolution: '1080p', format: 'png', transparent: true });
});

test('render workers scale with the machine and an override must be a sane count', () => {
  const gb = 1024 ** 3;
  assert.equal(renderWorkers({ env: {}, cpus: 10, memory: 16 * gb }), 4);
  assert.equal(renderWorkers({ env: {}, cpus: 3, memory: 16 * gb }), 2);
  assert.equal(renderWorkers({ env: {}, cpus: 1, memory: 16 * gb }), 1);
  assert.equal(renderWorkers({ env: {}, cpus: 10, memory: 8 * gb }), 1, '8 GB machines stay on one Chrome');
  assert.equal(renderWorkers({ env: { FLOC_RENDER_WORKERS: '6' }, cpus: 2, memory: 4 * gb }), 6);
  for (const value of ['0', '2.5', 'auto', '17', '-1']) assert.throws(() => renderWorkers({ env: { FLOC_RENDER_WORKERS: value } }), /FLOC_RENDER_WORKERS/);
});

test('transparent exports leave out background layers; opaque alpha formats keep a white page', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-transparent-'));
  try {
    const p = validateProject(demoProject()), before = structuredClone(p);
    const background = p.layers.find(layer => layer.type === 'background');
    const prepared = async settings => {
      await prepareComposition(p, folder, settings);
      const html = await readFile(path.join(folder, 'index.html'), 'utf8');
      const layers = JSON.parse(html.match(/data-floc-project="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')).layers;
      return { html, backgrounds: layers.filter(layer => layer.type === 'background').length };
    };
    for (const format of ['mov', 'png']) {
      const transparent = await prepared({ format, transparent: true });
      assert.equal(transparent.backgrounds, 0);
      assert(!transparent.html.includes(`data-floc-layer="${background.id}"`));
      assert(!transparent.html.includes('html{background'));
      const opaque = await prepared({ format });
      assert.equal(opaque.backgrounds, 1);
      assert(opaque.html.includes('html{background:#fff}'));
    }
    assert.deepEqual(p, before);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('verification accepts ProRes 4444 MOV and RGBA PNG archives and rejects mismatched outputs', async t => {
  if (spawnSync('ffmpeg', ['-version']).error?.code === 'ENOENT') return t.skip('FFmpeg is required for real verification');
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-verify-formats-'));
  try {
    const p = validateProject(demoProject()); p.duration = 1; p.fps = 24; for (const layer of p.layers) { layer.start = 0; layer.end = 1; layer.fadeIn = 0; layer.fadeOut = 0; }
    const source = 'color=c=blue@0.5:s=1080x1080:r=24:d=1,format=rgba';
    const mov = path.join(folder, 'video.mov'), mp4 = path.join(folder, 'video.mp4');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', source, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', mov]);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
    assert.equal((await verifyExport(p, mov, { format: 'mov', transparent: true })).width, 1080);
    await assert.rejects(verifyExport(p, mp4, { format: 'mov' }), /verification failed/);
    await assert.rejects(verifyExport(p, mov, { format: 'mp4' }), /verification failed/);
    const frames = path.join(folder, 'frames');
    await mkdir(frames);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', source, '-start_number', '1', path.join(frames, 'frame_%06d.png')]);
    const entries = (await readdir(frames)).sort().map((name, i) => ({ name: `frames/frame_${String(i + 1).padStart(6, '0')}.png`, file: path.join(frames, name) }));
    assert.equal(entries.length, 24);
    const zip = path.join(folder, 'frames.zip'), short = path.join(folder, 'short.zip');
    await writeStoredZip(zip, entries);
    assert.deepEqual(await verifyExport(p, zip, { format: 'png' }), { width: 1080, height: 1080, fps: 24, duration: 1 });
    if (!spawnSync('unzip', ['-v']).error) await run('unzip', ['-tq', zip]);
    await assert.rejects(verifyExport(p, zip, { format: 'png', resolution: '2160p' }), /verification failed/);
    await writeStoredZip(short, entries.slice(1));
    await assert.rejects(verifyExport(p, short, { format: 'png' }), /verification failed/);
    await assert.rejects(verifyExport(p, mov, { format: 'png' }), /verification failed/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('2160p doubles every aspect ratio without modifying the project', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-export-settings-'));
  try {
    for (const format of Object.keys(FORMATS)) {
      const p = validateProject({ ...demoProject(), format });
      const before = structuredClone(p);
      const dimensions = FORMATS[format].map(value => value * 2);
      assert.deepEqual(exportDimensions(format, '2160p'), dimensions);
      assert.deepEqual(exportDimensions(format, '1080p'), FORMATS[format]);
      await prepareComposition(p, folder, { resolution: '2160p' });
      const html = await readFile(path.join(folder, 'index.html'), 'utf8');
      const config = JSON.parse(await readFile(path.join(folder, 'hyperframes.json'), 'utf8'));
      assert.deepEqual([config.width, config.height], dimensions);
      assert(html.includes(`data-width="${dimensions[0]}" data-height="${dimensions[1]}"`));
      assert(html.includes('data-render-scale="2"'));
      assert(html.includes(`width="${FORMATS[format][0]}" height="${FORMATS[format][1]}"`));
      assert.deepEqual(p, before);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('60 fps validates, round-trips and is available to agents', async () => {
  let p = validateProject({ ...demoProject(), fps: 60 });
  assert.equal(validateProject(JSON.parse(JSON.stringify(p))).fps, 60);
  assert.throws(() => validateProject({ ...p, fps: 120 }), /Frame rate/);
  const tool = createTools({ get: () => p, set: value => { p = value; }, save: async () => {}, audit: () => {} }).find(item => item.name === 'floc_set_output');
  assert(tool.inputSchema.properties.fps.enum.includes(60));
  await tool.execute({ fps: 24 });
  await tool.execute({ fps: 60 });
  assert.equal(p.fps, 60);
});

test('standalone exports keep Paper notices and saved layer-effect settings', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-paper-export-'));
  try {
    for (const { id: layerEffect } of CAROUSEL_EFFECTS) {
      const project = patchLayer(demoProject(), 'carousel', { shader: 'elastic', layerEffect, layerEffectIntensity: 0.6, halftoneSize: 0.4, ditheringSize: 0.5, ditheringSteps: 3, glassSize: 0.6, glassDistortion: 0.7 });
      await prepareComposition(project, folder);
      assert.match(await readFile(path.join(folder, 'licenses/paper-shaders/LICENSE'), 'utf8'), /Apache License/);
      assert.match(await readFile(path.join(folder, 'licenses/paper-shaders/NOTICE'), 'utf8'), /Powered by Paper Shaders/);
      const html = await readFile(path.join(folder, 'index.html'), 'utf8');
      const serialized = html.match(/data-floc-project="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const carousel = JSON.parse(serialized).layers.find(layer => layer.type === 'carousel');
      assert.equal(carousel.shader, 'elastic');
      assert.equal(carousel.layerEffect, layerEffect);
      assert.equal(carousel.layerEffectIntensity, 0.6);
      assert.equal(carousel.halftoneSize, 0.4);
      assert.equal(carousel.ditheringSize, 0.5);
      assert.equal(carousel.ditheringSteps, 3);
      assert.equal(carousel.glassSize, 0.6);
      assert.equal(carousel.glassDistortion, 0.7);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('failed exports persist their error so it survives a server restart', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'floc-export-failure-'));
  const previousData = process.env.FLOC_DATA_DIR;
  process.env.FLOC_DATA_DIR = folder;
  try {
    const project = demoProject();
    project.images = [{ id: 'missing', name: 'Missing video', src: '/assets/12345678-1234-1234-1234-123456789abc.mp4' }];
    const job = await startExport(project);
    let persisted;
    for (let attempt = 0; attempt < 100; attempt++) {
      // job.json is written as queued first; wait for the failure to be persisted.
      try { persisted = JSON.parse(await readFile(path.join(folder, 'renders', job.id, 'job.json'), 'utf8')); if (persisted.state === 'failed') break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(persisted?.state, 'failed');
    assert.match(persisted.message, /12345678-1234-1234-1234-123456789abc.mp4/);
    assert.equal(persisted.id, job.id);
    assert.match(await readFile(path.join(folder, 'renders', job.id, 'render.log'), 'utf8'), /12345678-1234-1234-1234-123456789abc.mp4/);
  } finally {
    if (previousData === undefined) delete process.env.FLOC_DATA_DIR; else process.env.FLOC_DATA_DIR = previousData;
    await rm(folder, { recursive: true, force: true });
  }
});

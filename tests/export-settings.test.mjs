import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoProject, FORMATS, CAROUSEL_EFFECTS, patchLayer, validateProject } from '../src/project.js';
import { exportDimensions, validateExportSettings } from '../src/export-settings.js';
import { prepareComposition, startExport, jobs } from '../server/export.mjs';
import { createTools } from '../src/webmcp.js';

test('invalid export settings fail before queuing a render', async () => {
  const count = jobs.size;
  for (const settings of [null, [], { quality: 'ultra' }, { quality: null }, { resolution: '8k' }, { resolution: 2160 }]) {
    assert.throws(() => validateExportSettings(settings));
    await assert.rejects(startExport(demoProject(), settings));
  }
  assert.equal(jobs.size, count);
  assert.deepEqual(validateExportSettings(), { quality: 'high', resolution: '1080p' });
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
      try { persisted = JSON.parse(await readFile(path.join(folder, 'renders', job.id, 'job.json'), 'utf8')); break; } catch {}
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

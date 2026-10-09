import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/webmcp.js';
import { demoProject } from '../src/project.js';
import { MAX_PROJECT_IMPORT_BYTES, parseProjectFile } from '../src/editor/project-import.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('overlapping agent mutations serialize against the latest project', async () => {
  let project = demoProject(); const firstSave = deferred(); let saves = 0; const audits = [];
  const tools = createTools({ get: () => project, set: next => project = next, save: () => ++saves === 1 ? firstSave.promise : Promise.resolve(), audit: name => audits.push(name) });
  const shader = tools.find(tool => tool.name === 'floc_set_shader').execute({ shader: 'wave', intensity: .4 });
  const output = tools.find(tool => tool.name === 'floc_set_output').execute({ duration: 15, fps: 30 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saves, 1); firstSave.resolve(); await Promise.all([shader, output]);
  assert.equal(project.layers.find(layer => layer.type === 'carousel').shader, 'wave');
  assert.equal(project.duration, 15); assert.equal(project.fps, 30); assert.equal(saves, 2);
  assert.deepEqual(audits, ['floc_set_shader', 'floc_set_output']);
});

test('failed agent saves retain local state, reject the tool, and do not create an audit entry', async () => {
  let project = demoProject(), fail = true; const audits = [];
  const tools = createTools({ get: () => project, set: next => project = next, save: async () => { if (fail) throw Object.assign(new Error('Sign in again'), { status: 401 }); }, audit: name => audits.push(name) });
  const shader = tools.find(tool => tool.name === 'floc_set_shader');
  await assert.rejects(shader.execute({ shader: 'wave' }), /Sign in again/);
  assert.equal(project.layers.find(layer => layer.type === 'carousel').shader, 'wave');
  assert.deepEqual(audits, []);
  fail = false; await tools.find(tool => tool.name === 'floc_set_output').execute({ fps: 30 });
  assert.equal(project.layers.find(layer => layer.type === 'carousel').shader, 'wave'); assert.equal(project.fps, 30);
  assert.deepEqual(audits, ['floc_set_output']);
});

test('project import rejects oversized content before reading and validates bounded JSON', async () => {
  let reads = 0;
  await assert.rejects(parseProjectFile({ size: MAX_PROJECT_IMPORT_BYTES + 1, async text() { reads++; return '{}'; } }), /2 MB/);
  assert.equal(reads, 0);
  const source = JSON.stringify(demoProject());
  assert.equal((await parseProjectFile({ size: Buffer.byteLength(source), async text() { return source; } })).name, demoProject().name);
  await assert.rejects(parseProjectFile({ size: 1, async text() { return 'x'.repeat(MAX_PROJECT_IMPORT_BYTES + 1); } }), /2 MB/);
});

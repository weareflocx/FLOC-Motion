import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROCEDURAL_BACKGROUND, PROCEDURAL_BACKGROUNDS, drawProceduralBackground } from '../src/backgrounds.js';
import { stageMarkup } from '../src/scene.js';
import { demoProject, validateProject } from '../src/project.js';

function commands(layer, time, width = 1080, height = 1920) {
  const output = [];
  const context = new Proxy({}, {
    get: (_, property) => (...values) => output.push([property, ...values]),
    set: (_, property, value) => { output.push([property, value]); return true; }
  });
  const canvas = { width, height, getContext: kind => { assert.equal(kind, '2d'); return context; } };
  drawProceduralBackground(canvas, { color: '#141414', ...DEFAULT_PROCEDURAL_BACKGROUND, ...layer }, time);
  return output;
}

test('the curated patterns are distinct, seeded and seek-safe', () => {
  const patterns = PROCEDURAL_BACKGROUNDS.map(({ id }) => id);
  assert.deepEqual(patterns, ['grid', 'grain', 'waves', 'geometry', 'dots', 'stripes', 'checkerboard', 'rings', 'rays', 'mesh', 'flow', 'halftone']);
  const outputs = patterns.map(pattern => commands({ pattern }, 2));
  assert.equal(new Set(outputs.map(output => JSON.stringify(output))).size, patterns.length);
  for (const pattern of patterns) {
    const before = commands({ pattern }, 0.4);
    commands({ pattern }, 8);
    assert.deepEqual(commands({ pattern }, 0.4), before);
    assert.notDeepEqual(commands({ pattern, patternSeed: 37 }, 0.4), before);
    assert.notDeepEqual(commands({ pattern }, 1.7), before);
    assert.deepEqual(commands({ pattern, patternSpeed: 0 }, 0), commands({ pattern, patternSpeed: 0 }, 80));
  }
});

test('native resolution scales the same geometry while drawing work remains bounded', () => {
  for (const { id: pattern } of PROCEDURAL_BACKGROUNDS) {
    const normal = commands({ pattern, patternScale: 4 }, 1);
    const high = commands({ pattern, patternScale: 4 }, 1, 2160, 3840);
    const geometry = output => output.filter(([name]) => !['setTransform', 'clearRect'].includes(name)).map(command => command[0] === 'fillRect' && command[1] === 0 && command[2] === 0 && command[3] >= 1080 ? ['base fill'] : command);
    assert.deepEqual(geometry(normal), geometry(high));
    assert(normal.length < 15000);
    for (const command of high) for (const value of command.slice(1)) if (typeof value === 'number') assert(Number.isFinite(value));
    assert.deepEqual(high.filter(([name]) => name === 'setTransform')[1], ['setTransform', 2, 0, 0, 2, 0, 0]);
  }
});

test('base color and intensity remain independent and missing contexts are harmless', () => {
  const output = commands({ pattern: 'geometry', color: '#123456', patternColor: '#abcdef', patternIntensity: 0 }, 1);
  assert(output.some(command => command[0] === 'fillStyle' && command[1] === '#123456'));
  assert(output.some(command => command[0] === 'strokeStyle' && command[1] === '#abcdef'));
  assert(output.some(command => command[0] === 'globalAlpha' && command[1] === 0));
  assert.doesNotThrow(() => drawProceduralBackground({ width: 1080, height: 1080, getContext: () => null }, {}, 0));
});

test('procedural stage markup has native dimensions, timing and authored stacking', () => {
  const p = validateProject(demoProject());
  const background = p.layers.find(layer => layer.type === 'background');
  const markup = stageMarkup({ ...p, format: 'portrait', layers: [{ ...background, mode: 'procedural', visible: false, start: 2, end: 7 }] });
  assert.match(markup, /id="background-background"/);
  assert.match(markup, /width="1080" height="1920"/);
  assert.match(markup, /data-start="2" data-duration="5" data-track-index="0"/);
  assert.match(markup, /z-index:0;opacity:0/);
  assert.doesNotMatch(markup, /<img|<video/);
  const legacy = stageMarkup({ ...p, layers: [background] });
  assert.match(legacy, /background:#/);
  assert.doesNotMatch(legacy, /<canvas/);
});

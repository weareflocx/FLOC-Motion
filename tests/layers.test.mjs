import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_LIMITS, assertLocksRespected, blankProject, demoProject, validateProject, patchLayer, reorderLayer, duplicateLayer } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';

test('legacy layers migrate unlocked and reject invalid lock states without mutation', () => {
  const raw = demoProject(); const p = validateProject(raw);
  assert.ok(p.layers.every(l => l.locked === false)); assert.equal(raw.layers[0].locked, undefined);
  for (const invalid of ['true', 1, null]) {
    const input = demoProject(); input.layers[0].locked = invalid;
    assert.throws(() => validateProject(input), /lock must be a boolean/);
  }
});
test('locked content and timing cannot be patched, but visibility and unlocking remain available', () => {
  const p = patchLayer(demoProject(), 'headline', { locked: true });
  assert.throws(() => patchLayer(p, 'headline', { text: 'accident' }), /Unlock/);
  assert.throws(() => patchLayer(p, 'headline', { start: 1 }), /Unlock/);
  assert.throws(() => patchLayer(p, 'headline', { fadeIn: 1 }), /Unlock/);
  assert.throws(() => patchLayer(p, 'headline', { locked: false, size: 80 }), /Unlock/);
  const hidden = patchLayer(p, 'headline', { visible: false }); assert.equal(hidden.layers.find(l => l.id === 'headline').visible, false);
  const unlocked = patchLayer(p, 'headline', { locked: false });
  assert.equal(patchLayer(unlocked, 'headline', { name: 'Title' }).layers.find(l => l.id === 'headline').name, 'Title');
  assert.equal(stageMarkup(p), stageMarkup(validateProject(demoProject())));
});
test('drag order matches front-to-back list while preserving identities and source', () => {
  const p = validateProject(demoProject());
  const moved = reorderLayer(p, 'headline', 'logo', 'above');
  assert.ok(moved.layers.findIndex(l => l.id === 'headline') > moved.layers.findIndex(l => l.id === 'logo'));
  assert.throws(() => reorderLayer(moved, 'headline', 'background', 'below'), /background/i);
  assert.equal(p.layers[0].id, 'background');
  assert.throws(() => reorderLayer(patchLayer(p, 'headline', { locked: true }), 'headline', 'logo'), /Unlock/);
  assert.throws(() => reorderLayer(p, 'missing', 'logo'), /not found/);
});
test('duplication preserves media and timing, inserts above the source, supports multiple carousels and respects layer limits', () => {
  const p = validateProject(demoProject());
  const copied = duplicateLayer(p, 'headline', 'headline-copy');
  const index = copied.layers.findIndex(l => l.id === 'headline');
  const copy = copied.layers[index + 1]; assert.equal(copy.id, 'headline-copy'); assert.equal(copy.name, 'Headline copy'); assert.equal(copy.text, p.layers[index].text); assert.equal(copy.start, p.layers[index].start);
  assert.equal(p.layers.length, 6); assert.equal(duplicateLayer(p, 'logo', 'logo-copy').layers.find(l => l.id === 'logo-copy').src, p.layers.find(l => l.id === 'logo').src);
  const carouselCopy = duplicateLayer(p, 'carousel', 'carousel-copy');
  assert.deepEqual(carouselCopy.layers.find(l => l.id === 'carousel-copy').images, p.images);
  assert.throws(() => duplicateLayer(p, 'background', 'background-copy'), /background/i);
  assert.equal(duplicateLayer(p, 'music', 'music-copy').layers.filter(l => l.type === 'music').length, 2);
  assert.throws(() => duplicateLayer(p, 'headline', 'logo'), /unique/);
  let full = p; for (let i = p.layers.length; i < PROJECT_LIMITS.maxLayers; i++) full = duplicateLayer(full, 'headline', `copy-${i}`);
  assert.equal(full.layers.length, PROJECT_LIMITS.maxLayers);
  assert.throws(() => duplicateLayer(full, 'headline', 'over-limit'), new RegExp(`${PROJECT_LIMITS.maxLayers} layers`));
});
test('agent updates obey the same layer lock', async () => {
  const p = patchLayer(demoProject(), 'carousel', { locked: true });
  const tools = createTools({ get: () => p, change() { throw new Error('Should not mutate'); }, audit() {} });
  await assert.rejects(() => tools.find(t => t.name === 'floc_update_layer').execute({ id: 'carousel', patch: { speed: 20 } }), /Unlock/);
});

test('new compositions have an editable white background whose identity and stacking survive edits', () => {
  const p = validateProject(blankProject());
  const background = p.layers[0];
  assert.deepEqual([background.type, background.color, background.locked, background.visible], ['background', '#ffffff', false, true]);
  const edited = patchLayer(p, background.id, { color: '#123456', mode: 'procedural', pattern: 'grid' });
  assert.equal(assertLocksRespected(p, edited), edited);
  assert.equal(edited.layers[0].color, '#123456');
  assert.throws(() => assertLocksRespected(p, { ...p, layers: [] }), /background/i);
  assert.throws(() => assertLocksRespected(p, { ...p, layers: [{ ...background, id: 'replacement' }] }), /background/i);
  assert.throws(() => assertLocksRespected(p, { ...p, layers: [...p.layers, { ...background, id: 'extra' }] }), /background/i);
  const content = validateProject(demoProject());
  assert.throws(() => assertLocksRespected(content, { ...content, layers: [...content.layers.slice(1), content.layers[0]] }), /background/i);
  assert.throws(() => reorderLayer(content, 'background', 'headline'), /background/i);
});

test('legacy backgrounds keep their authored appearance, including empty and multiple-background stacks', () => {
  const legacy = demoProject();
  legacy.layers.push({ ...legacy.layers[0], id: 'second-background', color: '#123456', opacity: .25 });
  const p = validateProject(legacy);
  assert.equal(stageMarkup(p), stageMarkup(legacy));
  const next = patchLayer(p, 'headline', { text: 'Still editable' });
  assert.equal(assertLocksRespected(p, next), next);
  assert.deepEqual(next.layers.filter(layer => layer.type === 'background'), p.layers.filter(layer => layer.type === 'background'));
  const empty = validateProject({ ...legacy, layers: [] });
  assert.deepEqual(empty.layers, [], 'opening an older transparent document must not paint it white');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEffects, effectLayer } from '../src/effects.js';
import { demoProject, validateProject, layerAlpha, FORMATS, reorderLayer } from '../src/project.js';

// Minimal DOM adapter: assertions exercise composite ownership and timeline
// behavior. Actual filter pixels are also checked in a real browser.
class Node {
  constructor(tag = 'div') { this.tagName = tag; this.childNodes = []; this.style = { filter: '' }; this.dataset = {}; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.childNodes.push(node); } }
  prepend(node) { this.append(node); this.childNodes.splice(this.childNodes.indexOf(node), 1); this.childNodes.unshift(node); }
  before(node) { node.remove(); node.parentElement = this.parentElement; this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 0, node); }
  remove() { if (this.parentElement) this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 1); this.parentElement = null; }
  replaceWith(...nodes) { nodes.forEach(node => this.before(node)); this.remove(); }
  querySelectorAll() { return this.childNodes.flatMap(node => [...(node.dataset.flocLayer ? [node] : []), ...node.querySelectorAll()]); }
}
function fixture(project) {
  const root = new Node();
  const nodes = Object.fromEntries(project.layers.map(layer => { const node = new Node(); node.dataset.flocLayer = layer.id; root.append(node); return [layer.id, node]; }));
  const originalDocument = globalThis.document, originalImage = globalThis.Image;
  globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
  globalThis.Image = class { decode() { return Promise.resolve(); } };
  try {
    const effects = createEffects(root, project, FORMATS, layerAlpha);
    return { root, nodes, effects };
  } finally { globalThis.document = originalDocument; globalThis.Image = originalImage; }
}
function projectWithAdjustment(mode = 'uniform') {
  const demo = demoProject();
  return validateProject({ ...demo, layers: [demo.layers[0], { ...effectLayer('adjustment', 12), start: 2, end: 8, fadeIn: 1, fadeOut: 1, effects: [{ type: 'blur', mode, amount: 24 }] }, demo.layers[2]] });
}

test('adjustment affects only the composite below, follows fades and restores on reverse seeks', async () => {
  const project = projectWithAdjustment();
  const { root, nodes, effects } = fixture(project);
  const composite = nodes.background.parentElement;
  assert.notEqual(composite, root);
  assert.equal(nodes.headline.parentElement, root);
  for (const [time, filter] of [[0, ''], [2.5, 'blur(12px)'], [4, 'blur(24px)'], [7.5, 'blur(12px)'], [8, ''], [4, 'blur(24px)']]) {
    await effects.seek(time);
    assert.equal(composite.style.filter, filter);
    assert.equal(nodes.headline.style.filter, '');
  }
  effects.updateLayers(project.layers.map(layer => layer.id === 'adjustment' ? { ...layer, visible: false } : layer));
  await effects.seek(4); assert.equal(composite.style.filter, '');
  effects.dispose();
  assert.deepEqual(root.childNodes.map(node => node.dataset.flocLayer), project.layers.map(layer => layer.id));
});

test('moving an adjustment changes its targets and multiple adjustments preserve stack order', async () => {
  const original = projectWithAdjustment();
  const project = validateProject({ ...reorderLayer(original, 'adjustment', 'headline', 'above'), layers: [...reorderLayer(original, 'adjustment', 'headline', 'above').layers, { ...effectLayer('second', 12), effects: [{ type: 'monochrome', amount: .75 }] }] });
  const { root, nodes, effects } = fixture(project);
  assert.equal(nodes.background.parentElement, nodes.headline.parentElement);
  const first = nodes.background.parentElement, second = first.parentElement;
  assert.notEqual(second, root);
  await effects.seek(4);
  assert.equal(first.style.filter, 'blur(24px)');
  assert.equal(second.style.filter, 'grayscale(0.75)');
  await effects.seek(0);
  assert.equal(first.style.filter, '');
  assert.equal(second.style.filter, 'grayscale(0.75)');
  effects.dispose();
  assert.deepEqual(root.childNodes.map(node => node.dataset.flocLayer), project.layers.map(layer => layer.id));
});

test('progressive blur radii track opacity without fading the underlying composition', async () => {
  const project = projectWithAdjustment('progressive');
  const { root, nodes, effects } = fixture(project);
  const primitiveNodes = node => [node, ...node.childNodes.flatMap(primitiveNodes)];
  const blurs = primitiveNodes(root).filter(node => node.tagName === 'feGaussianBlur');
  await effects.seek(4);
  assert.deepEqual(blurs.map(node => node.attributes.stdDeviation), ['6', '12', '18', '24']);
  await effects.seek(2.5);
  assert.deepEqual(blurs.map(node => node.attributes.stdDeviation), ['3', '6', '9', '12']);
  assert.equal(nodes.background.parentElement.style.opacity, undefined);
  await effects.seek(8); assert.equal(nodes.background.parentElement.style.filter, '');
  effects.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_LIMITS, demoProject, duplicateLayer, linkFormats, patchLayer, resizeDuration, validateProject } from '../src/project.js';
import { captureState, evaluateChoreography } from '../src/choreography.js';
import { createTools } from '../src/webmcp.js';
import { renderTimeoutMs } from '../server/export.mjs';

const images = count => Array.from({ length: count }, (_, i) => ({ id: `card-${i}`, src: `/demo/poster-${i % 6 + 1}.svg`, name: `Card ${i}` }));
const fill = count => { let p = validateProject(demoProject()); for (let i = p.layers.length; i < count; i++) p = duplicateLayer(p, 'headline', `copy-${i}`); return p; };

test('duration accepts the documented range and rejects one step past either end', () => {
  const { minDuration, maxDuration } = PROJECT_LIMITS;
  assert.equal(resizeDuration(demoProject(), maxDuration).duration, maxDuration);
  assert.equal(resizeDuration(demoProject(), minDuration).duration, minDuration);
  assert.throws(() => resizeDuration(demoProject(), maxDuration + 0.01), new RegExp(`Duration must be between ${minDuration} and ${maxDuration}`));
  assert.throws(() => resizeDuration(demoProject(), minDuration - 0.01), /Duration must be between/);
  // Projects saved under the previous 30 s ceiling stay valid unchanged.
  assert.equal(resizeDuration(demoProject(), 30).duration, 30);
});

test('layer count accepts the maximum and rejects one more, including linked formats', () => {
  const full = fill(PROJECT_LIMITS.maxLayers);
  assert.equal(validateProject(full).layers.length, PROJECT_LIMITS.maxLayers);
  assert.equal(validateProject(linkFormats(full)).linkedFormats.layouts[full.format] !== undefined, true);
  const over = { ...full, layers: [...full.layers, { ...full.layers.find(l => l.id === 'headline'), id: 'one-more' }] };
  assert.throws(() => validateProject(over), new RegExp(`Use up to ${PROJECT_LIMITS.maxLayers} layers`));
});

test('shared and per-carousel media accept the maximum and reject one more', () => {
  const { maxImages } = PROJECT_LIMITS;
  assert.equal(validateProject({ ...demoProject(), images: images(maxImages) }).images.length, maxImages);
  assert.throws(() => validateProject({ ...demoProject(), images: images(maxImages + 1) }), new RegExp(`Use up to ${maxImages} images`));
  const cards = patchLayer(demoProject(), 'carousel', { images: images(maxImages), cardCount: PROJECT_LIMITS.maxCardCount });
  assert.equal(cards.layers.find(l => l.id === 'carousel').images.length, maxImages);
  assert.throws(() => patchLayer(demoProject(), 'carousel', { images: images(maxImages + 1) }), new RegExp(`Use up to ${maxImages} carousel cards`));
  assert.throws(() => patchLayer(demoProject(), 'carousel', { cardCount: PROJECT_LIMITS.maxCardCount + 1 }), /Card count/);
});

test('keyframes can be placed late in a long layer and survive validation', () => {
  const p = resizeDuration(demoProject(), PROJECT_LIMITS.maxDuration);
  const layer = p.layers.find(l => l.id === 'headline');
  const late = PROJECT_LIMITS.maxDuration - 10;
  let choreography = captureState(layer, 0, p.fps);
  choreography = captureState({ ...layer, choreography }, late, p.fps, { x: 70 });
  assert.equal(choreography.at(-1).time, late);
  const next = patchLayer(p, 'headline', { choreography });
  assert.equal(evaluateChoreography(next.layers.find(l => l.id === 'headline'), late).x, 70);
});

test('agents can set the longest duration but not exceed it', async () => {
  let project = validateProject(demoProject());
  const tools = createTools({ get: () => project, set(next) { project = next; return next; }, async save() {}, audit() {} });
  const output = tools.find(tool => tool.name === 'floc_set_output');
  await output.execute({ duration: PROJECT_LIMITS.maxDuration });
  assert.equal(project.duration, PROJECT_LIMITS.maxDuration);
  assert(project.layers.every(l => l.end === PROJECT_LIMITS.maxDuration));
  await assert.rejects(() => output.execute({ duration: PROJECT_LIMITS.maxDuration + 1 }), /Duration/);
  assert.equal(project.duration, PROJECT_LIMITS.maxDuration);
});

test('the longest 2160p60 export gets enough capture time while short exports keep the 20-minute bound', () => {
  const longest = { format: 'landscape', duration: PROJECT_LIMITS.maxDuration, fps: 60 };
  // Measured capture cost of the heaviest limit composition: up to ~2.5 s per 1080p-equivalent frame per worker; 2160p has 4× the pixels.
  const singleWorkerSeconds = PROJECT_LIMITS.maxDuration * 60 * 4 * 2.5;
  assert(renderTimeoutMs(longest, { resolution: '2160p' }) > singleWorkerSeconds * 1000 * 2);
  assert(renderTimeoutMs(longest, { resolution: '2160p' }) > renderTimeoutMs(longest, { resolution: '1080p' }));
  assert(renderTimeoutMs(longest, { resolution: '2160p' }) < 2 ** 31 - 1, 'timer delays above 2^31-1 ms fire immediately');
  assert.equal(renderTimeoutMs({ format: 'square', duration: 6, fps: 24 }, { resolution: '1080p' }), 20 * 60 * 1000);
});

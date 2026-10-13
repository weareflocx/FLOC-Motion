import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_FITS, MOTION_VARIANTS, cardMetrics, carouselCard, ringRadius } from '../src/carousel-motion.js';
import { DEFAULT_MOTION } from '../src/motion-timing.js';
import { FORMAT_LOCAL_FIELDS } from '../src/linked-formats.js';
import { demoProject, linkFormats, patchLayer, switchFormat, validateProject } from '../src/project.js';
import { sceneUpdatePlan } from '../src/scene-update.js';
import { createTools } from '../src/webmcp.js';

const TAU = Math.PI * 2;
const mod = (value, period) => ((value % period) + period) % period;
// Portrait, square and landscape media; the 16:9 card is three times as wide as the 9:16 card.
const MEDIA = [9 / 16, 1, 16 / 9, 4 / 5, 3 / 2, 2 / 3, 1, 16 / 9];
const LOOP = 4;
const MOTIONS = { continuous: DEFAULT_MOTION, eased: { ...DEFAULT_MOTION, curve: 'linear' }, steps: { mode: 'steps', action: 0.3, pause: 0.2, curve: 'native', intensity: 0.5 } };
const layer = (template, fields = {}) => ({ ...demoProject().layers[1], start: 0, loopDuration: LOOP, speed: 30, tilt: 0, yaw: 0, roll: 0, size: 1.1, gap: 0.2, cardAspect: 0.8, template, ...fields });
const times = Array.from({ length: 97 }, (_, i) => i * LOOP / 96 + 0.0137);
const cards = (l, metrics, time) => metrics.widths.map((_, i) => carouselCard(l, i, metrics.widths.length, time, metrics));
const near = (actual, expected, message, epsilon = 1e-9) => assert(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`);
const height = (metrics, i) => metrics.widths[i] / metrics.aspects[i];
const variants = template => MOTION_VARIANTS[template].length ? MOTION_VARIANTS[template].map(([id]) => id) : ['default'];

// Every gap between neighbours along a path, edge to edge, after sorting by
// path coordinate; `scale` is the share of each width that takes up the path.
function edgeGaps(metrics, coordinates, scale = 1) {
  const order = coordinates.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  return order.slice(1).map((card, i) => card.value - order[i].value - (metrics.widths[card.index] + metrics.widths[order[i].index]) * scale / 2);
}
const pathLength = (metrics, gap, scale = 1) => metrics.widths.reduce((sum, width) => sum + width * scale + gap, 0);

test('per-image cards keep their media aspect and share the fixed card height or width', () => {
  const base = layer('horizontal', { size: 1.2 });
  const fixed = cardMetrics(base, MEDIA);
  assert.equal(fixed.perCard, false);
  assert.deepEqual([...new Set(fixed.widths)], [1.2]);
  assert.deepEqual([...new Set(fixed.aspects)], [0.8]);
  const sameHeight = cardMetrics({ ...base, cardFit: 'height' }, MEDIA);
  assert.equal(sameHeight.perCard, true);
  assert.deepEqual(sameHeight.aspects, MEDIA);
  MEDIA.forEach((_, i) => near(height(sameHeight, i), 1.2 / 0.8, `card ${i} height`));
  const sameWidth = cardMetrics({ ...base, cardFit: 'width' }, MEDIA);
  assert.deepEqual(sameWidth.aspects, MEDIA);
  assert.deepEqual([...new Set(sameWidth.widths)], [1.2]);
  // Extreme or unknown media stay within the card aspect limits.
  assert.deepEqual(cardMetrics({ ...base, cardFit: 'height' }, [10, 0.1, NaN, 0, Infinity]).aspects, [4, 0.25, 0.8, 0.8, 0.8]);
  // Window Push keeps its window ratio.
  assert.equal(cardMetrics({ ...base, template: 'window-push', cardFit: 'height' }, MEDIA).perCard, false);
  assert.equal(CARD_FITS[0], 'fixed');
});

test('fixed cards and Window Push ignore media aspects and move exactly as without metrics', () => {
  for (const [template, list] of Object.entries(MOTION_VARIANTS)) for (const motionVariant of ['default', ...list.map(([id]) => id)]) {
    for (const motion of Object.values(MOTIONS)) for (const count of [1, 6, 8]) {
      const fits = template === 'window-push' ? ['fixed', 'height', 'width', undefined] : ['fixed', undefined];
      for (const cardFit of fits) {
        const l = layer(template, { motionVariant, motion, cardFit });
        const metrics = cardMetrics(l, MEDIA.slice(0, count));
        for (const time of [0, 0.37, 1.9, 3.3]) for (let i = 0; i < count; i++) assert.deepEqual(carouselCard(l, i, count, time, metrics), carouselCard(l, i, count, time), `${template}/${motionVariant}/${cardFit}`);
      }
    }
  }
});

test('strip and flip cards keep equal edge gaps with mixed widths, never overlap and close the loop', () => {
  for (const [template, extra] of [['horizontal', 0], ['flip', 0.25]]) for (const cardFit of ['height', 'width']) for (const [name, motion] of Object.entries(MOTIONS)) {
    for (const motionVariant of variants(template)) {
      const l = layer(template, { cardFit, motion, motionVariant });
      const metrics = cardMetrics(l, MEDIA);
      const label = `${template}/${motionVariant}/${cardFit}/${name}`;
      for (const time of times) {
        const states = cards(l, metrics, time);
        // The scale of Focus changes apparent gaps; its path spacing is still checked.
        edgeGaps(metrics, states.map(card => card.position[0])).forEach(gap => near(gap, l.gap + extra, `${label} gap at ${time}`));
        states.forEach((state, i) => {
          const later = carouselCard(l, i, MEDIA.length, time + 1e-5, metrics);
          if (state.opacity > 1e-3 && later.opacity > 1e-3) assert(Math.abs(later.position[0] - state.position[0]) < 0.02, `${label} card ${i} jumps at ${time}`);
          const looped = carouselCard(l, i, MEDIA.length, time + LOOP, metrics);
          state.position.forEach((value, axis) => near(looped.position[axis], value, `${label} loop`, 1e-6));
          near(looped.opacity, state.opacity, `${label} loop opacity`, 1e-6);
        });
      }
      // The first card starts centred.
      near(carouselCard(l, 0, MEDIA.length, 0, metrics).position[0], 0, `${label} start`);
    }
  }
  // Stepped flips rest with a card centred and the others spaced around it.
  const l = layer('flip', { cardFit: 'height' });
  const metrics = cardMetrics(l, MEDIA);
  const resting = cards(l, metrics, LOOP / MEDIA.length * 3 + 0.01);
  near(resting[3].position[0], 0, 'flip rest');
  near(resting[4].position[0], (metrics.widths[3] + metrics.widths[4]) / 2 + l.gap + 0.25, 'flip neighbour');
});

test('ring cards take angular shares proportional to their widths', () => {
  for (const [template, list] of [['circular', variants('circular')], ['wheel', ['ring']]]) for (const motionVariant of list) for (const cardFit of ['height', 'width']) for (const [name, motion] of Object.entries(MOTIONS)) {
    const l = layer(template, { cardFit, motion, motionVariant });
    const metrics = cardMetrics(l, MEDIA);
    const length = pathLength(metrics, l.gap);
    const radius = ringRadius(l, MEDIA.length, metrics, template === 'wheel' ? 2.2 : 1.45);
    const label = `${template}/${motionVariant}/${cardFit}/${name}`;
    if (template === 'circular') near(radius, length / TAU, `${label} radius`);
    for (const time of times) {
      const states = cards(l, metrics, time);
      const angles = states.map(card => template === 'wheel' ? -card.rotation[2] : Math.atan2(card.position[0], card.position[2]));
      states.forEach(card => near(Math.hypot(card.position[0], template === 'wheel' ? card.position[1] : card.position[2]), radius, `${label} on ring`));
      // Path coordinate of each card around the ring, then each edge gap to the next card.
      const along = angles.map(angle => mod(angle, TAU) * length / TAU);
      const order = along.map((_, i) => i).sort((a, b) => along[a] - along[b]);
      order.forEach((card, k) => {
        const next = order[(k + 1) % order.length];
        near(mod(along[next] - along[card], length) - (metrics.widths[card] + metrics.widths[next]) / 2, l.gap, `${label} gap at ${time}`, 1e-8);
      });
      states.forEach((state, i) => {
        const looped = carouselCard(l, i, MEDIA.length, time + LOOP, metrics);
        state.position.forEach((value, axis) => near(looped.position[axis], value, `${label} loop`, 1e-6));
      });
    }
  }
});

test('rocking wheel and showcase queue space neighbours by their own widths', () => {
  for (const cardFit of ['height', 'width']) {
    const wheel = layer('wheel', { cardFit, motionVariant: 'rock' });
    const metrics = cardMetrics(wheel, MEDIA);
    const r = ringRadius(wheel, MEDIA.length, metrics, 2.2);
    for (const time of times) {
      const angles = cards(wheel, metrics, time).map(card => -card.rotation[2]);
      for (let i = 1; i < MEDIA.length; i++) near((angles[i] - angles[i - 1]) * r, (metrics.widths[i] + metrics.widths[i - 1]) * 0.4 / 2 + wheel.gap, `rock ${cardFit} ${i}`);
      near(angles[0] + angles.at(-1), 2 * Math.sin(time / LOOP * TAU) * 0.45, `rock ${cardFit} centred`);
    }
    const showcase = layer('showcase', { cardFit });
    const queue = cardMetrics(showcase, MEDIA);
    for (const time of times) {
      const states = cards(showcase, queue, time);
      edgeGaps(queue, states.map(card => card.position[0]), 0.6).forEach(gap => near(gap, showcase.gap, `showcase ${cardFit} gap at ${time}`));
      states.forEach((state, i) => {
        const looped = carouselCard(showcase, i, MEDIA.length, time + LOOP, queue);
        state.position.forEach((value, axis) => near(looped.position[axis], value, 'showcase loop', 1e-6));
      });
    }
  }
});

test('centred families only resize each card; stacked shuffle cards keep their own top strip', () => {
  for (const template of ['sphere', 'spinner', 'stack', 'stickers', 'zoom-through', 'sweep-reveal']) for (const motionVariant of variants(template)) {
    const l = layer(template, { cardFit: 'height', motionVariant });
    const metrics = cardMetrics(l, MEDIA);
    for (const time of [0.2, 1.7]) for (let i = 0; i < MEDIA.length; i++) assert.deepEqual(carouselCard(l, i, MEDIA.length, time, metrics), carouselCard(l, i, MEDIA.length, time), `${template}/${motionVariant}`);
  }
  const shuffle = layer('stack-shuffle', { cardFit: 'width', size: 0.6 });
  const metrics = cardMetrics(shuffle, MEDIA);
  const card = carouselCard(shuffle, 2, MEDIA.length, 0.2, metrics);
  near(card.position[1], (1 - card.scale) * height(metrics, 2) / 2, 'shuffle strip');
});

test('card fit validates, survives format switches and updates the live scene in place', () => {
  const p = demoProject();
  assert.equal(validateProject(p).layers[1].cardFit, undefined, 'absent fits stay absent so saved projects keep their shape');
  for (const cardFit of CARD_FITS) assert.equal(patchLayer(p, 'carousel', { cardFit }).layers[1].cardFit, cardFit);
  for (const cardFit of ['cover', 1, null, '']) assert.throws(() => patchLayer(p, 'carousel', { cardFit }), /card fit/i);
  assert(!FORMAT_LOCAL_FIELDS.carousel.includes('cardFit'));
  let linked = patchLayer(switchFormat(linkFormats(demoProject()), 'portrait'), 'carousel', { cardFit: 'width' });
  for (const format of ['square', 'landscape', 'portrait']) { linked = switchFormat(linked, format); assert.equal(linked.layers.find(l => l.id === 'carousel').cardFit, 'width'); }
  const base = validateProject(demoProject());
  for (const cardFit of ['height', 'width', 'fixed']) assert.deepEqual(sceneUpdatePlan(base, patchLayer(base, 'carousel', { cardFit })), { effects: false });
});

test('agents set card fit through the validated carousel tool', async () => {
  let p = demoProject();
  const tools = createTools({ get: () => p, set: next => { p = next; }, save: async () => {}, audit: () => {} });
  const tool = tools.find(t => t.name === 'floc_set_carousel');
  assert.deepEqual(tool.inputSchema.properties.cardFit.enum, CARD_FITS);
  await tool.execute({ template: 'horizontal', cardFit: 'height' });
  assert.equal(p.layers[1].cardFit, 'height');
  await assert.rejects(() => tool.execute({ template: 'horizontal', cardFit: 'stretch' }));
  assert.equal(p.layers[1].cardFit, 'height');
});

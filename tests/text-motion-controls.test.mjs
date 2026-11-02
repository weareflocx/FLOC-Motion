import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as textMotion from '../src/text-motion.js';
import { easeProgress } from '../src/easing.js';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { editTextTiming, textTimingLengths } from '../src/editor-controls.js';
import { createPlaybackClock } from '../src/editor/usePlayback.js';
import { PREVIEW_HOLD, createTextMotionPreview, textMotionPreviewProject, textMotionPreviewSegment } from '../src/editor/text-motion-preview.js';

const compiled = (await Promise.all([
  '../src/editor/controls.jsx',
  '../src/editor/components/TextMotionControls.jsx'
].map(async file => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), { loader: 'jsx' })).code;
}))).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));

function controls(initial = {}) {
  let project = validateProject(demoProject());
  if (Object.keys(initial).length) project = patchLayer(project, 'headline', initial);
  const patches = [], previews = [];
  const context = {
    ...textMotion, easeProgress,
    React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    createContext: value => ({ value, Provider: 'provider' }), useContext: value => value.value,
    useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {},
    useSyncExternalStore: (subscribe, snapshot) => snapshot()
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.entry = TextEntryControls; this.exit = TextExitControls;', context);
  const layer = () => project.layers.find(item => item.id === 'headline');
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return nodes(node.type({ ...node.props, children: node.children }));
    return [node, ...nodes(node.children)];
  }
  const props = () => ({
    layer: layer(),
    onPatch(id, patch) { assert.equal(id, 'headline'); patches.push(plain(patch)); project = patchLayer(project, id, patch); },
    onPreview(...args) { previews.push(args); }
  });
  const render = () => [...nodes(context.entry(props())), ...nodes(context.exit(props()))];
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : (node.children || []).flat(Infinity).map(text).join('');
  const input = label => render().find(node => node.type === 'input' && node.props['aria-label'] === label);
  const group = label => render().find(node => node.props['aria-label'] === label);
  const option = (label, name) => { const g = group(label); return g && nodes(g.children).find(node => node.type === 'button' && text(node) === name); };
  const summary = title => { const section = render().find(node => node.type === 'summary' && text(node.children[0]) === title); return section && text(section.children[1]); };
  return {
    layer, patches, previews, render, input, group, option, summary,
    edit(label, value) {
      const node = input(label);
      assert.ok(node, label);
      node.props.onChange({ target: { value: String(value) } });
      node.props.onBlur?.({ currentTarget: { value: String(value) } });
    },
    check(label, checked) { input(label).props.onChange({ target: { checked } }); }
  };
}

test('entry presets apply the shared preset recipe and show only their controls', () => {
  const h = controls();
  assert.equal(h.summary('Entry'), 'Fade · 450 ms');
  assert.equal(h.option('Entry preset', 'Fade').props['aria-pressed'], true);
  assert.deepEqual(['Entry fade', 'Entry duration', 'Entry distance'].map(label => Boolean(h.input(label))), [true, false, false]);
  for (const id of ['reveal', 'slide', 'rise', 'scale', 'none', 'fade']) {
    const name = textMotion.TEXT_MOTION_PRESETS.find(preset => preset.id === id).name;
    const expected = plain(textMotion.textMotionPresetPatch(h.layer(), 'entry', id));
    h.option('Entry preset', name).props.onClick();
    assert.deepEqual(h.patches.at(-1), expected, id);
    assert.equal(h.option('Entry preset', name).props['aria-pressed'], true, id);
    const moving = !['none', 'fade'].includes(id);
    assert.equal(Boolean(h.input('Entry duration')), moving, `${id} duration`);
    assert.equal(Boolean(h.group('Entry character')), moving, `${id} character`);
    assert.equal(Boolean(h.group('Entry direction')), ['slide', 'reveal'].includes(id), `${id} direction`);
    assert.equal(Boolean(h.input('Entry distance')), ['rise', 'slide', 'reveal'].includes(id), `${id} distance`);
    assert.equal(Boolean(h.input('Entry scale')), id === 'scale', `${id} scale`);
    assert.equal(Boolean(h.input('Entry fade')), id !== 'none', `${id} fade`);
  }
  assert.equal(h.summary('Entry'), 'Fade · 450 ms');
  h.option('Entry preset', 'None').props.onClick();
  assert.equal(h.summary('Entry'), 'None');
});

test('direction, amount and character edits patch only the entry side', () => {
  const h = controls();
  h.option('Entry preset', 'Slide').props.onClick();
  const exit = plain(h.layer().exit), fades = [h.layer().fadeIn, h.layer().fadeOut];
  h.option('Entry direction', 'down').props.onClick();
  h.edit('Entry distance', 12.5);
  h.option('Entry character', 'Elastic').props.onClick();
  assert.deepEqual(h.patches.slice(-3), [{ entry: { direction: 'down' } }, { entry: { amount: 12.5 } }, { entry: { character: 'elastic' } }]);
  assert.deepEqual([h.layer().entry.direction, h.layer().entry.amount, h.layer().entry.character], ['down', 12.5, 'elastic']);
  assert.equal(h.option('Entry character', 'Elastic').props['aria-pressed'], true);
  assert.deepEqual(plain(h.layer().exit), exit);
  assert.deepEqual([h.layer().fadeIn, h.layer().fadeOut], fades);
  assert.equal(h.summary('Entry'), 'Slide · 450 ms');
});

test('Duration keeps a tied fade in step and leaves an independent fade alone', () => {
  const h = controls();
  h.option('Entry preset', 'Rise').props.onClick();
  assert.equal(h.layer().fadeIn, h.layer().entry.duration);
  h.edit('Entry duration', 800);
  assert.deepEqual(h.patches.at(-1), { entry: { duration: 0.8 }, fadeIn: 0.8 });
  h.edit('Entry fade', 300);
  assert.deepEqual(h.patches.at(-1), { fadeIn: 0.3 });
  h.edit('Entry duration', 1000);
  assert.deepEqual(h.patches.at(-1), { entry: { duration: 1 } });
  assert.deepEqual([h.layer().entry.duration, h.layer().fadeIn], [1, 0.3]);
  h.option('Entry preset', 'Reveal').props.onClick();
  assert.equal(h.layer().fadeIn, 0, 'Reveal does not fade');
  h.edit('Entry duration', 400);
  assert.equal(h.layer().fadeIn, 0);
});

test('a mirrored exit offers its duration and fade; unmirroring opens the exit presets', () => {
  const h = controls();
  assert.equal(h.input('Same as entry, reversed').props.checked, true);
  assert.equal(h.summary('Exit'), 'Mirrored · 250 ms');
  assert.equal(h.group('Exit preset'), undefined);
  assert.equal(h.input('Exit duration'), undefined, 'no entry movement: only the fade');
  assert.ok(h.input('Exit fade'));
  h.option('Entry preset', 'Slide').props.onClick();
  assert.ok(h.input('Exit duration'));
  assert.equal(h.summary('Exit'), 'Mirrored · 400 ms');
  h.edit('Exit duration', 500);
  assert.deepEqual(h.patches.at(-1), { exit: { duration: 0.5 } });
  h.check('Same as entry, reversed', false);
  assert.deepEqual(h.patches.at(-1), { exit: { mirror: false } });
  assert.ok(h.group('Exit preset'));
  const expected = plain(textMotion.textMotionPresetPatch(h.layer(), 'exit', 'scale'));
  h.option('Exit preset', 'Scale').props.onClick();
  assert.deepEqual(h.patches.at(-1), expected);
  assert.equal(h.layer().exit.mirror, false);
  assert.equal(h.layer().exit.motion, 'scale');
  assert.ok(h.input('Exit scale'));
  h.edit('Exit scale', 30);
  assert.deepEqual(h.patches.at(-1), { exit: { amount: 30 } });
  assert.equal(h.layer().entry.motion, 'slide', 'exit edits leave the entry alone');
  h.check('Same as entry, reversed', true);
  assert.equal(h.summary('Exit'), 'Mirrored · 250 ms', 'the exit keeps its own duration');
});

test('hovering or focusing a preset only previews; clicking ends the preview then applies once', () => {
  const h = controls();
  const slide = () => h.option('Entry preset', 'Slide');
  slide().props.onPointerEnter();
  slide().props.onPointerLeave();
  slide().props.onFocus();
  slide().props.onBlur();
  assert.deepEqual(h.previews, [['headline', 'entry', 'slide'], ['headline', 'entry', null], ['headline', 'entry', 'slide'], ['headline', 'entry', null]]);
  assert.equal(h.patches.length, 0, 'previews never patch the layer');
  slide().props.onPointerEnter();
  slide().props.onClick();
  assert.deepEqual(h.previews.at(-1), ['headline', 'entry', null]);
  assert.equal(h.patches.length, 1);
  h.check('Same as entry, reversed', false);
  h.option('Exit preset', 'Rise').props.onPointerEnter();
  assert.deepEqual(h.previews.at(-1), ['headline', 'exit', 'rise']);
});

test('the canvas preview loops its segment on the clock and restores time and play state', () => {
  let frame = null, now = 0;
  const clock = createPlaybackClock({ duration: () => 12, now: () => now, request: callback => (frame = callback), cancel: () => { frame = null; } });
  clock.setTime(5.5);
  const preview = createTextMotionPreview(clock);
  preview.show({ start: 2, end: 3 });
  assert.equal(preview.active, true);
  assert.deepEqual([clock.get().time, clock.get().playing], [2, true]);
  now += 900; frame(now);
  assert.ok(Math.abs(clock.get().time - 2.9) < 1e-9);
  now += 200; frame(now);
  assert.equal(clock.get().time, 2, 'the segment loops');
  preview.show({ start: 8, end: 9 });
  assert.equal(clock.get().time, 8, 'another preset restarts its own segment');
  preview.end();
  assert.deepEqual([clock.get().time, clock.get().playing, preview.active], [5.5, false, false]);
  clock.setPlaying(true);
  preview.show({ start: 1, end: 2 });
  preview.end();
  assert.equal(clock.get().playing, true, 'playback resumes when it was playing');
  preview.end();
});

test('preview projects are derived without touching the session project', () => {
  const project = validateProject(demoProject());
  const before = JSON.stringify(project);
  const next = textMotionPreviewProject(project, { layerId: 'headline', side: 'entry', preset: 'slide' }, patchLayer);
  assert.equal(JSON.stringify(project), before);
  assert.equal(next.layers.find(layer => layer.id === 'headline').entry.motion, 'slide');
  const locked = patchLayer(project, 'headline', { locked: true });
  assert.equal(textMotionPreviewProject(locked, { layerId: 'headline', side: 'entry', preset: 'slide' }, patchLayer), null);
  assert.equal(textMotionPreviewProject(project, { layerId: 'logo', side: 'entry', preset: 'slide' }, patchLayer), null);
  const layer = { start: 2, end: 8, fadeIn: .3, fadeOut: .2, entry: { motion: 'slide', duration: .6 }, exit: { mirror: true, duration: .5 } };
  assert.deepEqual(textMotionPreviewSegment(layer, 'entry', 12, 24), { start: 2, end: 2 + .6 + PREVIEW_HOLD });
  assert.deepEqual(textMotionPreviewSegment(layer, 'exit', 12, 24), { start: 8 - .5 - PREVIEW_HOLD, end: 8 });
  const last = textMotionPreviewSegment({ ...layer, end: 12 }, 'exit', 12, 24);
  assert.ok(last.end < 12, 'the clock never reaches the composition end');
});

test('text timeline handles scale fade and movement together within the span', () => {
  const layer = { start: 0, end: 4, fadeIn: .3, fadeOut: .2, entry: { motion: 'slide', duration: .6 }, exit: { mirror: true, motion: 'none', duration: .5 } };
  assert.deepEqual(textTimingLengths(layer), { fadeIn: .6, fadeOut: .5 });
  const longer = editTextTiming(layer, 'fadeIn', .5, 24);
  assert.ok(Math.abs(longer.entryDuration - 1.1) < 1e-9 && Math.abs(longer.fadeIn - .55) < 1e-9, 'fade and movement scale together');
  assert.equal(longer.exitDuration, .5);
  const clamped = editTextTiming(layer, 'fadeIn', 10, 24);
  assert.ok(Math.abs(clamped.entryDuration - 3.5) < 1e-9, 'entry + exit fit the span');
  assert.equal(editTextTiming(layer, 'fadeIn', -10, 24).entryDuration, 0);
  const exit = editTextTiming(layer, 'fadeOut', -.5, 24);
  assert.ok(Math.abs(exit.exitDuration - 1) < 1e-9 && Math.abs(exit.fadeOut - .4) < 1e-9, 'moving the exit handle left lengthens it');
  const still = { ...layer, entry: { motion: 'none', duration: .6 } };
  const fade = editTextTiming(still, 'fadeOut', -.5, 24);
  assert.deepEqual([fade.exitDuration, Math.round(fade.fadeOut * 1000)], [.5, 700], 'a mirrored exit without entry movement only fades');
  assert.deepEqual(editTextTiming({ ...still, fadeIn: 0 }, 'fadeIn', .5, 24).fadeIn, .5);
  assert.throws(() => editTextTiming(layer, 'move', 1, 24), /Unknown fade/);
});

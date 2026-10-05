import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { captureState, evaluateChoreography, moveState, stateAtTime, CHOREOGRAPHY_EASINGS } from '../src/choreography.js';
import { choreographyPatch } from '../src/editor/choreography-edit.js';
import { demoProject, validateProject, patchLayer } from '../src/project.js';

const compiled = await Promise.all(['TimelineTimingControls', 'LayerFadeControls', 'ChoreographyControls', 'TimelineControlsPopover', 'TimelinePanel'].map(async name => {
  const source = fs.readFileSync(new URL(`../src/editor/components/${name}.jsx`, import.meta.url), 'utf8');
  return (await transform(source.replace(/^import .*;\n/gm, '').replace(/export /g, ''), { loader: 'jsx' })).code;
}));

function controls({ type = 'text', locked = false, states = false, time = 1 } = {}) {
  let project = validateProject(demoProject());
  let layer = project.layers.find(item => item.type === type);
  const id = layer.id;
  if (states) {
    project = patchLayer(project, id, { start: 0, end: 6, opacity: .9, choreography: captureState(layer, 0, project.fps, { x: 10, opacity: .2 }, 'first') });
    layer = project.layers.find(item => item.id === id);
    const choreography = captureState(layer, 2, project.fps, { x: 70, opacity: .8 }, 'last').map(state => ({ ...state, easing: 'linear' }));
    project = patchLayer(project, id, { choreography });
  }
  if (locked) project = patchLayer(project, id, { locked: true });
  const slots = [], patches = [], playing = [], seeks = [];
  let cursor = 0, dirty = false;
  const effects = [];
  const React = { createElement(type, props, ...children) {
    if (typeof type === 'function') return type({ ...props, children });
    return { type, props: props || {}, children };
  } };
  const context = { React, CHOREOGRAPHY_EASINGS, captureState, moveState, stateAtTime, evaluateChoreography,
    useState(value) { const index = cursor++; slots[index] ??= { value }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useLayoutEffect() {},
    useEffect(effect, dependencies) { const index = cursor++; if (!slots[index] || dependencies.some((value, i) => value !== slots[index][i])) { slots[index] = dependencies; effects.push(effect); } },
    NumberField: props => ({ type: 'number-field', props, children: [] }),
    Section: props => ({ type: 'section', props, children: props.children }),
    IconButton: props => ({ type: 'button', props: { ...props, 'aria-label': props.label }, children: props.children }),
    TimelineTracks: props => ({ type: 'tracks', props, children: props.project.layers.filter(layer => layer.id === props.selected).map(layer => context.TimelineTimingControls({ project: props.project, layer, onPatch: props.onCommit, onFocus: () => props.onSelect(layer.id) })) }) };
  for (const name of ['Circle', 'Images', 'CaretDown', 'CaretUp', 'ImageSquare', 'MusicNotes', 'Timer', 'DiamondsFour', 'Sparkle', 'TextT', 'Diamond', 'Trash', 'X']) context[name] = () => null;
  vm.createContext(context);
  for (const code of compiled) vm.runInContext(code, context);
  vm.runInContext('this.component = TimelinePanel;', context);
  let props = { selected: id, time, playing: true, ready: true, timelineOpen: true,
    onTimeChange() {}, onSetPlaying(value) { playing.push(value); }, onSetTimelineOpen() {}, onSelect(value) { props.selected = value; },
    onSeek(value) { seeks.push(value); props.time = value; },
    onPatch(layerId, patch) { patches.push(patch); project = patchLayer(project, layerId, patch); },
    onEditLayer(layerId, fields) { playing.push(false); const raw = project.layers.find(item => item.id === layerId); const patch = choreographyPatch(raw, fields, props.time, project.fps); patches.push(patch); project = patchLayer(project, layerId, patch); } };
  const render = (next = {}) => {
    props = { ...props, ...next };
    let result;
    do { cursor = 0; dirty = false; result = context.component({ ...props, project }); while (effects.length) effects.shift()(); } while (dirty);
    return result;
  };
  const nodes = node => [node, ...(node?.children || []).flat(Infinity).flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];
  const find = predicate => nodes(render()).find(predicate);
  const text = node => (node.children || []).flat(Infinity).filter(child => typeof child === 'string').join('');
  const button = label => find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  const field = label => find(node => node.type === 'number-field' && node.props.label === label);
  const open = (layerId = id) => find(node => node.type === 'tracks').props.onOpenControls(layerId, { focus() {} });
  const fades = () => { cursor = 0; return vm.runInContext('LayerFadeControls', context)({ layer: project.layers.find(item => item.id === id), onPatch: props.onPatch }); };
  return { render, find, button, field, open, fades, nodes, patches, playing, seeks, layer: () => project.layers.find(item => item.id === id) };
}

test('expanded timeline edits Start and Duration directly in a row and moving Start preserves duration', () => {
  const h = controls();
  assert.equal(h.find(node => node.props['aria-label'] === 'Timeline playhead'), undefined);
  assert(h.field('Start'));
  assert.equal(h.find(node => node.props.role === 'dialog'), undefined);
  assert.equal(h.find(node => node.props.className === 'transport'), undefined);
  const original = h.layer();
  assert.equal(h.field('Duration').props.value, Number((original.end - original.start).toFixed(4)));
  h.field('Duration').props.onChange(2.25);
  assert.equal(h.layer().end, original.start + 2.25);
  assert.equal(h.playing.at(-1), false);
  h.field('Start').props.onChange(1.5);
  assert.equal(h.layer().start, 1.5);
  assert.equal(h.layer().end, 3.75);
  assert(h.field('Start')); assert.equal(h.field('End (s)'), undefined);
  assert.equal(h.field('Fade in (s)'), undefined); assert.equal(h.field('Fade out (s)'), undefined);
  assert.equal(h.find(node => node.props.type === 'checkbox'), undefined);
  h.render({ timelineOpen: false });
  assert(h.find(node => node.props['aria-label'] === 'Timeline playhead'));
  assert.equal(h.find(node => node.props.id === 'timeline-tracks').props.hidden, true);
});

test('unsupported layers keep timing without choreography; locked layers disable edits but allow state seeking', () => {
  for (const type of ['background', 'music']) {
    const h = controls({ type, locked: true });
    assert.equal(h.button('Choreography'), undefined);
    assert(h.field('Start'));
    assert.equal(h.find(node => node.props.className === 'track-timing-fields').props.disabled, true);
  }
  const h = controls({ locked: true, states: true });
  h.open();
  const picker = h.find(node => node.props['aria-label'] === 'Choreography state');
  assert.equal(picker.props.disabled, false);
  assert.equal(h.find(node => node.type === 'fieldset').props.disabled, true);
  picker.props.onChange({ target: { value: 'last' } });
  assert.deepEqual(h.seeks, [2]);
  assert.equal(h.patches.length, 0);
});

test('timeline opacity edits use the evaluated pose and preserve base opacity and existing state values', () => {
  const h = controls({ states: true });
  h.open();
  assert.equal(h.field('Opacity').props.value, .5);
  h.field('Opacity').props.onChange(.35);
  const state = h.layer().choreography.find(item => item.time === 1);
  assert.equal(h.layer().opacity, .9);
  assert.equal(state.values.opacity, .35);
  assert.equal(state.values.x, 40);
  assert.equal(Object.hasOwn(h.patches[0], 'opacity'), false);
  assert.equal(h.layer().choreography.find(item => item.id === 'first').values.opacity, .2);
  assert.equal(h.layer().choreography.find(item => item.id === 'last').values.opacity, .8);
});

test('Save state captures the current evaluated pose; Update state preserves ID and incoming easing', () => {
  const h = controls({ states: true });
  h.open();
  h.button('Save state').props.onClick();
  const state = h.layer().choreography.find(item => item.time === 1);
  assert.equal(state.values.x, 40); assert.equal(state.values.opacity, .5);
  h.render({ time: 2 });
  h.button('Update state').props.onClick();
  assert.equal(h.layer().choreography.at(-1).id, 'last');
  assert.equal(h.layer().choreography.at(-1).easing, 'linear');
  assert.equal(h.layer().choreography.length, 3);
  h.field('State time (s)').props.onChange(2.5);
  assert.equal(h.layer().choreography.at(-1).time, 2.5);
  assert.equal(h.seeks.at(-1), 2.5);
  h.find(node => node.props['aria-label'] === 'Remove state at 2.50 s').props.onClick();
  assert.equal(h.layer().choreography.some(item => item.id === 'last'), false);
});

test('focusing inline timing restores clip gestures and state selection activates Choreography', () => {
  const h = controls({ states: true });
  h.open();
  const tracks = () => h.find(node => node.type === 'tracks');
  tracks().props.onSelectState(h.layer().id);
  assert.equal(tracks().props.mode, 'choreography');
  tracks().props.onSeek(2);
  assert(h.field('State time (s)'));
  h.find(node => node.props.className === 'track-timing-fields').props.onFocus();
  assert.equal(tracks().props.mode, 'timing');
  assert.equal(h.field('Opacity'), undefined);
  h.open();
  h.render({ selected: 'background' });
  assert.equal(tracks().props.mode, 'timing');
  h.render({ selected: h.layer().id });
  assert.equal(tracks().props.mode, 'timing');
});

test('opening Choreography on another row preserves its mode and selection', () => {
  const h = controls({ states: true });
  h.render({ selected: 'background' });
  h.open();
  assert.equal(h.find(node => node.type === 'tracks').props.mode, 'choreography');
  assert.equal(h.find(node => node.type === 'tracks').props.selected, h.layer().id);
  assert(h.field('Opacity'));
  h.button('Close layer controls').props.onClick();
  assert.equal(h.field('Opacity'), undefined);
  assert.equal(h.find(node => node.type === 'tracks').props.mode, 'choreography');
});

test('changing timing preserves relative choreography, fitted fades, and recoverable states beyond the end', () => {
  const h = controls({ states: true });
  const before = h.layer();
  h.field('Start').props.onChange(1);
  assert.equal(h.layer().end, 7);
  assert.deepEqual(h.layer().choreography, before.choreography);
  assert.equal(evaluateChoreography(h.layer(), 2).x, evaluateChoreography(before, 1).x);
  h.field('Duration').props.onChange(.25);
  assert.deepEqual(h.layer().choreography, before.choreography);
  assert(h.layer().fadeIn + h.layer().fadeOut <= .25 + 1e-9);
  h.open();
  assert(h.find(node => node.props.className === 'timeline-controls-note'));
  h.find(node => node.props.className === 'track-timing-fields').props.onFocus();
  h.field('Duration').props.onChange(6);
  assert.deepEqual(h.layer().choreography, before.choreography);
});

test('fade properties retain numeric editing and Rise during fades in the element inspector', () => {
  const h = controls();
  const fadeNodes = () => h.nodes(h.fades());
  fadeNodes().find(node => node.props.label === 'Fade in (s)').props.onChange(.7);
  fadeNodes().find(node => node.props.label === 'Fade out (s)').props.onChange(.4);
  fadeNodes().find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  assert.equal(h.layer().fadeIn, .7);
  assert.equal(h.layer().fadeOut, .4);
  assert.equal(h.layer().rise, true);
  assert.equal(controls({ type: 'music' }).fades(), null);
});

test('minimum-duration clips can move without floating-point validation failures', () => {
  const h = controls();
  h.field('Duration').props.onChange(.01);
  h.field('Start').props.onChange(.02);
  assert(h.layer().end >= h.layer().start + .01);
  const latestStart = h.field('Start').props.max;
  h.field('Start').props.onChange(latestStart);
  assert(h.layer().end >= h.layer().start + .01);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { blankProject } from '../src/project.js';

const source = fs.readFileSync(new URL('../src/editor/useEditorView.js', import.meta.url), 'utf8');
const compiled = source.replace(/^import .*;\n/gm, '').replace('export function useEditorView', 'function useEditorView');
const plain = value => JSON.parse(JSON.stringify(value));
const relativeView = () => ({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 });

// Exercise the hook's public state and callbacks using the same hook host as editor-startup tests.
function editorView() {
  const slots = [], effects = [], playback = [], persisted = [], compositionChanges = [];
  const project = blankProject(), history = [], future = [];
  const initialProject = JSON.stringify(project);
  let cursor = 0;
  const changed = (old, deps) => !old || deps.some((value, index) => !Object.is(value, old.deps[index]));
  const context = {
    loadNudge: () => ({ small: 1, big: 8 }),
    saveNudge: value => persisted.push(plain(value)),
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (changed(slots[i], deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (changed(old, deps)) {
        const effect = { deps };
        slots[i] = effect;
        effects.push(() => { old?.cleanup?.(); effect.cleanup = fn(); });
      }
    }
  };
  const inputs = {
    setPlaying: value => playback.push(value),
    project, history, future,
    onChangeProject: value => compositionChanges.push(value)
  };
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.hook = useEditorView;', context);
  return {
    playback, persisted,
    render() {
      cursor = 0;
      const view = context.hook(inputs);
      for (const effect of effects.splice(0)) effect();
      return view;
    },
    assertCompositionUnchanged() {
      assert.equal(JSON.stringify(project), initialProject);
      assert.deepEqual(history, []);
      assert.deepEqual(future, []);
      assert.deepEqual(compositionChanges, []);
    }
  };
}

test('scene exploration restores the authored camera without changing composition, playback or saved preferences', () => {
  const host = editorView();
  let view = host.render();
  assert.equal(view.sceneView, null, 'a new editor starts at its authored camera');
  assert.equal(view.zoom, 'fit');
  assert.deepEqual(host.persisted, [{ small: 1, big: 8 }]);

  view.setZoom(1.25);
  view.setSceneView(relativeView());
  view = host.render();
  assert.deepEqual(plain(view.sceneView), relativeView(), 'Explore begins without an authored-camera offset');
  view.setSceneView(current => ({ ...current, yaw: 35, pitch: -15, zoom: 1.8, panX: 9, panY: -4 }));
  view = host.render();
  assert.deepEqual(plain(view.sceneView), { yaw: 35, pitch: -15, zoom: 1.8, panX: 9, panY: -4 });
  assert.equal(view.positionPreview, null, 'navigation does not start a composition placement preview');
  assert.equal(view.zoom, 1.25, '3D dolly does not replace the existing 2D canvas zoom');

  view.setSceneView(null);
  view = host.render();
  assert.equal(view.sceneView, null, 'Camera view restores the authored camera, not the last explored pose');
  view.setSceneView(relativeView());
  view = host.render();
  assert.deepEqual(plain(view.sceneView), relativeView(), 'entering Explore again starts at zero offsets');
  assert.deepEqual(host.playback, [], 'orbit, pan, dolly and restore never pause playback');
  assert.deepEqual(host.persisted, [{ small: 1, big: 8 }], 'navigation is not saved with editor preferences');
  host.assertCompositionUnchanged();

  const fresh = editorView();
  assert.equal(fresh.render().sceneView, null, 'a new editor never inherits an earlier transient view');
});

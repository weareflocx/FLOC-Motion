import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { rendererView } from '../src/editor/renderer-status.js';

const source = fs.readFileSync(new URL('../src/editor/components/RendererConnection.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function RendererConnection', 'function RendererConnection'), { loader: 'jsx' })).code;

// Mounts the panel with the given /api/renderers/status replies; `request` records every call.
async function panel(replies) {
  const slots = [], calls = [], changes = [], cleanups = [];
  let cursor = 0, mounted = false;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState(value) { const index = cursor++; slots[index] ??= { value }; return [slots[index].value, next => { slots[index].value = next; }]; },
    useEffect(effect) { if (!mounted) { mounted = true; cleanups.push(effect()); } },
    async request(url, options = {}) { calls.push([url, options.method || 'GET']); const reply = replies[url]; if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply() : reply; },
    rendererView, setTimeout: () => 0, clearTimeout() {}
  };
  vm.runInNewContext(`${compiled}\nglobalThis.RendererConnection = RendererConnection;`, context);
  const props = { busy: false, onChange: next => changes.push(next) };
  const render = () => { cursor = 0; return context.RendererConnection(props); };
  const find = (tree, match) => [tree].flat().flatMap(node => node && typeof node === 'object' ? [...(match(node) ? [node] : []), ...find(node.children, match)] : []);
  const text = node => node && typeof node === 'object' ? node.children.map(text).join('') : node == null || node === false ? '' : String(node);
  render();
  await new Promise(resolve => setImmediate(resolve));
  const tree = render();
  for (const cleanup of cleanups) cleanup?.();
  return { render, tree, calls, changes, find, text, status: tree => text(find(tree, node => node.props.role === 'status')[0]), button: (tree, label) => find(tree, node => node.type === 'button' && text(node) === label)[0] };
}

const paired = { required: true, paired: true, online: true, connecting: false, compatible: true, name: 'Studio Mac', busy: false, queued: 0, updater: true, engine: { state: 'ready', message: '', target: '' }, updateRequested: false };

test('the renderer panel reports engine updates and shows Update now for updater renderers', async () => {
  const cases = [
    [paired, 'Studio Mac · Ready', true, false],
    [{ ...paired, compatible: false }, 'Updating engine…', true, true],
    [{ ...paired, engine: { state: 'updating', message: '', target: 'b'.repeat(64) } }, 'Updating engine…', true, true],
    [{ ...paired, compatible: false, engine: { state: 'failed', message: 'Reinstall the renderer to update its Node runtime.', target: 'b'.repeat(64) } }, 'Needs attention: Reinstall the renderer to update its Node runtime.', true, false],
    [{ ...paired, compatible: false, updater: false, engine: null }, 'Install the latest renderer once', false],
    [{ ...paired, online: false }, 'Your renderer is offline', false],
    [{ required: true, paired: false, online: false, updater: false, engine: null, updateRequested: false }, 'Connect this computer to export', false]
  ];
  for (const [status, label, hasUpdate, disabled] of cases) {
    const ui = await panel({ '/api/renderers/status': status });
    assert.equal(ui.status(ui.tree), label);
    const update = ui.button(ui.tree, 'Update now');
    assert.equal(Boolean(update), hasUpdate, label);
    if (hasUpdate) assert.equal(update.props.disabled, disabled, label);
    assert.ok(ui.find(ui.tree, node => node.type === 'a' && node.props.href === '/renderer/FLOC-Motion-Renderer.zip').length, 'Download stays available');
    assert.ok(ui.button(ui.tree, status.paired ? 'Reconnect' : 'Connect this computer'));
  }
});

test('Update now asks the editor to update the renderer and adopts the returned status', async () => {
  const requested = { ...paired, updateRequested: true };
  const ui = await panel({ '/api/renderers/status': paired, '/api/renderers/update': requested });
  await ui.button(ui.tree, 'Update now').props.onClick();
  assert.deepEqual(ui.calls.at(-1), ['/api/renderers/update', 'POST']);
  assert.equal(ui.changes.at(-1), requested);
  const tree = ui.render();
  assert.equal(ui.status(tree), 'Updating engine…');
  assert.equal(ui.button(tree, 'Update now').props.disabled, true);

  const failing = await panel({ '/api/renderers/status': paired, '/api/renderers/update': new Error('Install the latest renderer once to enable updates.') });
  await failing.button(failing.tree, 'Update now').props.onClick();
  const alert = failing.find(failing.render(), node => node.props.role === 'alert')[0];
  assert.equal(failing.text(alert), 'Install the latest renderer once to enable updates.');
});

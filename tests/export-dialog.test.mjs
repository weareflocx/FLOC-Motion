import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { demoProject, validateProject, FORMAT_LABELS } from '../src/project.js';
import { EXPORT_QUALITIES, EXPORT_RESOLUTIONS, EXPORT_FORMATS, exportDimensions, exportFormat } from '../src/export-settings.js';
import { isTerminalJobState } from '../src/export-jobs.js';

const source = fs.readFileSync(new URL('../src/editor/components/Dialogs.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.replace(/^import .*;\n/gm, '').replace('export function Dialogs', 'function Dialogs'), { loader: 'jsx' })).code;

function dialog(props = {}) {
  const slots = [], renders = [];
  let cursor = 0;
  const passthrough = ({ children }) => children;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState(value) { const index = cursor++; slots[index] ??= { value }; return [slots[index].value, next => { slots[index].value = next; }]; },
    DownloadSimple() {}, FilmStrip() {}, Robot() {}, X() {}, IconButton() {}, RendererConnection() {}, createTools: () => [],
    Modal: passthrough, Field: passthrough,
    FORMAT_LABELS, EXPORT_QUALITIES, EXPORT_RESOLUTIONS, EXPORT_FORMATS, exportDimensions, exportFormat, isTerminalJobState
  };
  vm.runInNewContext(`${compiled}\nglobalThis.Dialogs = Dialogs;`, context);
  const base = { project: validateProject(demoProject()), exportOpen: true, agentOpen: false, job: null, busy: false, recent: [], settings: { quality: 'high', resolution: '1080p', format: 'mp4', transparent: false }, onSettingsChange: next => { base.settings = next; }, onRender: settings => renders.push(settings), ...props };
  const expand = node => {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== 'object') return [node];
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children.length > 1 ? node.children : node.children[0] }));
    return [{ ...node, children: node.children.flatMap(expand) }];
  };
  const render = () => { cursor = 0; return expand(context.Dialogs(base)); };
  const find = (tree, match) => tree.flatMap(node => node && typeof node === 'object' ? [...(match(node) ? [node] : []), ...find(node.children, match)] : []);
  const text = node => node && typeof node === 'object' ? node.children.map(text).join('') : node == null || node === false ? '' : String(node);
  return { render, find, text, renders };
}

test('export dialog sends the chosen format and only allows transparency for MOV and PNG', () => {
  const ui = dialog();
  const checkbox = tree => ui.find(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0];
  const select = (tree, label) => ui.find(tree, node => node.type === 'select' && node.props['aria-label'] === label)[0];
  const renderButton = tree => ui.find(tree, node => node.type === 'button' && /^Render /.test(ui.text(node)))[0];
  let tree = ui.render();
  assert.equal(checkbox(tree), undefined, 'MP4 has no transparency option');
  assert.deepEqual(ui.find([select(tree, 'Export format')], node => node.type === 'option').map(option => option.props.value), ['mp4', 'mov', 'png']);
  select(tree, 'Export format').props.onChange({ target: { value: 'mov' } });
  tree = ui.render();
  checkbox(tree).props.onChange({ target: { checked: true } });
  tree = ui.render();
  assert.equal(ui.text(renderButton(tree)), 'Render MOV');
  renderButton(tree).props.onClick();
  select(tree, 'Export format').props.onChange({ target: { value: 'mp4' } });
  tree = ui.render();
  assert.equal(checkbox(tree), undefined);
  renderButton(tree).props.onClick();
  // Settings come from the VM realm; compare their JSON as the request body sends it.
  assert.deepEqual(JSON.parse(JSON.stringify(ui.renders)), [{ quality: 'high', resolution: '1080p', format: 'mov', transparent: true }, { quality: 'high', resolution: '1080p', format: 'mp4', transparent: false }]);
});

test('recent exports show the format and download with the matching extension', () => {
  const at = new Date(Date.UTC(2026, 9, 1)).toISOString();
  const recent = [
    { id: 'legacy', name: 'Old clip', state: 'done', width: 1080, height: 1080, quality: 'high', createdAt: at, url: '/exports/legacy/video.mp4' },
    { id: 'frames', name: 'Frames', state: 'done', width: 1080, height: 1080, quality: 'high', format: 'png', transparent: true, createdAt: at, url: '/exports/frames/frames.zip' },
    { id: 'saved', name: 'Saved', state: 'done', width: 1080, height: 1080, quality: 'high', format: 'mov', createdAt: at, file: 'Movies/FLOC Motion/Saved.mov' }
  ];
  const ui = dialog({ recent });
  const items = ui.find(ui.render(), node => node.type === 'li');
  assert.match(ui.text(items[0]), /· MP4Download MP4$/);
  assert.equal(ui.find([items[0]], node => node.type === 'a')[0].props.download, 'Old clip.mp4');
  assert.match(ui.text(items[1]), /· PNG sequence · TransparentDownload ZIP$/);
  assert.equal(ui.find([items[1]], node => node.type === 'a')[0].props.download, 'Frames.zip');
  assert.match(ui.text(items[2]), /· MOVMovies\/FLOC Motion\/Saved\.mov$/);
  assert.equal(ui.find([items[2]], node => node.type === 'a').length, 0);
});

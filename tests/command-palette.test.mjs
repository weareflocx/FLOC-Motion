import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';
import { editorCommands, filterCommands, fuzzyScore, shortcutLabel } from '../src/editor/commands.js';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

function snapshot(overrides = {}) {
  const calls = [];
  const action = name => (...args) => calls.push([name, ...args]);
  const editor = { loaded: true, ready: true, playing: false, layerCount: 6, maxLayers: 60, canUndo: false, canRedo: true, saved: false, canExplore: true, timelineOpen: true,
    layout: { enabled: false }, selectionCount: 1, canAlign: true, canDistribute: false, canDuplicate: true, canDelete: true, lockSelection: true, showSelection: false,
    ...Object.fromEntries(['openAddLayer', 'addText', 'addLayer', 'togglePlayback', 'undo', 'redo', 'selectAll', 'openExport', 'newComposition', 'save', 'saveCopy', 'openComposition', 'openVersions', 'explore', 'toggleTimeline', 'zoom', 'arrange', 'toggleLock', 'toggleVisibility', 'duplicate', 'remove', 'openAccount'].map(name => [name, action(name)])),
    ...overrides };
  return { commands: editorCommands(editor), calls };
}

test('fuzzy search ranks word starts and contiguous matches first and drops non-matches', () => {
  assert.equal(fuzzyScore('zz', 'Export video…'), null);
  assert(fuzzyScore('exp', 'Export video…') > fuzzyScore('exp', 'Explore styles'), 'shorter titles win ties');
  assert(fuzzyScore('ah', 'Add heading') > fuzzyScore('ah', 'Pathway'), 'word starts beat inner matches');
  const { commands } = snapshot();
  assert.equal(filterCommands(commands, 'export')[0].id, 'export.open');
  assert.equal(filterCommands(commands, 'dist h')[0].id, 'arrange.distribute-horizontal');
  assert.equal(filterCommands(commands, 'render')[0].id, 'export.open', 'keywords match too');
  assert.equal(filterCommands(commands, 'qqq').length, 0);
  assert.deepEqual(filterCommands(commands, '').map(command => command.id), commands.map(command => command.id), 'an empty query keeps registry order');
});

test('every registry entry has an id, title and enabled predicate; disabled commands stay listed', () => {
  const { commands } = snapshot();
  assert.equal(new Set(commands.map(command => command.id)).size, commands.length);
  for (const command of commands) { assert.equal(typeof command.title, 'string'); assert.equal(typeof command.enabled, 'function'); assert.equal(typeof command.run, 'function'); }
  for (const id of ['layer.add-text', 'layer.add-carousel', 'playback.toggle', 'history.undo', 'history.redo', 'export.open', 'composition.new', 'composition.save', 'composition.open', 'styles.explore', 'view.timeline', 'view.zoom-fit', 'view.zoom-100', 'arrange.align-left', 'arrange.distribute-vertical', 'selection.lock', 'selection.hide', 'composition.versions', 'account.open']) assert(commands.some(command => command.id === id), id);
  const listed = filterCommands(commands, 'undo');
  assert.equal(listed[0].id, 'history.undo'); assert.equal(listed[0].enabled, false);
  const versions = filterCommands(commands, 'version history')[0];
  assert.equal(versions.enabled, false, 'unsaved drafts have no version history');
  assert.equal(filterCommands(commands, 'distribute').every(command => !command.enabled), true);
  const full = snapshot({ layerCount: 60 }).commands;
  assert.equal(filterCommands(full, 'add text')[0].enabled, false);
});

test('commands follow the editor state and run their actions', () => {
  const single = snapshot();
  assert.equal(single.commands.find(command => command.id === 'arrange.align-left').title, 'Align left to canvas');
  assert.equal(snapshot({ layout: { enabled: true } }).commands.find(command => command.id === 'arrange.align-left').title, 'Align left to safe area');
  const group = snapshot({ selectionCount: 3, playing: true, lockSelection: false, showSelection: true });
  assert.equal(group.commands.find(command => command.id === 'arrange.align-left').title, 'Align left to selection');
  assert.deepEqual(['playback.toggle', 'selection.lock', 'selection.hide'].map(id => group.commands.find(command => command.id === id).title), ['Pause preview', 'Unlock selection', 'Show selection']);
  for (const [id, call] of [['export.open', ['openExport']], ['arrange.distribute-horizontal', ['arrange', 'horizontal']], ['view.zoom-100', ['zoom', 1]], ['layer.add-logo', ['addLayer', 'logo']], ['composition.open', ['openComposition']]]) {
    group.commands.find(command => command.id === id).run();
    assert.deepEqual(group.calls.at(-1), call);
  }
  assert.equal(shortcutLabel('Mod+Shift+Z', true), '⌘⇧Z');
  assert.equal(shortcutLabel('Mod+Shift+Z', false), 'Ctrl+Shift+Z');
});

test('the palette is a keyboard-navigable modal listbox that skips disabled commands and closes on Escape', { skip: !executablePath && 'Chrome or Edge is required for palette verification' }, async t => {
  const bundle = await build({
    stdin: { resolveDir: path.resolve('src'), loader: 'jsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { CommandPalette } from './editor/components/CommandPalette.jsx';
      const command = (id, title, enabled = true) => ({ id, title, group: 'Test', enabled: () => enabled, run: () => window.events.push(['run', id]) });
      function Fixture() {
        const [open, setOpen] = useState(true);
        return <>{open && <CommandPalette commands={[command('a', 'Add text layer'), command('u', 'Undo', false), command('e', 'Export video…'), command('x', 'Explore styles')]} onClose={() => { window.events.push(['close']); setOpen(false); }}/>}<button id="reopen" onClick={() => setOpen(true)}>Open</button></>;
      }
      window.events = []; createRoot(document.getElementById('root')).render(<Fixture/>);
    ` }, bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' }
  });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/style.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForSelector('dialog[open] [role="combobox"]');
  const state = () => page.evaluate(() => {
    const input = document.activeElement, active = document.getElementById(input.getAttribute('aria-activedescendant'));
    return { focused: input.getAttribute('role'), modal: document.querySelector('dialog').matches(':modal'), active: active?.textContent, options: [...document.querySelectorAll('[role="option"]')].map(option => [option.querySelector('.command-palette-label').textContent, option.getAttribute('aria-disabled') === 'true']) };
  });
  let current = await state();
  assert.equal(current.focused, 'combobox'); assert.equal(current.modal, true);
  assert.deepEqual(current.options, [['Add text layer', false], ['Undo', true], ['Export video…', false], ['Explore styles', false]]);
  assert.match(current.active, /^Add text layer/);
  await page.keyboard.press('ArrowDown');
  assert.match((await state()).active, /^Export video…/, 'arrow keys skip disabled commands');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.match((await state()).active, /^Explore styles/, 'navigation wraps');
  await page.keyboard.type('undo');
  current = await state();
  assert.deepEqual(current.options, [['Undo', true]]); assert.equal(current.active, undefined);
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.events), [], 'a disabled command does not run');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('exp');
  assert.match((await state()).active, /^Export video…/);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.events.length === 2);
  assert.deepEqual(await page.evaluate(() => window.events), [['close'], ['run', 'e']], 'the palette closes before the command runs');
  await page.click('#reopen');
  await page.waitForSelector('dialog[open] [role="combobox"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.deepEqual(await page.evaluate(() => window.events.at(-1)), ['close']);
});

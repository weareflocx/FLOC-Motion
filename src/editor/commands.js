// Command palette registry. Each command: { id, title, group, shortcut?, keywords?, enabled(), run() }.

const normalize = text => text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

// Subsequence match favouring word starts and consecutive characters; null when absent.
export function fuzzyScore(query, text) {
  const needle = normalize(query).replace(/\s+/g, ''), haystack = normalize(text);
  if (!needle) return 0;
  let score = 0, from = 0, previous = -2;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return null;
    score += 1;
    if (index === previous + 1) score += 3;
    if (index === 0 || /[\s/·:-]/.test(haystack[index - 1])) score += 5;
    score -= Math.min(3, index - from) * 0.1;
    previous = index; from = index + 1;
  }
  return score - text.length * 0.01;
}

// Disabled commands stay listed (dimmed) so the palette explains what exists.
export function filterCommands(commands, query) {
  const scored = commands.map((command, index) => {
    const score = Math.max(fuzzyScore(query, command.title) ?? -Infinity, ...(command.keywords ?? []).map(word => (fuzzyScore(query, word) ?? -Infinity) - 1));
    return { command, index, score, enabled: Boolean(command.enabled?.() ?? true) };
  }).filter(item => item.score > -Infinity);
  if (query.trim()) scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(({ command, enabled }) => ({ ...command, enabled }));
}

export function shortcutLabel(keys, mac) {
  return keys.split('+').map(key => key === 'Mod' ? (mac ? '⌘' : 'Ctrl') : key === 'Shift' ? (mac ? '⇧' : 'Shift') : key).join(mac ? '' : '+');
}

export const ALIGN_TITLES = Object.freeze([['left', 'Align left'], ['center', 'Align horizontal centers'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align vertical centers'], ['bottom', 'Align bottom']]);
export const alignTargetLabel = (selectionCount, layout) => selectionCount > 1 ? 'selection' : layout?.enabled ? 'safe area' : 'canvas';

// `editor` is a snapshot of state flags plus actions supplied by the app.
export function editorCommands(editor, { mac = false } = {}) {
  const key = keys => shortcutLabel(keys, mac);
  const canAdd = () => editor.loaded && editor.layerCount < editor.maxLayers;
  const alignTarget = alignTargetLabel(editor.selectionCount, editor.layout);
  return [
    { id: 'layer.add', group: 'Layers', title: 'Add layer…', keywords: ['import', 'media', 'image', 'video', 'audio', 'model'], enabled: canAdd, run: editor.openAddLayer },
    { id: 'layer.add-text', group: 'Layers', title: 'Add text layer', keywords: ['type', 'copy'], enabled: canAdd, run: editor.addText },
    { id: 'layer.add-carousel', group: 'Layers', title: 'Add carousel…', keywords: ['cards', 'photos'], enabled: canAdd, run: editor.openAddLayer },
    { id: 'layer.add-logo', group: 'Layers', title: 'Add studio mark', keywords: ['logo', 'brand'], enabled: canAdd, run: () => editor.addLayer('logo') },
    { id: 'layer.add-background', group: 'Layers', title: 'Add background layer', enabled: canAdd, run: () => editor.addLayer('background') },
    { id: 'layer.add-adjustment', group: 'Layers', title: 'Add adjustment layer', keywords: ['effect', 'filter'], enabled: canAdd, run: () => editor.addLayer('effect') },
    { id: 'playback.toggle', group: 'Playback', title: editor.playing ? 'Pause preview' : 'Play preview', shortcut: 'Space', enabled: () => editor.ready, run: editor.togglePlayback },
    { id: 'history.undo', group: 'Edit', title: 'Undo', shortcut: key('Mod+Z'), enabled: () => editor.canUndo, run: editor.undo },
    { id: 'history.redo', group: 'Edit', title: 'Redo', shortcut: key('Mod+Shift+Z'), enabled: () => editor.canRedo, run: editor.redo },
    { id: 'selection.all', group: 'Edit', title: 'Select all layers', shortcut: key('Mod+A'), keywords: ['select'], enabled: () => editor.loaded, run: editor.selectAll },
    { id: 'export.open', group: 'Composition', title: 'Export video…', keywords: ['render', 'mp4', 'mov', 'png', 'download'], enabled: () => editor.loaded, run: editor.openExport },
    { id: 'composition.new', group: 'Composition', title: 'New composition…', enabled: () => editor.loaded, run: editor.newComposition },
    { id: 'composition.save', group: 'Composition', title: editor.saved ? 'Save changes' : 'Save composition…', enabled: () => editor.loaded, run: editor.save },
    { id: 'composition.save-copy', group: 'Composition', title: 'Save a copy…', enabled: () => editor.loaded, run: editor.saveCopy },
    { id: 'composition.open', group: 'Composition', title: 'Open composition…', keywords: ['saved', 'recent', 'load'], enabled: () => editor.loaded, run: editor.openComposition },
    { id: 'composition.versions', group: 'Composition', title: 'Version history…', keywords: ['restore', 'revisions'], enabled: () => editor.loaded && editor.saved, run: editor.openVersions },
    { id: 'styles.explore', group: 'Composition', title: 'Explore styles', keywords: ['alternatives', 'variations', 'looks'], enabled: () => editor.canExplore, run: editor.explore },
    { id: 'view.timeline', group: 'View', title: editor.timelineOpen ? 'Hide timeline' : 'Show timeline', enabled: () => true, run: editor.toggleTimeline },
    { id: 'view.zoom-fit', group: 'View', title: 'Zoom to fit', enabled: () => true, run: () => editor.zoom('fit') },
    { id: 'view.zoom-100', group: 'View', title: 'Zoom to 100%', keywords: ['actual size'], enabled: () => true, run: () => editor.zoom(1) },
    ...ALIGN_TITLES.map(([mode, title]) => ({ id: `arrange.align-${mode}`, group: 'Arrange', title: `${title} to ${alignTarget}`, keywords: ['align'], enabled: () => editor.canAlign, run: () => editor.arrange(mode) })),
    { id: 'arrange.distribute-horizontal', group: 'Arrange', title: 'Distribute horizontally', keywords: ['spacing', 'space evenly'], enabled: () => editor.canDistribute, run: () => editor.arrange('horizontal') },
    { id: 'arrange.distribute-vertical', group: 'Arrange', title: 'Distribute vertically', keywords: ['spacing', 'space evenly'], enabled: () => editor.canDistribute, run: () => editor.arrange('vertical') },
    { id: 'selection.lock', group: 'Selection', title: editor.lockSelection ? 'Lock selection' : 'Unlock selection', enabled: () => editor.selectionCount > 0, run: editor.toggleLock },
    { id: 'selection.hide', group: 'Selection', title: editor.showSelection ? 'Show selection' : 'Hide selection', enabled: () => editor.selectionCount > 0, run: editor.toggleVisibility },
    { id: 'selection.duplicate', group: 'Selection', title: 'Duplicate selection', enabled: () => editor.canDuplicate, run: editor.duplicate },
    { id: 'selection.delete', group: 'Selection', title: 'Delete selection', shortcut: 'Delete', enabled: () => editor.canDelete, run: editor.remove },
    { id: 'account.open', group: 'Account', title: 'Account…', keywords: ['sign out', 'profile'], enabled: () => true, run: editor.openAccount }
  ];
}

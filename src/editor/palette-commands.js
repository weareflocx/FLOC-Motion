import { PROJECT_LIMITS } from '../project.js';
import { editorCommands } from './commands.js';
import { groupFlagValue } from './selection.js';

const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

// Adapts the editor's live state and actions to the command palette registry.
export function paletteCommands({ session, playback, view, dialogs, selection, group, actions, exploreReady, explore, saveOrName }) {
  const { project, loaded, history, future, composition, undo, redo } = session;
  const { playing, setPlaying } = playback;
  return editorCommands({
    loaded, ready: view.ready, playing, layerCount: project.layers.length, maxLayers: PROJECT_LIMITS.maxLayers, canUndo: history.length > 0, canRedo: future.length > 0,
    saved: Boolean(composition), canExplore: loaded && !dialogs.dialogBlocked && exploreReady, timelineOpen: view.timelineOpen, layout: project.layout,
    selectionCount: selection.length, canAlign: group.arrangeState.align, canDistribute: group.arrangeState.distribute, canDuplicate: group.canDuplicate, canDelete: group.canDelete,
    lockSelection: groupFlagValue(group.selectedLayers, 'locked'), showSelection: groupFlagValue(group.selectedLayers, 'visible'),
    openAddLayer: () => dialogs.setAddTarget('layers'), addText: actions.addText, addLayer: actions.addLayer, togglePlayback: () => setPlaying(value => !value), undo, redo, selectAll: group.selectAll,
    openExport: dialogs.openExport, newComposition: () => dialogs.openNew('aspect'),
    save: saveOrName, saveCopy: () => dialogs.setSaveOpen(true),
    openComposition: () => dialogs.openNew('compositions'), openVersions: dialogs.openVersions,
    explore, toggleTimeline: () => view.setTimelineOpen(value => !value), zoom: view.setZoom, arrange: group.arrange, ...group.groupActions,
    openAccount: dialogs.openAccount
  }, { mac: MAC });
}

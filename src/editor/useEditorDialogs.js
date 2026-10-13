import { useCallback, useState } from 'react';

// Open state of every editor dialog. `newOpen` is `true`, 'aspect' or 'compositions' (the initial tab);
// `addTarget`, `contentTarget` and `batchTemplate` hold what the dialog works on, or null when closed.
export function useEditorDialogs({ canvasEditing, setPlaying }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [contentTarget, setContentTarget] = useState(null);
  const [batchTemplate, setBatchTemplate] = useState(null);
  // Modal work (and a pending canvas edit) blocks exploring alternatives; so does the open palette.
  const dialogBlocked = canvasEditing || accountOpen || nudgeOpen || exportOpen || newOpen || saveOpen || templatesOpen || versionsOpen || contentTarget !== null || batchTemplate !== null || addTarget !== null;
  const alternativesBlocked = dialogBlocked || paletteOpen;
  const openPalette = useCallback(() => { setPlaying(false); setPaletteOpen(true); }, [setPlaying]);
  // Opening these dialogs pauses playback first.
  const paused = (setOpen, value = true) => { setPlaying(false); setOpen(value); };
  return {
    accountOpen, setAccountOpen, nudgeOpen, setNudgeOpen, paletteOpen, setPaletteOpen, exportOpen, setExportOpen, agentOpen, setAgentOpen,
    addTarget, setAddTarget, newOpen, setNewOpen, saveOpen, setSaveOpen, templatesOpen, setTemplatesOpen, versionsOpen, setVersionsOpen,
    contentTarget, setContentTarget, batchTemplate, setBatchTemplate, dialogBlocked, alternativesBlocked, openPalette,
    openAccount: () => paused(setAccountOpen),
    openNudge: () => paused(setNudgeOpen),
    openExport: () => paused(setExportOpen),
    openNew: tab => paused(setNewOpen, tab),
    openVersions: () => paused(setVersionsOpen),
    openTemplates: () => paused(setTemplatesOpen),
    openContent: target => paused(setContentTarget, target)
  };
}

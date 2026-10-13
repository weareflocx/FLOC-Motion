// Switching compositions and applying template content from the New, Templates and Content dialogs.
// Plain closures over the current render, so `contentTarget` is always the open form's target.
export function useCompositionContent({ session, setTime, setPlaying, setSelected, view, dialogs }) {
  const { projectRef, change, save, saveCopy, newComposition, openSavedComposition } = session;
  const { setLeftTab, setRightTab, setPositionPreview } = view;
  const { contentTarget, setContentTarget, setTemplatesOpen } = dialogs;
  async function createComposition(name, options) {
    const next = await newComposition(name, options);
    setTime(0); setPlaying(false); setSelected(next.layers.at(-1)?.id ?? null); setLeftTab('layers'); setRightTab('composition'); setPositionPreview(null);
  }
  async function openComposition(entry) {
    const next = await openSavedComposition(entry);
    setTime(0); setPlaying(false); setSelected(next.layers[0]?.id ?? null); setLeftTab('layers'); setRightTab('composition'); setPositionPreview(null);
    return true;
  }
  async function applyTemplate(entry) {
    const next = await openSavedComposition(entry);
    setTime(0.65); setPlaying(false); setSelected(next.layers[0]?.id ?? null);
    return next;
  }
  function startFromTemplate(entry) {
    setTemplatesOpen(false);
    setPlaying(false);
    setContentTarget({ project: entry.project, copy: true, name: `${entry.name.slice(0, 95)} copy` });
  }
  async function applyContent(draft, name) {
    if (contentTarget.copy) {
      await save();
      await saveCopy(name, draft);
      setTime(0.65);
      setSelected(draft.layers[0]?.id ?? null);
    } else {
      if (projectRef.current !== contentTarget.project) throw new Error('The composition changed while the form was open. Reopen Content to use its latest values.');
      if (!change(draft, { allow: ['content'] })) throw new Error('Content could not be applied.');
    }
    setPlaying(false);
    return true;
  }
  return { createComposition, openComposition, applyTemplate, startFromTemplate, applyContent };
}

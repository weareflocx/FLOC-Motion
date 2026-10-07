import { useCallback, useEffect, useRef, useState } from 'react';
import { blankProject, demoProject, fileLayer, patchLayer, validateProject } from '../project.js';
import { request } from './request.js';
import { historyShortcut } from './history-shortcut.js';
import { editorSession } from './project-session.js';

/**
 * Owns the editor's project state and its revision-guarded local persistence.
 * Keeping the refs here prevents autosave and WebMCP from reading stale React
 * state while a control is being edited.
 */
export function useProject({ userId } = {}) {
  const [session] = useState(() => editorSession(userId));
  const [project, setProject] = useState(() => validateProject(demoProject()));
  const projectRef = useRef(project);
  const draftRevisions = useRef(new Map());
  const compositionRef = useRef(null);
  const [composition, setComposition] = useState(null);
  const dirty = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const hydrated = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading project');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const canvasEdit = useRef(null);
  const [canvasEditing, setCanvasEditing] = useState(false);
  const setCanvasEdit = useCallback(commit => {
    canvasEdit.current = commit;
    setCanvasEditing(Boolean(commit));
  }, []);
  const clearHistory = useCallback(() => {
    historyRef.current = []; futureRef.current = [];
    setHistory([]); setFuture([]);
  }, []);

  const change = useCallback(next => {
    try {
      const valid = validateProject(next);
      const previous = projectRef.current;
      if (JSON.stringify(valid) === JSON.stringify(previous)) return previous;
      historyRef.current = [...historyRef.current.slice(-19), previous];
      setHistory(historyRef.current);
      futureRef.current = []; setFuture([]);
      projectRef.current = valid;
      setProject(valid);
      dirty.current = true;
      setStatus('Unsaved changes');
      setError('');
      return valid;
    } catch (validationError) {
      setError(validationError.message);
      return null;
    }
  }, []);

  const patch = useCallback((id, fields) => {
    try { return change(patchLayer(projectRef.current, id, fields)); }
    catch (patchError) { setError(patchError.message); return null; }
  }, [change]);

  const save = useCallback(() => {
    canvasEdit.current?.();
    const snapshot = projectRef.current;
    const identity = compositionRef.current;
    if (identity && !dirty.current) return saveQueue.current.catch(() => {}).then(() => ({ composition: compositionRef.current }));
    const draftId = session.draftId;
    const action = saveQueue.current.catch(() => {}).then(async () => {
      try {
        setStatus('Saving…');
        const entry = await request(identity ? `/api/templates/${identity.id}` : `/api/drafts/${draftId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(identity
            ? { name: snapshot.name, project: snapshot, updatedAt: compositionRef.current?.id === identity.id ? compositionRef.current.updatedAt : identity.updatedAt }
            : { project: snapshot, revision: draftRevisions.current.get(draftId) || 0 })
        });
        const result = identity ? { composition: { id: entry.id, updatedAt: entry.updatedAt } } : entry;
        if (!identity) draftRevisions.current.set(draftId, result.revision);
        if (identity && compositionRef.current?.id === identity.id) { compositionRef.current = result.composition; setComposition(result.composition); }
        if (snapshot === projectRef.current && (identity ? compositionRef.current?.id === identity.id : session.draftId === draftId && !compositionRef.current)) { dirty.current = false; setError(''); setStatus(result.composition ? 'All changes saved' : 'Draft saved'); }
        return result;
      } catch (saveError) {
        // A second window may have advanced the revision. Keep the local draft
        // intact and surface the conflict instead of overwriting that window.
        setError(saveError.message);
        setStatus(saveError.status === 409 ? 'Save conflict' : 'Save failed');
        throw saveError;
      }
    });
    saveQueue.current = action;
    return action;
  }, [session]);

  const undo = useCallback(() => {
    canvasEdit.current?.();
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    futureRef.current = [...futureRef.current, projectRef.current];
    setFuture(futureRef.current);
    historyRef.current = historyRef.current.slice(0, -1);
    setHistory(historyRef.current);
    projectRef.current = previous;
    setProject(previous);
    dirty.current = true;
    setStatus('Unsaved changes');
  }, []);

  const redo = useCallback(() => {
    canvasEdit.current?.();
    const next = futureRef.current.at(-1);
    if (!next) return;
    historyRef.current = [...historyRef.current.slice(-19), projectRef.current];
    setHistory(historyRef.current);
    futureRef.current = futureRef.current.slice(0, -1);
    setFuture(futureRef.current);
    projectRef.current = next;
    setProject(next);
    dirty.current = true;
    setStatus('Unsaved changes');
  }, []);

  useEffect(() => {
    const onKeyDown = event => {
      const action = historyShortcut(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'undo') undo(); else redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const reload = useCallback(async () => {
    await saveQueue.current.catch(() => {});
    let id = compositionRef.current?.id || session.compositionId;
    let entry;
    try { entry = await request(id ? `/api/templates/${id}` : `/api/drafts/${session.draftId}`); }
    catch (error) {
      if (!id || error.status !== 404) throw error;
      // A shared composition may have been deleted while this tab was closed.
      id = null; session.compositionId = null; session.remember();
      entry = await request(`/api/drafts/${session.draftId}`);
    }
    const data = id ? { project: { ...entry.project, name: entry.name }, composition: { id: entry.id, updatedAt: entry.updatedAt } } : entry;
    const next = validateProject(data.project);
    projectRef.current = next;
    setProject(next);
    if (!id) draftRevisions.current.set(session.draftId, data.revision);
    compositionRef.current = data.composition || null;
    setComposition(compositionRef.current);
    dirty.current = false;
    clearHistory();
    hydrated.current = true;
    setLoaded(true);
    setError('');
    setStatus(data.composition ? 'All changes saved' : 'Draft saved');
    return next;
  }, [clearHistory, session]);

  const openComposition = useCallback(entry => {
    const next = validateProject({ ...entry.project, name: entry.name });
    compositionRef.current = { id: entry.id, updatedAt: entry.updatedAt };
    setComposition(compositionRef.current);
    session.compositionId = entry.id;
    session.remember();
    const valid = change(next);
    if (valid) { dirty.current = false; setStatus('All changes saved'); setError(''); }
    clearHistory();
    return valid;
  }, [change, clearHistory, session]);

  const updateCompositionMetadata = useCallback(entry => {
    if (compositionRef.current?.id !== entry.id) return;
    compositionRef.current = { id: entry.id, updatedAt: entry.updatedAt };
    setComposition(compositionRef.current);
    if (projectRef.current.name !== entry.name) change({ ...projectRef.current, name: entry.name });
  }, [change]);

  const saveCopy = useCallback(async (name, source) => {
    await saveQueue.current.catch(() => {});
    const snapshot = validateProject({ ...(source ?? projectRef.current), name: name.trim() });
    const entry = await request('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: snapshot.name, tags: [], project: snapshot }) });
    openComposition(entry);
    return entry;
  }, [openComposition]);

  const importDraft = useCallback(next => {
    const valid = validateProject(next);
    compositionRef.current = null;
    setComposition(null);
    session.draftId = crypto.randomUUID();
    session.compositionId = null;
    session.remember();
    const changed = change(valid);
    dirty.current = true;
    setStatus('Unsaved changes');
    return changed;
  }, [change, session]);

  const preserveCurrent = useCallback(async () => {
    canvasEdit.current?.();
    const current = projectRef.current;
    await save();
    if (!compositionRef.current) {
      // Preserve this tab's working draft in the shared library before switching.
      await request('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: current.name.trim() || 'Untitled', tags: [], project: current }) });
    }
    if (projectRef.current !== current) throw new Error('The composition changed while it was being saved. Try again.');
  }, [save]);

  const newComposition = useCallback(async (name, { format = 'square', assets = [] } = {}) => {
    if (assets.length > 20) throw new Error('Use up to 20 layers.');
    const draft = blankProject(name.trim());
    const next = validateProject({ ...draft, format, layers: assets.map(asset => fileLayer(asset, draft.duration, crypto.randomUUID())) });
    await preserveCurrent();
    importDraft(next);
    clearHistory();
    // The previous work is safe. Keep a new draft save failure in the normal
    // retry flow without archiving another copy on a repeated form submission.
    await save().catch(() => {});
    return next;
  }, [save, importDraft, clearHistory, preserveCurrent]);

  const openSavedComposition = useCallback(async entry => {
    validateProject({ ...entry.project, name: entry.name });
    if (compositionRef.current?.id === entry.id) {
      canvasEdit.current?.();
      await save();
      return projectRef.current;
    }
    await preserveCurrent();
    const fresh = await request(`/api/templates/${entry.id}`);
    const next = openComposition(fresh);
    if (!next) throw new Error('Unable to open composition.');
    return next;
  }, [preserveCurrent, openComposition, save]);

  useEffect(() => {
    const warn = event => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    reload().catch(loadError => { setError(loadError.message); setStatus('Offline'); });
    const restore = () => {
      if (!hydrated.current) reload().catch(loadError => setError(loadError.message));
      else if (dirty.current) save().catch(saveError => setError(saveError.message));
    };
    window.addEventListener('floc-session-restored', restore);
    return () => window.removeEventListener('floc-session-restored', restore);
  }, [reload, save]);

  useEffect(() => {
    if (!loaded || !hydrated.current || !dirty.current) return undefined;
    const timer = setTimeout(() => dirty.current && save().catch(saveError => {
      setError(saveError.message);
      if (saveError.status !== 409) setStatus('Save failed');
    }), 650);
    return () => clearTimeout(timer);
  }, [project, composition?.id, session.draftId, loaded, save]);

  return {
    project,
    composition,
    openComposition,
    updateCompositionMetadata,
    saveCopy,
    newComposition,
    openSavedComposition,
    importDraft,
    projectRef,
    loaded,
    status,
    error,
    setError,
    history,
    future,
    canvasEditing,
    setCanvasEdit,
    change,
    patch,
    save,
    undo,
    redo,
    reload
  };
}

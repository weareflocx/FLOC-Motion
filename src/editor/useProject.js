import { useCallback, useEffect, useRef, useState } from 'react';
import { PROJECT_LIMITS, assertLocksRespected, blankProject, fileLayer, patchLayer, validateProject } from '../project.js';
import { request } from './request.js';
import { historyShortcut } from './history-shortcut.js';
import { applyDiff, diffProjects, pushHistory, restoreHistory, revertDiff, stashHistory } from './history.js';
import { editorSession } from './project-session.js';

/**
 * Owns the editor's project state and its revision-guarded local persistence.
 * Keeping the refs here prevents autosave and WebMCP from reading stale React
 * state while a control is being edited.
 */
export function useProject({ userId } = {}) {
  const [session] = useState(() => editorSession(userId));
  const [project, setProject] = useState(() => validateProject(blankProject()));
  const projectRef = useRef(project);
  const draftRevisions = useRef(new Map());
  const compositionRef = useRef(null);
  const [composition, setComposition] = useState(null);
  const dirty = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const hydrated = useRef(false);
  const startup = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Opening new document');
  const [error, setError] = useState('');
  // Undo/redo entries are reversible diffs; other documents' stacks wait in
  // `stashes` (keyed by composition id or draft) until they are reopened.
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const stashes = useRef(new Map());
  const archived = useRef(null);
  const canvasEdit = useRef(null);
  const [canvasEditing, setCanvasEditing] = useState(false);
  const setCanvasEdit = useCallback(commit => {
    canvasEdit.current = commit;
    setCanvasEditing(Boolean(commit));
  }, []);
  const setStacks = useCallback((past, next) => {
    historyRef.current = past; futureRef.current = next;
    setHistory(past); setFuture(next);
  }, []);
  const clearHistory = useCallback(() => setStacks([], []), [setStacks]);
  // A draft archived before switching reopens as that library composition.
  const historyKey = useCallback(() => compositionRef.current?.id
    ?? (archived.current?.draftId === session.draftId ? archived.current.id : `draft:${session.draftId}`), [session]);
  const leaveDocument = useCallback(() => {
    stashHistory(stashes.current, historyKey(), projectRef.current, historyRef.current, futureRef.current);
    clearHistory();
  }, [clearHistory, historyKey]);

  // Every edit keeps locked layers intact unless the caller names an explicit
  // composition-wide exception; `replace` is reserved for opening/importing.
  const change = useCallback((next, { allow = [], replace = false } = {}) => {
    try {
      const valid = validateProject(next);
      const previous = projectRef.current;
      if (!replace) assertLocksRespected(previous, valid, { allow });
      const ops = diffProjects(previous, valid);
      if (!ops.length) return previous;
      setStacks(pushHistory(historyRef.current, ops), []);
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
  }, [setStacks]);

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
    const entry = historyRef.current.at(-1);
    if (!entry) return;
    const previous = revertDiff(projectRef.current, entry.ops);
    setStacks(historyRef.current.slice(0, -1), [...futureRef.current, entry]);
    projectRef.current = previous;
    setProject(previous);
    dirty.current = true;
    setStatus('Unsaved changes');
  }, [setStacks]);

  const redo = useCallback(() => {
    canvasEdit.current?.();
    const entry = futureRef.current.at(-1);
    if (!entry) return;
    const next = applyDiff(projectRef.current, entry.ops);
    setStacks([...historyRef.current, entry], futureRef.current.slice(0, -1));
    projectRef.current = next;
    setProject(next);
    dirty.current = true;
    setStatus('Unsaved changes');
  }, [setStacks]);

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

  // Opening the app is not "reload latest": preserve the prior tab's persisted draft, then
  // start an independent document. Keep its old storage pointer until preservation succeeds.
  const startFresh = useCallback(() => {
    if (hydrated.current) return Promise.resolve(projectRef.current);
    if (startup.current) return startup.current;
    startup.current = (async () => {
      setStatus('Opening new document'); setError('');
      if (!session.compositionId) await request(`/api/drafts/${session.draftId}/archive`, { method: 'POST' });
      const next = validateProject(blankProject());
      session.draftId = crypto.randomUUID();
      session.compositionId = null;
      session.remember();
      projectRef.current = next;
      compositionRef.current = null;
      setProject(next); setComposition(null);
      clearHistory();
      dirty.current = false;
      hydrated.current = true;
      setLoaded(true);
      setStatus('New document');
      return next;
    })().catch(openError => {
      setError(openError.message);
      setStatus('Open failed');
      throw openError;
    }).finally(() => { startup.current = null; });
    return startup.current;
  }, [clearHistory, session]);

  const reload = useCallback(async () => {
    const current = projectRef.current;
    const identity = compositionRef.current?.id;
    const draftId = session.draftId;
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
    if (projectRef.current !== current || compositionRef.current?.id !== identity || session.draftId !== draftId) throw new Error('The composition changed while it was being loaded. Try again.');
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
    setStatus(data.composition ? 'All changes saved' : data.revision ? 'Draft saved' : 'New document');
    return next;
  }, [clearHistory, session]);

  const openComposition = useCallback(entry => {
    const next = validateProject({ ...entry.project, name: entry.name });
    leaveDocument();
    compositionRef.current = { id: entry.id, updatedAt: entry.updatedAt };
    setComposition(compositionRef.current);
    session.compositionId = entry.id;
    session.remember();
    const valid = change(next, { replace: true });
    if (valid) { dirty.current = false; setStatus('All changes saved'); setError(''); }
    const stash = restoreHistory(stashes.current, historyKey(), projectRef.current);
    setStacks(stash?.past ?? [], stash?.future ?? []);
    return valid;
  }, [change, historyKey, leaveDocument, session, setStacks]);

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

  // Imports start a fresh history in a new draft.
  const importDraft = useCallback(next => {
    const valid = validateProject(next);
    leaveDocument();
    compositionRef.current = null;
    setComposition(null);
    session.draftId = crypto.randomUUID();
    session.compositionId = null;
    session.remember();
    const changed = change(valid, { replace: true });
    clearHistory();
    dirty.current = true;
    setStatus('Unsaved changes');
    return changed;
  }, [change, clearHistory, leaveDocument, session]);

  // The same work continues as a draft, so its history comes along.
  const detachComposition = useCallback(id => {
    if (compositionRef.current?.id !== id) return;
    const past = historyRef.current, next = futureRef.current;
    importDraft(projectRef.current);
    stashes.current.delete(id);
    setStacks(past, next);
  }, [importDraft, setStacks]);

  const preserveCurrent = useCallback(async () => {
    canvasEdit.current?.();
    const current = projectRef.current;
    const draftId = session.draftId;
    // Opening New or Compositions from an untouched startup document must not archive a blank.
    if (!compositionRef.current && !dirty.current && !(draftRevisions.current.get(draftId) > 0)) return;
    await save();
    let archive = null;
    if (!compositionRef.current) {
      // Preserve this tab's working draft in the shared library before switching.
      archive = await request('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: current.name.trim() || 'Untitled', tags: [], project: current }) });
    }
    if (projectRef.current !== current) throw new Error('The composition changed while it was being saved. Try again.');
    if (archive?.id) archived.current = { draftId, id: archive.id };
  }, [save, session]);

  const newComposition = useCallback(async (name, { format = 'square', assets = [] } = {}) => {
    const draft = blankProject(name.trim());
    if (assets.length + draft.layers.length > PROJECT_LIMITS.maxLayers) throw new Error(`Use up to ${PROJECT_LIMITS.maxLayers - draft.layers.length} media layers.`);
    const next = validateProject({ ...draft, format, layers: [...draft.layers, ...assets.map(asset => fileLayer(asset, draft.duration, crypto.randomUUID()))] });
    await preserveCurrent();
    importDraft(next);
    // The previous work is safe. Keep a new draft save failure in the normal
    // retry flow without archiving another copy on a repeated form submission.
    await save().catch(() => {});
    return next;
  }, [save, importDraft, preserveCurrent]);

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
    startFresh().catch(() => {});
    const restore = () => {
      if (!hydrated.current) startFresh().catch(() => {});
      else if (dirty.current) save().catch(saveError => setError(saveError.message));
    };
    window.addEventListener('floc-session-restored', restore);
    return () => window.removeEventListener('floc-session-restored', restore);
  }, [startFresh, save]);

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
    startFresh,
    openComposition,
    updateCompositionMetadata,
    saveCopy,
    newComposition,
    openSavedComposition,
    importDraft,
    detachComposition,
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { demoProject, patchLayer, validateProject } from '../project.js';
import { request } from './request.js';
import { historyShortcut } from './history-shortcut.js';

/**
 * Owns the editor's project state and its revision-guarded local persistence.
 * Keeping the refs here prevents autosave and WebMCP from reading stale React
 * state while a control is being edited.
 */
export function useProject() {
  const [project, setProject] = useState(() => validateProject(demoProject()));
  const projectRef = useRef(project);
  const revisionRef = useRef(0);
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
    const snapshot = projectRef.current;
    const identity = compositionRef.current;
    const action = saveQueue.current.catch(() => {}).then(async () => {
      try {
        setStatus('Saving…');
        const result = await request('/api/project', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: snapshot, revision: revisionRef.current, composition: identity && { ...identity, updatedAt: compositionRef.current?.id === identity.id ? compositionRef.current.updatedAt : identity.updatedAt } })
        });
        revisionRef.current = result.revision;
        if (compositionRef.current?.id === identity?.id) { compositionRef.current = result.composition; setComposition(result.composition); }
        if (snapshot === projectRef.current) { dirty.current = false; setError(''); setStatus(result.composition ? 'All changes saved' : 'Draft saved'); }
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
  }, []);

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
    const data = await request('/api/project');
    if (data.composition) {
      const library = await request('/api/templates');
      const entry = library.templates.find(item => item.id === data.composition.id);
      data.composition = entry ? { id: entry.id, updatedAt: entry.updatedAt } : null;
      if (entry) data.project = { ...entry.project, name: entry.name };
    }
    const next = validateProject(data.project);
    projectRef.current = next;
    setProject(next);
    revisionRef.current = data.revision;
    compositionRef.current = data.composition || null;
    setComposition(compositionRef.current);
    dirty.current = false;
    clearHistory();
    hydrated.current = true;
    setLoaded(true);
    setError('');
    setStatus(data.composition ? 'All changes saved' : 'Draft saved');
    return next;
  }, [clearHistory]);

  const openComposition = useCallback(entry => {
    compositionRef.current = { id: entry.id, updatedAt: entry.updatedAt };
    setComposition(compositionRef.current);
    const valid = change({ ...entry.project, name: entry.name });
    clearHistory();
    return valid;
  }, [change, clearHistory]);

  const updateCompositionMetadata = useCallback(entry => {
    if (compositionRef.current?.id !== entry.id) return;
    compositionRef.current = { id: entry.id, updatedAt: entry.updatedAt };
    setComposition(compositionRef.current);
    if (projectRef.current.name !== entry.name) change({ ...projectRef.current, name: entry.name });
  }, [change]);

  const saveCopy = useCallback(async name => {
    await saveQueue.current.catch(() => {});
    const snapshot = validateProject({ ...projectRef.current, name: name.trim() });
    const entry = await request('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: snapshot.name, tags: [], project: snapshot }) });
    openComposition(entry);
    await save();
    return entry;
  }, [openComposition, save]);

  const importDraft = useCallback(next => {
    const valid = validateProject(next);
    compositionRef.current = null;
    setComposition(null);
    return change(valid);
  }, [change]);

  useEffect(() => {
    const warn = event => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    reload().catch(loadError => { setError(loadError.message); setStatus('Offline'); });
  }, [reload]);

  useEffect(() => {
    if (!loaded || !hydrated.current || !dirty.current) return undefined;
    const timer = setTimeout(() => dirty.current && save().catch(saveError => {
      setError(saveError.message);
      if (saveError.status !== 409) setStatus('Save failed');
    }), 650);
    return () => clearTimeout(timer);
  }, [project, loaded, save]);

  return {
    project,
    composition,
    openComposition,
    updateCompositionMetadata,
    saveCopy,
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

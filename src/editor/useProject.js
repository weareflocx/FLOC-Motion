import { useCallback, useEffect, useRef, useState } from 'react';
import { demoProject, patchLayer, validateProject } from '../project.js';
import { request } from './request.js';

/**
 * Owns the editor's project state and its revision-guarded local persistence.
 * Keeping the refs here prevents autosave and WebMCP from reading stale React
 * state while a control is being edited.
 */
export function useProject() {
  const [project, setProject] = useState(demoProject);
  const projectRef = useRef(project);
  const revisionRef = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const hydrated = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading project');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  const change = useCallback(next => {
    try {
      const valid = validateProject(next);
      const previous = projectRef.current;
      setHistory(items => [...items.slice(-19), previous]);
      projectRef.current = valid;
      setProject(valid);
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
    const action = saveQueue.current.catch(() => {}).then(async () => {
      try {
        const result = await request('/api/project', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: snapshot, revision: revisionRef.current })
        });
        revisionRef.current = result.revision;
        if (snapshot === projectRef.current) setStatus('Saved locally');
        return result;
      } catch (saveError) {
        // A second window may have advanced the revision. Keep the local draft
        // intact and surface the conflict instead of overwriting that window.
        if (saveError.status === 409) setStatus('Save conflict');
        throw saveError;
      }
    });
    saveQueue.current = action;
    return action;
  }, []);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    projectRef.current = previous;
    setProject(previous);
    setHistory(items => items.slice(0, -1));
    setStatus('Unsaved changes');
  }, [history]);

  const reload = useCallback(async () => {
    const data = await request('/api/project');
    const next = validateProject(data.project);
    projectRef.current = next;
    setProject(next);
    revisionRef.current = data.revision;
    setHistory([]);
    hydrated.current = true;
    setLoaded(true);
    setError('');
    setStatus('Saved locally');
    return next;
  }, []);

  useEffect(() => {
    reload().catch(loadError => { setError(loadError.message); setStatus('Offline'); });
  }, [reload]);

  useEffect(() => {
    if (!loaded || !hydrated.current) return undefined;
    const timer = setTimeout(() => save().catch(saveError => {
      setError(saveError.message);
      if (saveError.status !== 409) setStatus('Save failed');
    }), 650);
    return () => clearTimeout(timer);
  }, [project, loaded, save]);

  return {
    project,
    projectRef,
    loaded,
    status,
    error,
    setError,
    history,
    change,
    patch,
    save,
    undo,
    reload
  };
}

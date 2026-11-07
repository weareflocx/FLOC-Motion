import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DISTRIBUTE_LAYOUTS, defaultDistribution } from './distribute.js';
import { excludedLayers, transformableLayers } from './selection.js';

const stageRoot = () => document.querySelector('.workspace .stage[aria-busy="false"]');

// Layout options merge per layout; `center` and the other common settings replace.
function merged(settings, patch) {
  const next = { ...settings };
  for (const [key, value] of Object.entries(patch)) next[key] = Object.hasOwn(DISTRIBUTE_LAYOUTS, key) ? { ...settings[key], ...value } : value;
  return next;
}
// Center and radius describe one placement; a new session starts from the selection again.
const released = settings => ({ ...settings, center: null, circle: { ...settings.circle, radius: null }, arc: { ...settings.arc, radius: null } });

// Live distribution preview for the multi-selection. Changing a setting measures the
// selection once, then shows each plan through the canvas placement preview (playback
// pauses). Nothing reaches history or autosave until `apply`, which commits one change.
// The preview ends on Apply, Cancel, Escape, a selection or project change, playback,
// or when another canvas preview replaces it.
export function useDistribution({ project, projectRef, clock, time, selection, positionPreview, previewPosition, distributeLayers, root = stageRoot }) {
  const [settings, setSettings] = useState(defaultDistribution);
  const [session, setSession] = useState(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const sessionRef = useRef(session); sessionRef.current = session;
  const selectionRef = useRef(selection); selectionRef.current = selection;

  const end = useCallback(() => {
    setSettings(current => released(current));
    if (!sessionRef.current) return;
    sessionRef.current = null; setSession(null); previewPosition(null);
  }, [previewPosition]);
  const endRef = useRef(end); endRef.current = end;

  const show = useCallback(next => {
    const current = sessionRef.current;
    const plan = distributeLayers(next, selectionRef.current, current?.snapshot.time ?? clock.get().time, root(), current ? { snapshot: current.snapshot } : {});
    if (!plan) { endRef.current(); return; }
    const value = { snapshot: plan.snapshot, plan, preview: plan.preview };
    sessionRef.current = value; setSession(value); previewPosition(plan.preview);
  }, [clock, distributeLayers, previewPosition, root]);

  // `patch` is `{ layout }`, a common setting such as `{ order }`, `{ center }` or
  // `{ safeArea }`, or layout options like `{ circle: { radius: 30 } }`.
  const change = useCallback(patch => {
    const next = merged(settingsRef.current, patch);
    settingsRef.current = next; setSettings(next); show(next);
  }, [show]);

  const apply = useCallback(() => {
    const current = sessionRef.current, next = settingsRef.current;
    if (current) { sessionRef.current = null; setSession(null); previewPosition(null); }
    const result = distributeLayers(next, selectionRef.current, current?.snapshot.time ?? clock.get().time, root(), { commit: true, ...(current ? { snapshot: current.snapshot } : {}) });
    setSettings(released(next));
    return result;
  }, [clock, distributeLayers, previewPosition, root]);

  const selectionKey = selection.join('\n');
  useEffect(() => () => endRef.current(), [selectionKey]);
  useEffect(() => { if (session && projectRef.current !== session.snapshot.project) end(); }, [project]);
  // Another canvas gesture or preview took over the stage.
  useEffect(() => { if (session && positionPreview !== session.preview) { sessionRef.current = null; setSession(null); } }, [positionPreview]);
  useEffect(() => clock.subscribe(() => { if (sessionRef.current && clock.get().playing) endRef.current(); }), [clock]);
  const active = Boolean(session);
  useEffect(() => {
    if (!active) return undefined;
    // Fields that cancel their own draft on Escape prevent the default first.
    const onKey = event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); endRef.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const movable = useMemo(() => transformableLayers(project, selection, time).length, [project, selection, time]);
  const excluded = useMemo(() => excludedLayers(project, selection, time), [project, selection, time]);
  return { available: movable >= 2, movable, excluded, settings, active, plan: session?.plan ?? null, change, apply, cancel: end };
}

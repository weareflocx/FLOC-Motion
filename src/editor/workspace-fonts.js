import { useEffect, useSyncExternalStore } from 'react';
import { request } from './request.js';
import { workspaceFontFaceCss, workspaceFontFile } from '../fonts.js';

// The workspace font library as the editor sees it. Its @font-face rules are injected before
// the preview builds a scene, so the scene's own font loading waits for workspace faces too.
let state = { faces: [], loaded: false, error: '' };
let pending = null, loadedAt = 0;
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

export function setWorkspaceFonts(faces) {
  let style = document.getElementById('floc-workspace-fonts');
  if (!style) { style = document.createElement('style'); style.id = 'floc-workspace-fonts'; document.head.appendChild(style); }
  style.textContent = workspaceFontFaceCss(faces, face => `/fonts/workspace/${workspaceFontFile(face)}`);
  state = { faces, loaded: true, error: '' }; loadedAt = Date.now();
  notify();
}

export function loadWorkspaceFonts() {
  pending = request('/api/fonts').then(data => setWorkspaceFonts(data.fonts), error => {
    // Text naming an unavailable face renders in Geist; the inspector explains why.
    state = { ...state, loaded: true, error: error.message };
    notify();
  });
  return pending;
}

// Resolves once the library is known (or failed to load); it never rejects. A failed load is retried.
export const workspaceFontsReady = () => pending && !state.error ? pending : loadWorkspaceFonts();

// Font pickers refresh a list older than a minute, so fonts an admin adds show up without a reload.
export function useWorkspaceFonts() {
  useEffect(() => { if (state.loaded && Date.now() - loadedAt > 60000) loadWorkspaceFonts(); else workspaceFontsReady(); }, []);
  return useSyncExternalStore(subscribe, () => state);
}

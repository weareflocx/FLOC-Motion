// sessionStorage keeps each tab's active composition independent, including
// when several people use the shared library from different browsers.
export function editorSession(userId = 'local', storage = globalThis.sessionStorage) {
  const key = `floc.editor.${userId}`;
  let stored;
  try { stored = JSON.parse(storage?.getItem(key) || 'null'); } catch {}
  const session = { draftId: stored?.draftId || crypto.randomUUID(), compositionId: stored?.compositionId || null };
  session.remember = () => { try { storage?.setItem(key, JSON.stringify({ draftId: session.draftId, compositionId: session.compositionId })); } catch {} };
  session.remember();
  return session;
}

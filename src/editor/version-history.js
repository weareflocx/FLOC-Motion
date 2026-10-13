import { request } from './request.js';

/**
 * Restores a saved version through the server, then applies it as one ordinary
 * editor change so Undo returns to the pre-restore project. Pending edits are
 * saved first; a stale composition revision surfaces as the server's 409.
 */
export async function restoreCompositionVersion(version, { save, change, updateCompositionMetadata }) {
  const { composition } = await save();
  if (!composition) throw new Error('Open a saved composition to restore a version.');
  const entry = await request(`/api/templates/${composition.id}/versions/${version}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: composition.updatedAt }) });
  // Versions may predate current locks; restoring is a composition-wide replacement like opening.
  if (!change({ ...entry.project, name: entry.name }, { replace: true })) throw new Error('The restored version could not be applied. Reload the composition.');
  updateCompositionMetadata(entry);
  return entry;
}

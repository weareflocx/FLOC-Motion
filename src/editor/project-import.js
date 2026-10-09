import { validateProject } from '../project.js';

export const MAX_PROJECT_IMPORT_BYTES = 2e6;

export async function parseProjectFile(file) {
  if (!file || typeof file.text !== 'function') throw new Error('Choose a project JSON file.');
  if (Number.isFinite(file.size) && file.size > MAX_PROJECT_IMPORT_BYTES) throw new Error('Project JSON must be 2 MB or smaller.');
  const source = await file.text();
  if (new Blob([source]).size > MAX_PROJECT_IMPORT_BYTES) throw new Error('Project JSON must be 2 MB or smaller.');
  return validateProject(JSON.parse(source));
}

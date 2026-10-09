import path from 'node:path';
import { demoProject, validateProject } from '../src/project.js';
import { readJson, writeJsonAtomic } from './json-store.mjs';

export function createDraftStore(data) {
  const directory = path.join(data, 'drafts');
  let queue = Promise.resolve();
  const serial = action => { const result = queue.catch(() => {}).then(action); queue = result; return result; };
  function filename(id) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid draft ID.');
    return path.join(directory, `${id}.json`);
  }
  async function read(id) {
    const saved = await readJson(filename(id), { missing: { project: demoProject(), revision: 0 } });
    return { project: validateProject(saved.project), revision: saved.revision };
  }
  return {
    read: id => serial(() => read(id)),
    update: (id, input) => serial(async () => {
      const current = await read(id);
      if (input.revision !== current.revision) throw Object.assign(new Error('This draft changed in another window. Reload before saving.'), { status: 409 });
      const saved = { project: validateProject(input.project), revision: current.revision + 1 };
      await writeJsonAtomic(filename(id), saved);
      return { revision: saved.revision, composition: null };
    })
  };
}

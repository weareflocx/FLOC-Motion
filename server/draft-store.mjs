import { blankProject, validateProject } from '../src/project.js';
import { database, transaction, UUID } from './database.mjs';

export function createDraftStore(data) {
  const db = database(data);
  function read(id) {
    if (!UUID.test(id)) throw new Error('Invalid draft ID.');
    const saved = db.prepare('SELECT project, revision FROM drafts WHERE id = ?').get(id);
    return saved ? { project: validateProject(JSON.parse(saved.project)), revision: saved.revision } : { project: validateProject(blankProject()), revision: 0 };
  }
  return {
    read: async id => read(id),
    update: async (id, input) => transaction(db, () => {
      const current = read(id);
      if (input.revision !== current.revision) throw Object.assign(new Error('This draft changed in another window. Reload before saving.'), { status: 409 });
      const revision = current.revision + 1;
      db.prepare('INSERT INTO drafts (id, project, revision) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET project = excluded.project, revision = excluded.revision').run(id, JSON.stringify(validateProject(input.project)), revision);
      return { revision, composition: null };
    })
  };
}

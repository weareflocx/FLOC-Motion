import { mkdir, readFile, readdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProject } from '../src/project.js';

function metadata(input) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) throw new Error('Template name must contain 1–100 characters.');
  if (!Array.isArray(input.tags) || input.tags.length > 10 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 30)) throw new Error('Use up to 10 tags of 1–30 characters.');
  return { name: input.name.trim(), tags: [...new Set(input.tags.map(tag => tag.trim()))] };
}
export function createTemplateStore(data) {
  const directory = path.join(data, 'templates');
  let queue = Promise.resolve();
  const serial = action => { const result = queue.catch(() => {}).then(action); queue = result; return result; };
  function filename(id) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid template ID.');
    return path.join(directory, `${id}.json`);
  }
  async function read(id) {
    const entry = JSON.parse(await readFile(filename(id), 'utf8'));
    if (entry.id !== id) throw new Error('Invalid saved template.');
    return { ...entry, ...metadata(entry), project: validateProject(entry.project) };
  }
  async function write(entry) {
    const target = filename(entry.id), temporary = `${target}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, JSON.stringify(entry));
    await rename(temporary, target);
    return entry;
  }
  return {
    list: () => serial(async () => {
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter(file => file.endsWith('.json'));
      const entries = await Promise.all(files.map(file => read(file.slice(0, -5))));
      return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }),
    create: input => serial(async () => {
      const fields = metadata(input), project = validateProject(input.project);
      const now = new Date().toISOString();
      return write({ id: randomUUID(), ...fields, project, createdAt: now, updatedAt: now });
    }),
    update: (id, input) => serial(async () => {
      const fields = metadata(input), entry = await read(id);
      return write({ ...entry, ...fields, updatedAt: new Date().toISOString() });
    }),
    remove: id => serial(async () => { await unlink(filename(id)); })
  };
}

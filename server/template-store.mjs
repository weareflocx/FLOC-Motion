import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProject } from '../src/project.js';
import { database, transaction, UUID } from './database.mjs';
import { createAuditLog } from './audit-log.mjs';

export const VERSION_LIMIT = 100;
// Autosaves from one author within this window refine their newest save version instead of adding one.
export const VERSION_COALESCE_MS = 10 * 60 * 1000;
const failure = (message, status) => Object.assign(new Error(message), { status });
function metadata(input) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) throw new Error('Template name must contain 1–100 characters.');
  if (!Array.isArray(input.tags) || input.tags.length > 10 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 30)) throw new Error('Use up to 10 tags of 1–30 characters.');
  return { name: input.name.trim(), tags: [...new Set(input.tags.map(tag => tag.trim()))] };
}
const versionNumber = value => { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid version.'); return number; };
const versionMetadata = row => ({ version: row.version, name: row.name, createdAt: row.created_at, author: row.author_id ? { id: row.author_id, email: row.author_email } : null, restoredFrom: row.restored_from ?? null });

export function createTemplateStore(data, { now = Date.now } = {}) {
  const db = database(data), audit = createAuditLog(data, { now });
  const logComposition = (userId, action, id, details) => audit.record({ actorId: userId ?? null, action, target: { type: 'composition', id }, details });
  function row(id) {
    if (!UUID.test(id)) throw new Error('Invalid template ID.');
    const saved = db.prepare('SELECT id, name, tags, project, created_at, updated_at FROM templates WHERE id = ?').get(id);
    if (!saved) throw failure('Composition not found.', 404);
    return saved;
  }
  function entry(saved) {
    const value = { id: saved.id, name: saved.name, tags: JSON.parse(saved.tags), project: JSON.parse(saved.project), createdAt: saved.created_at, updatedAt: saved.updated_at };
    return { ...value, ...metadata(value), project: validateProject(value.project) };
  }
  const read = id => entry(row(id));
  // Every saved state of a composition is recoverable; only the newest versions are kept.
  // `kind` is create, import, save or restore; only consecutive saves coalesce, so restores
  // and the original state are never overwritten. The window runs from when a version was
  // started, so continuous editing still yields at least one version per window.
  function recordVersion(id, { name, project }, { kind, userId = null, restoredFrom = null }) {
    const time = now(), stamp = new Date(time).toISOString();
    const newest = db.prepare('SELECT version, kind, author_id, coalesce(started_at, created_at) AS started_at FROM composition_versions WHERE composition_id = ? ORDER BY version DESC LIMIT 1').get(id);
    if (kind === 'save' && newest?.kind === 'save' && newest.author_id === userId && time - Date.parse(newest.started_at) < VERSION_COALESCE_MS) {
      db.prepare('UPDATE composition_versions SET name = ?, project = ?, created_at = ? WHERE composition_id = ? AND version = ?').run(name, JSON.stringify(project), stamp, id, newest.version);
      return;
    }
    const version = (newest?.version ?? 0) + 1;
    db.prepare('INSERT INTO composition_versions (composition_id, version, name, project, author_id, created_at, started_at, restored_from, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, version, name, JSON.stringify(project), userId, stamp, stamp, restoredFrom, kind);
    db.prepare('DELETE FROM composition_versions WHERE composition_id = ? AND version <= ?').run(id, version - VERSION_LIMIT);
  }
  function write(value) {
    db.prepare('INSERT INTO templates (id, name, tags, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, tags = excluded.tags, project = excluded.project, updated_at = excluded.updated_at').run(value.id, value.name, JSON.stringify(value.tags), JSON.stringify(value.project), value.createdAt, value.updatedAt);
    return value;
  }
  function checkRevision(current, updatedAt) {
    if (updatedAt && updatedAt !== current.updatedAt) throw failure('This composition changed in another window. Reopen it before saving.', 409);
  }
  const nextUpdatedAt = current => new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
  function version(id, number) {
    row(id);
    const saved = db.prepare('SELECT v.*, u.email AS author_email FROM composition_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.composition_id = ? AND v.version = ?').get(id, versionNumber(number));
    if (!saved) throw failure('Version not found.', 404);
    return { ...versionMetadata(saved), project: validateProject(JSON.parse(saved.project)) };
  }
  return {
    read: async id => read(id),
    archiveDraft: async (id, { userId } = {}) => transaction(db, () => {
      if (!UUID.test(id)) throw new Error('Invalid draft ID.');
      const draft = db.prepare('SELECT project, revision FROM drafts WHERE id = ?').get(id);
      if (!draft) return null;
      const key = `draft-archive:${id}:${draft.revision}`;
      const marker = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
      if (marker) {
        const saved = db.prepare('SELECT id, name, tags, project, created_at, updated_at FROM templates WHERE id = ?').get(JSON.parse(marker.value).compositionId);
        return saved ? entry(saved) : null;
      }
      const project = validateProject(JSON.parse(draft.project));
      const fields = metadata({ name: project.name.trim() || 'Untitled', tags: [] });
      const stamp = new Date(now()).toISOString();
      const value = write({ id: randomUUID(), ...fields, project, createdAt: stamp, updatedAt: stamp });
      recordVersion(value.id, value, { kind: 'import', userId });
      logComposition(userId, 'composition.created', value.id, { name: value.name });
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(key, JSON.stringify({ compositionId: value.id }));
      return value;
    }),
    preserveLegacyProject: async () => {
      const recorded = () => db.prepare("SELECT 1 FROM meta WHERE key = 'legacy-project'").get();
      if (recorded()) return;
      const finish = id => db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('legacy-project', ?)").run(JSON.stringify({ compositionId: id }));
      const readLegacy = async name => { try { return JSON.parse(await readFile(path.join(data, name), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
      // Workspaces migrated before SQLite recorded the same decision in a marker file.
      const marker = await readLegacy('project-migration.json');
      if (marker) return void finish(marker.compositionId ?? null);
      const saved = await readLegacy('project.json');
      if (!saved) return;
      transaction(db, () => {
        if (recorded()) return;
        const exists = id => typeof id === 'string' && db.prepare('SELECT 1 FROM templates WHERE id = ?').get(id);
        if (exists(saved.composition?.id)) return void finish(saved.composition.id);
        // Stable identity makes migration repeatable, including after a restart.
        const id = '00000000-0000-4000-8000-000000000001';
        if (!exists(id)) {
          const project = validateProject(saved.project), stamp = new Date().toISOString();
          recordVersion(id, write({ id, name: project.name, tags: [], project, createdAt: stamp, updatedAt: stamp }), { kind: 'import' });
        }
        finish(id);
      });
    },
    list: async () => db.prepare('SELECT id, name, tags, project, created_at, updated_at FROM templates ORDER BY updated_at DESC, id').all().map(entry),
    create: async (input, { userId } = {}) => transaction(db, () => {
      const fields = metadata(input), project = validateProject(input.project);
      const stamp = new Date().toISOString();
      const value = write({ id: randomUUID(), ...fields, project, createdAt: stamp, updatedAt: stamp });
      recordVersion(value.id, value, { kind: 'create', userId });
      logComposition(userId, 'composition.created', value.id, { name: value.name });
      return value;
    }),
    update: async (id, input, { userId } = {}) => transaction(db, () => {
      const current = read(id), fields = metadata({ ...current, ...input });
      if (input.project && !input.updatedAt) throw failure('A composition revision is required.', 400);
      checkRevision(current, input.updatedAt);
      const project = input.project ? validateProject(input.project) : current.project;
      const value = write({ ...current, ...fields, project, updatedAt: nextUpdatedAt(current) });
      if (value.name !== current.name || JSON.stringify(project) !== JSON.stringify(current.project)) recordVersion(id, value, { kind: 'save', userId });
      if (value.name !== current.name) logComposition(userId, 'composition.renamed', id, { from: current.name, to: value.name });
      return value;
    }),
    versions: async id => {
      row(id);
      return db.prepare('SELECT v.version, v.name, v.created_at, v.author_id, v.restored_from, u.email AS author_email FROM composition_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.composition_id = ? ORDER BY v.version DESC').all(id).map(versionMetadata);
    },
    version: async (id, number) => version(id, number),
    // Restoring never rewrites history: the old state becomes a new current version.
    restore: async (id, number, input, { userId } = {}) => transaction(db, () => {
      const current = read(id);
      if (!input?.updatedAt) throw failure('A composition revision is required.', 400);
      checkRevision(current, input.updatedAt);
      const saved = version(id, number);
      const value = write({ ...current, name: metadata({ ...current, name: saved.name }).name, project: saved.project, updatedAt: nextUpdatedAt(current) });
      recordVersion(id, value, { kind: 'restore', userId, restoredFrom: saved.version });
      logComposition(userId, 'composition.restored', id, { name: value.name, version: saved.version });
      return value;
    }),
    remove: async (id, { userId } = {}) => transaction(db, () => {
      const { name } = row(id);
      db.prepare('DELETE FROM templates WHERE id = ?').run(id);
      logComposition(userId, 'composition.deleted', id, { name });
    })
  };
}

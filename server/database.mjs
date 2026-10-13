import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Workspace persistence. Render jobs stay as files in renders/ so renderers never need this module.
export const DATABASE_FILE = 'floc.db';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

// Asset references are maintained by triggers so quota checks never parse stored projects.
const assetTriggers = (table, owner) => `
  CREATE TRIGGER ${table}_assets_insert AFTER INSERT ON ${table} BEGIN
    INSERT OR IGNORE INTO asset_references (owner, asset) SELECT ${owner('NEW')}, substr(value, 9) FROM json_tree(NEW.project) WHERE type = 'text' AND value GLOB '/assets/?*' AND substr(value, 9) NOT GLOB '*/*';
  END;
  CREATE TRIGGER ${table}_assets_update AFTER UPDATE OF project ON ${table} BEGIN
    DELETE FROM asset_references WHERE owner = ${owner('OLD')};
    INSERT OR IGNORE INTO asset_references (owner, asset) SELECT ${owner('NEW')}, substr(value, 9) FROM json_tree(NEW.project) WHERE type = 'text' AND value GLOB '/assets/?*' AND substr(value, 9) NOT GLOB '*/*';
  END;
  CREATE TRIGGER ${table}_assets_delete AFTER DELETE ON ${table} BEGIN
    DELETE FROM asset_references WHERE owner = ${owner('OLD')};
  END;`;

const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
  CREATE TABLE sessions (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE INDEX sessions_user ON sessions (user_id, expires_at);
  CREATE TABLE invitations (email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE drafts (id TEXT PRIMARY KEY, project TEXT NOT NULL, revision INTEGER NOT NULL);
  CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, tags TEXT NOT NULL, project TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX templates_updated ON templates (updated_at);
  CREATE TABLE composition_versions (composition_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE, version INTEGER NOT NULL, name TEXT NOT NULL, project TEXT NOT NULL, author_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, restored_from INTEGER, PRIMARY KEY (composition_id, version)) WITHOUT ROWID;
  CREATE TABLE renderer_devices (id TEXT PRIMARY KEY, name TEXT, browser_hash TEXT NOT NULL, engine_hash TEXT);
  CREATE TABLE asset_references (owner TEXT NOT NULL, asset TEXT NOT NULL, PRIMARY KEY (owner, asset)) WITHOUT ROWID;
  ${assetTriggers('drafts', row => `'draft:' || ${row}.id`)}
  ${assetTriggers('templates', row => `'template:' || ${row}.id`)}
  ${assetTriggers('composition_versions', row => `'version:' || ${row}.composition_id || ':' || ${row}.version`)}`,
  // Version kinds let rapid saves coalesce without ever merging creation, import or restore entries.
  `ALTER TABLE composition_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'save' CHECK (kind IN ('create', 'import', 'save', 'restore'));
  UPDATE composition_versions SET kind = CASE WHEN restored_from IS NOT NULL THEN 'restore' WHEN author_id IS NULL THEN 'import' WHEN version = 1 THEN 'create' ELSE 'save' END;`,
  // created_at shows the latest coalesced save; started_at anchors the coalescing window.
  `ALTER TABLE composition_versions ADD COLUMN started_at TEXT;
  UPDATE composition_versions SET started_at = created_at;`
];
export const SCHEMA_VERSION = MIGRATIONS.length;

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  transaction(db, () => {
    const current = db.prepare('SELECT coalesce(max(version), 0) AS version FROM schema_migrations').get().version;
    for (let version = current + 1; version <= MIGRATIONS.length; version++) {
      db.exec(MIGRATIONS[version - 1]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    }
  });
}

function legacyJson(filename) {
  let source;
  try { source = readFileSync(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return JSON.parse(source); }
  catch (cause) { throw Object.assign(new Error(`Persisted JSON is corrupt: ${path.basename(filename)}.`, { cause }), { code: 'EINVALIDJSON', status: 500 }); }
}
function legacyFiles(directory) {
  try { return readdirSync(directory).filter(name => name.endsWith('.json')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

// One-time copy of the JSON workspace. The files stay in place as a legacy backup.
function importLegacyJson(db, data) {
  const done = () => db.prepare("SELECT 1 FROM meta WHERE key = 'legacy-json-import'").get();
  if (done()) return;
  transaction(db, () => {
    if (done()) return;
    const counts = { users: 0, sessions: 0, invitations: 0, drafts: 0, templates: 0, renderers: 0 };
    const auth = legacyJson(path.join(data, 'access', 'auth.json'));
    for (const user of auth?.users || []) { db.prepare('INSERT INTO users (id, email, salt, password_hash) VALUES (?, ?, ?, ?)').run(user.id, user.email, user.salt, user.passwordHash); counts.users++; }
    for (const item of auth?.invitations || []) { db.prepare('INSERT OR REPLACE INTO invitations (email, hash, expires_at) VALUES (?, ?, ?)').run(item.email, item.hash, item.expiresAt); counts.invitations++; }
    const user = db.prepare('SELECT 1 FROM users WHERE id = ?');
    for (const item of auth?.sessions || []) if (user.get(item.userId)) { db.prepare('INSERT OR IGNORE INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)').run(item.hash, item.userId, item.expiresAt); counts.sessions++; }
    for (const file of legacyFiles(path.join(data, 'drafts'))) {
      const id = file.slice(0, -5);
      if (!UUID.test(id)) continue; // never reachable through the draft API
      const saved = legacyJson(path.join(data, 'drafts', file));
      db.prepare('INSERT INTO drafts (id, project, revision) VALUES (?, ?, ?)').run(id, JSON.stringify(saved.project ?? null), saved.revision);
      counts.drafts++;
    }
    for (const file of legacyFiles(path.join(data, 'templates'))) {
      const id = file.slice(0, -5), entry = legacyJson(path.join(data, 'templates', file));
      if (!UUID.test(id) || entry.id !== id || typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string') throw Object.assign(new Error(`Invalid saved template: ${file}.`), { status: 500 });
      const project = JSON.stringify(entry.project ?? null);
      db.prepare('INSERT INTO templates (id, name, tags, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, String(entry.name), JSON.stringify(entry.tags ?? null), project, entry.createdAt, entry.updatedAt);
      db.prepare("INSERT INTO composition_versions (composition_id, version, name, project, created_at, started_at, kind) VALUES (?, 1, ?, ?, ?, ?, 'import')").run(id, String(entry.name), project, entry.updatedAt, entry.updatedAt);
      counts.templates++;
    }
    for (const file of legacyFiles(path.join(data, 'renderers'))) {
      const device = legacyJson(path.join(data, 'renderers', file));
      if (!UUID.test(device?.id || '') || typeof device.browserHash !== 'string') continue;
      db.prepare('INSERT INTO renderer_devices (id, name, browser_hash, engine_hash) VALUES (?, ?, ?, ?)').run(device.id, device.name ?? null, device.browserHash, device.engineHash ?? null);
      counts.renderers++;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('legacy-json-import', ?)").run(JSON.stringify({ importedAt: new Date().toISOString(), ...counts }));
  });
}

const connections = new Map();
// One shared connection per workspace; node:sqlite is synchronous, so each statement or
// transaction is atomic with respect to the rest of this process. WAL + busy timeout cover
// other processes such as the invite script.
export function database(data) {
  const directory = path.resolve(data), filename = path.join(directory, DATABASE_FILE);
  if (connections.has(filename)) return connections.get(filename);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    chmodSync(filename, 0o600);
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    migrate(db);
    importLegacyJson(db, directory);
  } catch (error) { db.close(); throw error; }
  connections.set(filename, db);
  return db;
}
export function closeDatabase(data) {
  const filename = path.join(path.resolve(data), DATABASE_FILE);
  connections.get(filename)?.close();
  connections.delete(filename);
}

export function verifyDatabaseFile(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const check = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
    if (check.length !== 1 || check[0] !== 'ok') throw new Error(`Workspace database failed integrity verification: ${check.slice(0, 3).join('; ')}`);
    const schema = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (!schema) throw new Error('Workspace database has no schema version.');
    return { schemaVersion: db.prepare('SELECT coalesce(max(version), 0) AS version FROM schema_migrations').get().version };
  } finally { db.close(); }
}

// Consistent online copy of a live database, stored as a self-contained rollback-journal file.
export async function snapshotDatabase(source, destination) {
  const db = new DatabaseSync(source);
  try { db.exec('PRAGMA busy_timeout = 5000'); await backup(db, destination); }
  finally { db.close(); }
  const copy = new DatabaseSync(destination);
  try { copy.exec('PRAGMA journal_mode = DELETE'); }
  finally { copy.close(); }
  chmodSync(destination, 0o600);
  return verifyDatabaseFile(destination);
}

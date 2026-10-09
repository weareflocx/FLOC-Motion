import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceBackup, restoreWorkspaceBackup, verifyWorkspaceBackup } from '../scripts/workspace-backup-lib.mjs';

const folder = async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'floc-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};
const put = async (root, relative, value) => {
  const filename = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, value);
};
const manifest = backup => readFile(path.join(backup, 'manifest.json'), 'utf8').then(JSON.parse);

async function workspace(t) {
  const root = await folder(t);
  const data = path.join(root, 'workspace');
  await mkdir(data);
  await put(data, 'project.json', '{"project":true}\n');
  await put(data, 'project-migration.json', '{"migrated":true}\n');
  await put(data, 'access/auth.json', '{"users":[]}\n');
  await put(data, 'assets/a.png', Buffer.from([0, 1, 2, 255]));
  await put(data, 'drafts/draft.json', '{"draft":true}\n');
  await put(data, 'templates/template.json', '{"template":true}\n');
  await put(data, 'renderers/renderers.json', '{"devices":[]}\n');
  await put(data, 'renders/job-1/job.json', '{"state":"done"}\n');
  await put(data, 'renders/job-1/render-input.json', '{"project":{}}\n');
  await put(data, 'renders/job-1/render.log', 'rendered\n');
  await put(data, 'renders/job-1/video.mp4', 'derived-video');
  await put(data, 'renders/job-1/silent.mp4', 'derived-silent');
  await put(data, 'renders/job-1/prepared/media.png', 'derived-prepared');
  await put(data, 'renders/job-1/frames/0001.png', 'derived-frame');
  await put(data, 'assets/stale.upload', 'temporary');
  await put(data, 'access/auth.json.tmp-123', 'temporary');
  await put(data, 'engine/scene.js', 'generated');
  await put(data, 'diagnostics/debug.mp4', 'diagnostic');
  return { root, data };
}

async function assertSameIncludedFiles(source, restored, paths) {
  for (const relative of paths) assert.deepEqual(await readFile(path.join(restored, ...relative.split('/'))), await readFile(path.join(source, ...relative.split('/'))));
}

test('backup and restore round trip authoritative data only', async t => {
  const { root, data } = await workspace(t);
  const backup = path.join(root, 'backup');
  const restored = path.join(root, 'restored');
  const created = await createWorkspaceBackup(data, backup, { now: () => Date.UTC(2026, 9, 10) });
  assert.equal(created.createdAt, '2026-10-10T00:00:00.000Z');
  assert.deepEqual(created.files.map(file => file.path), [...created.files.map(file => file.path)].sort((a, b) => a.localeCompare(b)));
  assert.ok(created.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual(created.files.map(file => file.path), [
    'access/auth.json', 'assets/a.png', 'drafts/draft.json', 'project-migration.json', 'project.json',
    'renderers/renderers.json', 'renders/job-1/job.json', 'renders/job-1/render-input.json', 'renders/job-1/render.log', 'templates/template.json',
  ].sort((a, b) => a.localeCompare(b)));
  const verified = await verifyWorkspaceBackup(backup);
  assert.equal(verified.files, 10);
  await mkdir(restored);
  await restoreWorkspaceBackup(backup, restored);
  await assertSameIncludedFiles(data, restored, created.files.map(file => file.path));
  assert.rejects(readFile(path.join(restored, 'renders/job-1/video.mp4')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(restored, 'assets/stale.upload')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(restored, 'access/auth.json.tmp-123')), { code: 'ENOENT' });
});

test('verification rejects corrupt, missing, and extra payload files', async t => {
  for (const kind of ['corrupt', 'missing', 'extra']) {
    const { root, data } = await workspace(t);
    const backup = path.join(root, `backup-${kind}`);
    await createWorkspaceBackup(data, backup);
    const first = (await manifest(backup)).files[0].path;
    if (kind === 'corrupt') await writeFile(path.join(backup, 'files', ...first.split('/')), 'changed');
    if (kind === 'missing') await rm(path.join(backup, 'files', ...first.split('/')));
    if (kind === 'extra') await put(path.join(backup, 'files'), 'assets/extra.png', 'extra');
    await assert.rejects(verifyWorkspaceBackup(backup), /integrity verification|does not match/);
  }
});

test('manifest traversal and unsupported files are rejected before restore writes', async t => {
  const { root, data } = await workspace(t);
  const backup = path.join(root, 'backup');
  const target = path.join(root, 'target');
  await createWorkspaceBackup(data, backup);
  const value = await manifest(backup);
  value.files[0].path = '../outside';
  await writeFile(path.join(backup, 'manifest.json'), JSON.stringify(value));
  await assert.rejects(restoreWorkspaceBackup(backup, target), /escapes the workspace/);
  await assert.rejects(readdir(target), { code: 'ENOENT' });
});

test('restore refuses non-empty targets without modifying them', async t => {
  const { root, data } = await workspace(t);
  const backup = path.join(root, 'backup');
  const target = path.join(root, 'target');
  await createWorkspaceBackup(data, backup);
  await put(target, 'keep.txt', 'keep');
  await assert.rejects(restoreWorkspaceBackup(backup, target), /must be empty/);
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('backup refuses symlinks in included workspace data', async t => {
  const { root, data } = await workspace(t);
  await symlink(path.join(data, 'project.json'), path.join(data, 'assets/link.json'));
  await assert.rejects(createWorkspaceBackup(data, path.join(root, 'backup')), /do not follow symbolic links/);
  await assert.rejects(readdir(path.join(root, 'backup')), { code: 'ENOENT' });
});

test('backup refuses an existing destination and a destination inside the workspace', async t => {
  const { root, data } = await workspace(t);
  const existing = path.join(root, 'existing');
  await mkdir(existing);
  await assert.rejects(createWorkspaceBackup(data, existing), /already exists/);
  await assert.rejects(createWorkspaceBackup(data, path.join(data, 'backup')), /outside the workspace/);
});

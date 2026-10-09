#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { createWorkspaceBackup, restoreWorkspaceBackup, verifyWorkspaceBackup } from './workspace-backup-lib.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/workspace-backup.mjs backup <backup-directory> [workspace-directory]',
    '  node scripts/workspace-backup.mjs verify <backup-directory>',
    '  node scripts/workspace-backup.mjs restore <backup-directory> <workspace-directory>',
    '',
    'The workspace defaults to FLOC_DATA_DIR or .data for backup.',
    'Backup and restore destinations must not exist; restore also accepts an empty directory.',
  ].join('\n');
}

async function main([command, ...args]) {
  if (command === 'backup' && (args.length === 1 || args.length === 2)) {
    const source = path.resolve(args[1] || process.env.FLOC_DATA_DIR || '.data');
    const destination = path.resolve(args[0]);
    const manifest = await createWorkspaceBackup(source, destination);
    console.log(JSON.stringify({ operation: 'backup', source, destination, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0) }));
    return;
  }
  if (command === 'verify' && args.length === 1) {
    const backup = path.resolve(args[0]);
    const result = await verifyWorkspaceBackup(backup);
    console.log(JSON.stringify({ operation: 'verify', backup, files: result.files, bytes: result.bytes }));
    return;
  }
  if (command === 'restore' && args.length === 2) {
    const backup = path.resolve(args[0]);
    const target = path.resolve(args[1]);
    const manifest = await restoreWorkspaceBackup(backup, target);
    console.log(JSON.stringify({ operation: 'restore', backup, target, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0) }));
    return;
  }
  throw new Error(usage());
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const markerName = 'product-migration.json';
const marker = '{"schemaVersion":"tandem-product-migration/v1","legacyNamespaces":true}\n';
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
function inspect(path: string, directory: boolean): boolean {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) {
      throw new Error(`Tandem migration refuses aliased or invalid path: ${path}`);
    }
    return true;
  } catch (error) { if (missing(error)) return false; throw error; }
}
function legacyMarker(root: string): boolean {
  const path = resolve(root, '.tandem', markerName);
  if (!inspect(path, false)) return false;
  if (readFileSync(path, 'utf8') !== marker) throw new Error('Tandem migration receipt is invalid.');
  return true;
}

/** Move product-owned storage without rewriting historical journal or Conversation bytes. */
export function ensureTandemWorkspace(root: string): void {
  root = resolve(root);
  const oldDirectory = resolve(root, '.teleos'), directory = resolve(root, '.tandem');
  const oldIndex = resolve(root, 'TELEOS.md'), index = resolve(root, 'TANDEM.md');
  const oldState = inspect(oldDirectory, true), newState = inspect(directory, true);
  const oldFile = inspect(oldIndex, false), newFile = inspect(index, false);
  if (oldState && newState) throw new Error('Both .teleos and .tandem exist. Resolve the storage collision explicitly; neither was overwritten.');
  if (oldFile && newFile) throw new Error('Both TELEOS.md and TANDEM.md exist. Resolve the index collision explicitly; neither was overwritten.');
  if (!oldState && !oldFile) return;
  const lock = resolve(root, '.tandem-migration.lock');
  let fd: number;
  try { fd = openSync(lock, 'wx'); }
  catch (cause) { throw new Error('Tandem migration is already owned or interrupted. Verify it is inactive before removing its migration lock.', { cause }); }
  let lease: DatabaseSync | undefined;
  let migrationWriter: string | undefined;
  const writerToken = randomUUID();
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, workspace: root })); fsyncSync(fd);
    if (existsSync(directory) && oldState || existsSync(index) && oldFile) throw new Error('Tandem migration destination appeared; no overwrite is allowed.');
    if (oldState) {
      const legacyCanvas = resolve(oldDirectory, 'living-canvas');
      const hostState = resolve(legacyCanvas, 'host-state');
      for (const path of [legacyCanvas, hostState]) {
        if (!inspect(path, true)) mkdirSync(path);
      }
      const leasePath = resolve(hostState, 'writer-lease.sqlite');
      inspect(leasePath, false);
      lease = new DatabaseSync(leasePath);
      try { lease.exec('BEGIN EXCLUSIVE'); }
      catch (cause) { throw new Error('Close the active legacy runtime before migrating its workspace.', { cause }); }
      const writer = resolve(oldDirectory, 'living-canvas', 'host-state', 'writer.lock');
      if (inspect(writer, false)) {
        const original = readFileSync(writer, 'utf8');
        const owner = JSON.parse(original);
        const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
        if (owner.schemaVersion !== 'host-state-writer/v1' || Object.keys(owner).length !== 4
          || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid > 2147483647
          || typeof owner.token !== 'string' || !/^[a-f0-9-]{36}$/.test(owner.token) || typeof owner.workspace !== 'string'
          || key(owner.workspace) !== key(root)) {
          throw new Error('Legacy writer ownership is unverified; close the old runtime before migration.');
        }
        let dead = false;
        try { process.kill(owner.pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') dead = true; else throw error; }
        if (!dead) throw new Error('Close the active legacy runtime before migrating its workspace.');
        if (readFileSync(writer, 'utf8') !== original) throw new Error('Legacy writer ownership changed during migration.');
        unlinkSync(writer);
      }
      const writerFd = openSync(writer, 'wx');
      migrationWriter = writer;
      try {
        writeFileSync(writerFd, JSON.stringify({ schemaVersion: 'host-state-writer/v1',
          token: writerToken, pid: process.pid, workspace: root }));
        fsyncSync(writerFd);
      } finally { closeSync(writerFd); }
      // Old binaries honor this live ownership file. Release SQLite before moving
      // its parent directory because Windows does not rename an open database.
      lease.close(); lease = undefined;
      const receipt = resolve(oldDirectory, markerName);
      if (inspect(receipt, false)) {
        if (readFileSync(receipt, 'utf8') !== marker) throw new Error('Legacy migration receipt conflicts.');
      } else {
        const receiptFd = openSync(receipt, 'wx');
        try { writeFileSync(receiptFd, marker); fsyncSync(receiptFd); } finally { closeSync(receiptFd); }
      }
      renameSync(oldDirectory, directory);
      migrationWriter = resolve(directory, 'living-canvas', 'host-state', 'writer.lock');
    }
    if (oldFile) {
      const content = readFileSync(oldIndex);
      const indexFd = openSync(index, 'wx');
      try { writeFileSync(indexFd, content); fsyncSync(indexFd); } finally { closeSync(indexFd); }
      unlinkSync(oldIndex);
    }
  } finally {
    try {
      lease?.close();
      if (migrationWriter) {
        const owner = JSON.parse(readFileSync(migrationWriter, 'utf8'));
        if (owner.token !== writerToken) throw new Error('Migration writer ownership changed; refusing to remove it.');
        unlinkSync(migrationWriter);
      }
    } finally { closeSync(fd); unlinkSync(lock); }
  }
}

export function retainedHostNamespace(root: string, namespace: string): string {
  return legacyMarker(root) && namespace.startsWith('workspace/.tandem/')
    ? namespace.replace('workspace/.tandem/', 'workspace/.teleos/') : namespace;
}

export function currentHostNamespace(namespace: string): string {
  return namespace.replace(/^workspace\/\.teleos\//, 'workspace/.tandem/');
}

export function retainedHostImportPath(root: string, path: string): string {
  const prefix = resolve(root, '.tandem') + sep;
  return legacyMarker(root) && path.startsWith(prefix) ? resolve(root, '.teleos', path.slice(prefix.length)) : path;
}

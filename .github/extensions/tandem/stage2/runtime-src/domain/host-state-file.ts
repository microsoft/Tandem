import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, lstat, open, link, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { getHostStateWal } from './host-state-wal.ts';
import { ensureTandemWorkspace, retainedHostNamespace, currentHostNamespace, retainedHostImportPath } from './product-paths.ts';

const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const normalized = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
function canonicalRoot(path: string): string {
  try { return normalized(realpathSync(resolve(path))); }
  catch (error) { if (missing(error)) return normalized(resolve(path)); throw error; }
}
const registrations = new Map<string, Set<string>>();
interface DocumentTransaction {
  root: string;
  read(namespace: string, key: string): string | undefined;
  version(namespace: string, key: string): number;
  list(namespace: string): string[];
  changes: Map<string, { namespace: string; key: string; content: string | null; artifact: boolean; text: boolean }>;
  afterCommit: Array<() => void | Promise<void>>;
}
const documentTransaction = new AsyncLocalStorage<DocumentTransaction>();
const identity = (namespace: string, key: string) => JSON.stringify([namespace, key]);
export function inHostStateTransaction(root: string): boolean {
  return documentTransaction.getStore()?.root === canonicalRoot(root);
}
const documentLimit = 64 * 1024 * 1024;
const inlineLimit = 256 * 1024;
const importKey = (path: string) => {
  const root = workspaceForHostPath(path);
  return hash(normalized(root ? retainedHostImportPath(root, resolve(path)) : resolve(path)));
};
async function blobDirectory(root: string): Promise<string> {
  let directory = root;
  for (const part of ['.tandem', 'living-canvas', 'host-state', 'objects']) {
    directory = resolve(directory, part);
    try { await mkdir(directory); }
    catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error; }
    const value = await lstat(directory);
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('Host state object directory is aliased or invalid.');
  }
  return directory;
}

async function resolveDocument(root: string, content: string | undefined, text = false): Promise<string | undefined> {
  if (content === undefined) return undefined;
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 'host-state-blob/v1') {
    if (!text) return content;
    if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 'host-state-text/v1'
      || !('text' in value) || typeof value.text !== 'string') throw new Error('Host text state encoding is invalid.');
    return value.text;
  }
  const reference = value as { schemaVersion: string; digest?: unknown; bytes?: unknown; moduleSchema?: unknown };
  if (typeof reference.digest !== 'string' || !/^[a-f0-9]{64}$/.test(reference.digest)
    || typeof reference.bytes !== 'number' || !Number.isSafeInteger(reference.bytes) || reference.bytes < 0 || reference.bytes > documentLimit) {
    throw new Error('Host state immutable document reference is invalid.');
  }
  const path = resolve(root, '.tandem', 'living-canvas', 'host-state', 'objects', `${reference.digest}.json`);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size !== reference.bytes) throw new Error('Host state immutable document is unavailable or aliased.');
  const original = await exactText(path);
  if (original === undefined || hash(original) !== reference.digest) throw new Error('Host state immutable document checksum is invalid.');
  return text ? resolveDocument(root, original, true) : original;
}

async function storeDocument(root: string, content: string | null, artifact: boolean, text = false): Promise<string | null> {
  if (content === null) return null;
  if (text) content = JSON.stringify({ schemaVersion: 'host-state-text/v1', text: content });
  const bytes = Buffer.byteLength(content);
  if (bytes > documentLimit) throw new Error('Host state document exceeds the bounded 64 MiB snapshot limit.');
  const value = JSON.parse(content);
  if (!artifact && bytes <= inlineLimit) return content;
  const digest = hash(content), directory = await blobDirectory(root);
  const target = resolve(directory, `${digest}.json`), temporary = `${target}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx');
  try { await file.writeFile(content, 'utf8'); await file.sync(); }
  finally { await file.close(); }
  try { await link(temporary, target); }
  catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error;
    if (await exactText(target) !== content) throw new Error('Immutable Host state blob identity conflicts with existing data.');
  } finally { await rm(temporary, { force: true }); }
  return JSON.stringify({ schemaVersion: 'host-state-blob/v1', digest, bytes,
    moduleSchema: value?.payload?.schemaVersion ?? value?.schemaVersion ?? null });
}

export function workspaceForHostPath(directory: string): string | null {
  const absolute = resolve(directory);
  const marker = `${sep}.tandem${sep}living-canvas`;
  const index = absolute.toLowerCase().indexOf(marker);
  return index < 0 ? null : absolute.slice(0, index);
}

export function hostStateNamespace(root: string, directory: string): string {
  const local = relative(resolve(root), resolve(directory));
  return retainedHostNamespace(root, !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`)
    ? `workspace/${local.split(sep).join('/')}` : `external/${normalized(resolve(directory)).split(sep).join('/')}`);
}

export function immutableHostArtifact(name: string): boolean {
  return /^(inventory|patch|index-observation)-[a-f0-9]{64}\.json$/.test(name);
}

async function exactText(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > documentLimit) {
      throw new Error('Host state source is aliased, non-regular or exceeds its bounded document limit.');
    }
    const bytes = await readFile(path), text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Host state is not valid UTF-8.');
    return text;
  } catch (error) { if (missing(error)) return undefined; throw error; }
}

export async function legacyHostFiles(root: string): Promise<string[]> {
  root = canonicalRoot(root);
  for (const path of [resolve(root, '.tandem'), resolve(root, '.tandem', 'living-canvas')]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Host state migration root is aliased.'); }
    catch (error) { if (!missing(error)) throw error; }
  }
  const found = new Set<string>();
  const scan = async (directory: string) => {
    let entries;
    try {
      const current = await lstat(directory);
      if (current.isSymbolicLink() || !current.isDirectory()) throw new Error('Host state migration directory is aliased or invalid.');
      entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) { if (missing(error)) return; throw error; }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Host state migration cannot follow symbolic links.');
      if (entry.isDirectory()) {
        if (path === resolve(root, '.tandem', 'living-canvas', 'host-state')
          || path === resolve(root, '.tandem', 'living-canvas', 'design', 'content')
          || path === resolve(root, '.tandem', 'living-canvas', 'design', '.snapshots')
          || path === resolve(root, '.tandem', 'living-canvas', 'workflow', 'design', 'previews')) continue;
        await scan(path);
      } else if ((entry.name.endsWith('.json') || entry.name === 'notes.md' || entry.name === 'changes.md')
        && !immutableHostArtifact(entry.name)) found.add(path);
    }
  };
  await scan(resolve(root, '.tandem', 'living-canvas'));
  for (const directory of registrations.get(canonicalRoot(root)) ?? []) await scan(directory);
  return [...found].sort();
}

export interface HostStateSource {
  file: HostStateFile;
  validate(content: string): void;
}

export function bindHostStateMutations<T extends object>(
  target: T, file: HostStateFile, methods: Array<keyof T>, refresh: () => Promise<unknown>,
): void {
  for (const key of methods) {
    const method = target[key];
    if (typeof method !== 'function') throw new Error('Host state mutation adapter names a non-method.');
    Object.defineProperty(target, key, {
      configurable: true, writable: true,
      value: (...args: unknown[]) => file.run(String(key), async () => {
        await refresh();
        return Reflect.apply(method, target, args);
      }),
    });
  }
}

export async function hostDirectoryEntries(root: string, directory: string): Promise<string[]> {
  const entries = new Set<string>();
  try { for (const name of await readdir(directory)) entries.add(name); }
  catch (error) { if (!missing(error)) throw error; }
  const probe = new HostStateFile(root, resolve(directory, 'directory-probe.json'));
  if (!await probe.journalExists()) return [...entries];
  const wal = getHostStateWal(root);
  for (const name of await probe.list()) entries.add(name);
  const staged = documentTransaction.getStore();
  const namespaces = new Set([...await wal.namespaces(),
    ...(staged?.root === canonicalRoot(root) ? [...staged.changes.values()].map(({ namespace }) => namespace) : [])]);
  for (const retainedNamespace of namespaces) {
    const namespace = currentHostNamespace(retainedNamespace);
    const path = namespace.startsWith('workspace/') ? resolve(root, namespace.slice(10).split('/').join(sep))
      : namespace.startsWith('external/') ? resolve(namespace.slice(9).split('/').join(sep)) : null;
    if (!path) continue;
    const local = relative(resolve(directory), path);
    if (local && !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`)) entries.add(local.split(sep)[0]!);
  }
  return [...entries];
}

/** Adapts an existing validated JSON document, never writes a competing latest file. */
export class HostStateFile {
  readonly root: string;
  readonly path: string;
  readonly namespace: string;
  readonly key: string;
  readonly #artifact: boolean;
  readonly #text: boolean;

  constructor(root: string, path: string, namespace?: string, options: { artifact?: boolean; text?: boolean } = {}) {
    ensureTandemWorkspace(root);
    const local = relative(resolve(root), resolve(path));
    this.root = canonicalRoot(root);
    this.path = !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`) ? resolve(this.root, local) : resolve(path);
    this.key = basename(path);
    this.namespace = namespace ?? hostStateNamespace(this.root, dirname(this.path));
    this.#artifact = options.artifact ?? false;
    this.#text = options.text ?? false;
    const directories = registrations.get(this.root) ?? new Set<string>();
    directories.add(dirname(this.path)); registrations.set(this.root, directories);
  }

  async journalExists(): Promise<boolean> {
    try { return (await stat(resolve(this.root, '.tandem', 'living-canvas', 'host-state', 'journal.wal'))).isFile(); }
    catch (error) { if (missing(error)) return false; throw error; }
  }

  async uncertain(): Promise<boolean> {
    return await this.journalExists() ? Boolean(getHostStateWal(this.root).failed) : false;
  }

  prepareContent(content: string | null): Promise<string | null> {
    return storeDocument(this.root, content, this.#artifact, this.#text);
  }

  async read(): Promise<string | undefined> {
    const transaction = documentTransaction.getStore();
    if (transaction?.root === this.root) {
      const pending = transaction.changes.get(identity(this.namespace, this.key));
      if (pending) return pending.content ?? undefined;
      const value = transaction.read(this.namespace, this.key);
      if (value === undefined && transaction.version(this.namespace, this.key) === 0 && await exactText(this.path) !== undefined) {
        const imported = transaction.read('host-imports', importKey(this.path));
        if (!imported || JSON.parse(imported).namespace === this.namespace) throw new Error(`Legacy Host state requires verified migration: ${this.key}`);
      }

      return resolveDocument(this.root, value, this.#text);
    }
    if (!await this.journalExists()) return exactText(this.path);
    const wal = getHostStateWal(this.root);
    const value = await wal.read(this.namespace, this.key);
    if (value === undefined && await wal.version(this.namespace, this.key) === 0 && await exactText(this.path) !== undefined) {
      const imported = await wal.read('host-imports', importKey(this.path));
      if (!imported || JSON.parse(imported).namespace === this.namespace) throw new Error(`Legacy Host state requires verified migration: ${this.key}`);
    }
    return resolveDocument(this.root, value, this.#text);
  }

  inTransaction(): boolean { return inHostStateTransaction(this.root); }

  async inspect<T>(observe: () => Promise<T>): Promise<T> {
    return await this.journalExists() ? this.run('inspect-host-state', observe) : observe();
  }

  async afterCommit(notify: () => void | Promise<void>): Promise<void> {
    const transaction = documentTransaction.getStore();
    if (transaction?.root === this.root) { transaction.afterCommit.push(notify); return; }
    await notify();
  }

  async list(): Promise<string[]> {
    const transaction = documentTransaction.getStore();
    if (transaction?.root === this.root) {
      const names = new Set(transaction.list(this.namespace));
      for (const change of transaction.changes.values()) {
        if (change.namespace !== this.namespace) continue;
        if (change.content === null) names.delete(change.key); else names.add(change.key);
      }
      return [...names].sort();
    }
    if (await this.journalExists()) return getHostStateWal(this.root).list(this.namespace);
    try { return (await readdir(dirname(this.path))).filter((name) => name.endsWith('.json')); }
    catch (error) { if (missing(error)) return []; throw error; }
  }

  async mutate<T>(cause: string, update: (original: string | undefined) => { content: string | null; result: T }): Promise<T> {
    return this.transact(cause, update);
  }

  async transact<T>(cause: string, update: (original: string | undefined) =>
    { content: string | null; result: T } | Promise<{ content: string | null; result: T }>): Promise<T> {
    return this.run(cause, async () => {
      const { content, result } = await update(await this.read());
      await this.write(cause, content);
      return result;
    });
  }

  async write(cause: string, content: string | null): Promise<void> {
    const transaction = documentTransaction.getStore();
    if (transaction?.root === this.root) {
      await this.read();
      transaction.changes.set(identity(this.namespace, this.key), { namespace: this.namespace, key: this.key, content,
        artifact: this.#artifact, text: this.#text });
      return;
    }
    throw new Error(`Host state write requires a read/validate/update transaction: ${cause}`);
  }

  async run<T>(cause: string, operation: () => Promise<T> | T): Promise<T> {
    const active = documentTransaction.getStore();
    if (active) {
      if (active.root !== this.root) throw new Error('A Host state transaction cannot cross project workspaces.');
      return operation();
    }
    if (!await this.journalExists()) {
      const old = await legacyHostFiles(this.root);
      if (old.length) throw new Error('Saved Host state requires explicitly verified quiescent WAL migration before mutation.');
    }
    await mkdir(this.root, { recursive: true });
    let notifications: Array<() => void | Promise<void>> = [];
    const result = await getHostStateWal(this.root).transaction(this.namespace, cause, async (view) => {
      const original = view.read(this.namespace, this.key);
      if (view.version(this.namespace, this.key) === 0 && await exactText(this.path) !== undefined) {
        const imported = view.read('host-imports', importKey(this.path));
        if (!imported || JSON.parse(imported).namespace === this.namespace) throw new Error(`Legacy Host state requires verified migration: ${this.key}`);
      }
      const transaction: DocumentTransaction = { root: this.root, read: (namespace, key) => view.read(namespace, key),
        version: (namespace, key) => view.version(namespace, key), list: (namespace) => view.list(namespace), changes: new Map(), afterCommit: [] };
      const result = await documentTransaction.run(transaction, operation);
      const changes = [];
      for (const { namespace, key, content, artifact, text } of transaction.changes.values()) {
        const previous = await resolveDocument(this.root, view.read(namespace, key), text);
        if (content !== previous && !(content === null && previous === undefined)) {
          changes.push({ namespace, key, content: await storeDocument(this.root, content, artifact, text) });
        }
      }
      notifications = transaction.afterCommit;
      return { changes, result };
    });
    for (const notify of notifications) await notify();
    return result;
  }
}

export async function migrateHostState(input: {
  workspaceRoot: string; id: string; sources: HostStateSource[]; verifyQuiescent(): Promise<void>;
}): Promise<unknown> {
  const root = canonicalRoot(input.workspaceRoot);
  await input.verifyQuiescent();
  const sourcePaths = new Set(input.sources.map(({ file }) => file.path));
  const discovered = await legacyHostFiles(root);
  if (discovered.some((path) => !sourcePaths.has(path))) throw new Error('Legacy migration omitted an existing Host state document.');
  const sources = [];
  for (const { file, validate } of input.sources) {
    if (file.root !== root) throw new Error('Migration source belongs to another workspace.');
    const content = await exactText(file.path);
    if (content === undefined) throw new Error('A declared migration source is missing.');
    validate(content);
    sources.push({ file, content, digest: hash(content) });
  }
  await input.verifyQuiescent();
  for (const source of sources) {
    if (await exactText(source.file.path) !== source.content) throw new Error('Legacy state changed during verified migration.');
  }
  const requestDigest = hash(JSON.stringify(sources.map(({ file, digest }) => ({ namespace: file.namespace, key: file.key, digest }))));
  const changes = [];
  for (const { file, content, digest } of sources) {
    changes.push({ namespace: file.namespace, key: file.key, content: await file.prepareContent(content), expectedDigest: null, expectedRevision: 0 });
    changes.push({ namespace: 'host-imports', key: importKey(file.path), expectedDigest: null, expectedRevision: 0,
      content: JSON.stringify({ schemaVersion: 'host-state-import/v1', path: file.path, namespace: file.namespace,
        key: file.key, digest, migrationId: input.id }) });
  }
  return getHostStateWal(root).commit({
    id: input.id, source: 'legacy-migration', cause: 'verified-quiescent-import', requestDigest,
    changes,
  });
}

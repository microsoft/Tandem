import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync, statSync, readFileSync, unlinkSync, lstatSync } from 'node:fs';
import { mkdir, open, lstat, readFile, rm, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureTandemWorkspace } from './product-paths.ts';

export interface HostStateChange {
  namespace: string;
  key: string;
  content: string | null;
  expectedDigest?: string | null;
  expectedRevision?: number;
}
interface SavedChange {
  namespace: string; key: string; content: string | null;
  version: number; previousDigest: string | null; digest: string | null; valueSchema: string | null;
}
interface Receipt { id: string; seq: number; digest: string; duplicate: boolean }
interface Body {
  schemaVersion: 'host-state-wal/v1'; seq: number; id: string; source: string; cause: string;
  previousHash: string | null; requestDigest: string; recordedAt: string; updates: SavedChange[];
  writerId: string;
}
interface RecordFrame extends Body { digest: string }
interface Cell { content: string | null; version: number; digest: string | null }
interface View {
  read(namespace: string, key: string): string | undefined;
  version(namespace: string, key: string): number;
  list(namespace: string): string[];
}
export interface HostWalOptions {
  maxRecordBytes?: number;
  boundary?: (point: 'before-append' | 'after-append' | 'before-sync' | 'after-sync') => void | Promise<void>;
}

const instances = new Map<string, HostStateWal>();
process.once('exit', () => {
  for (const wal of instances.values()) wal.releaseDrainedWriterOnExit();
});
const transaction = new AsyncLocalStorage<HostStateWal>();
const identifier = (namespace: string, key: string) => JSON.stringify([namespace, key]);
const rootKey = (root: string) => process.platform === 'win32' ? root.toLowerCase() : root;
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
export const hostStateDigest = (content: string): string => createHash('sha256').update(content).digest('hex');
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Host WAL: ${message}`);
}
function name(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0'), 'invalid record identity.');
}
function checksum(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'invalid digest.');
}
function normalizedChanges(changes: HostStateChange[]): HostStateChange[] {
  return changes.map((change) => {
    requireValue(change && typeof change === 'object' && Object.keys(change).every((key) =>
      ['namespace', 'key', 'content', 'expectedDigest', 'expectedRevision'].includes(key)), 'invalid update fields.');
    return { namespace: change.namespace, key: change.key, content: change.content,
      ...(change.expectedDigest !== undefined ? { expectedDigest: change.expectedDigest } : {}),
      ...(change.expectedRevision !== undefined ? { expectedRevision: change.expectedRevision } : {}) };
  }).sort((left, right) => {
    const a = identifier(left.namespace, left.key), b = identifier(right.namespace, right.key);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if (missing(error)) return false; throw error; }
}

export function getHostStateWal(workspaceRoot: string, options: HostWalOptions = {}): HostStateWal {
  const root = realpathSync(resolve(workspaceRoot)), key = rootKey(root);
  requireValue(statSync(root).isDirectory(), 'workspace must be a directory.');
  const current = instances.get(key);
  if (current) return current;
  const created = new HostStateWal(root, options);
  instances.set(key, created);
  return created;
}
export async function closeHostStateWal(workspaceRoot: string): Promise<void> {
  const key = rootKey(realpathSync(resolve(workspaceRoot)));
  const current = instances.get(key);
  if (current) await current.close();
}

/** One cooperating writer; dead-owner lease recovery never repairs journal bytes. */
export class HostStateWal {
  readonly workspaceRoot: string;
  readonly path: string;
  readonly #directory: string;
  readonly #lockPath: string;
  readonly #kernelPath: string;
  readonly #limit: number;
  readonly #boundary: HostWalOptions['boundary'];
  #lock: FileHandle | null = null;
  #file: FileHandle | null = null;
  #token: string | null = null;
  #failure: Error | null = null;
  #closed = false;
  #closing = false;
  #pendingCount = 0;
  #tail: Promise<void> = Promise.resolve();
  #cells = new Map<string, Cell>();
  #receipts = new Map<string, { requestDigest: string; receipt: Receipt }>();
  #seq = 0;
  #hash: string | null = null;
  #offset = 0;
  #stamp: string | null = null;
  #kernelLease: DatabaseSync | null = null;
  #kernelIdentity: string | null = null;

  constructor(root: string, options: HostWalOptions = {}) {
    ensureTandemWorkspace(root);
    this.workspaceRoot = root;
    this.#directory = resolve(root, '.tandem', 'living-canvas', 'host-state');
    this.path = resolve(this.#directory, 'journal.wal');
    this.#lockPath = resolve(this.#directory, 'writer.lock');
    this.#kernelPath = resolve(this.#directory, 'writer-lease.sqlite');
    this.#limit = options.maxRecordBytes ?? 64 * 1024 * 1024;
    requireValue(Number.isSafeInteger(this.#limit) && this.#limit >= 256 && this.#limit <= 256 * 1024 * 1024, 'invalid bounded frame limit.');
    this.#boundary = options.boundary;
  }
  get writerId(): string | null { return this.#token ? hostStateDigest(this.#token) : null; }
  get failed(): boolean { return this.#failure !== null; }

  #healthy(): void {
    if (this.#failure) throw this.#failure;
    requireValue(!this.#closed, 'writer is closed.');
  }
  #view(): View {
    return {
      read: (namespace, key) => this.#cells.get(identifier(namespace, key))?.content ?? undefined,
      version: (namespace, key) => this.#cells.get(identifier(namespace, key))?.version ?? 0,
      list: (namespace) => [...this.#cells].filter(([id, cell]) => JSON.parse(id)[0] === namespace && cell.content !== null)
        .map(([id]) => JSON.parse(id)[1] as string).sort(),
    };
  }
  async #read<T>(observe: (view: View) => T): Promise<T> {
    this.#healthy();
    if (transaction.getStore() === this) return observe(this.#view());
    return this.#serialize(async () => {
      if (!this.#file && !await exists(this.path)) return observe(this.#view());
      await this.#ensureWriter();
      await this.#assertStable();
      return observe(this.#view());
    });
  }
  read(namespace: string, key: string): Promise<string | undefined> {
    name(namespace); name(key); return this.#read((view) => view.read(namespace, key));
  }
  version(namespace: string, key: string): Promise<number> {
    name(namespace); name(key); return this.#read((view) => view.version(namespace, key));
  }
  list(namespace: string): Promise<string[]> {
    name(namespace); return this.#read((view) => view.list(namespace));
  }
  namespaces(): Promise<string[]> {
    return this.#read(() => [...new Set([...this.#cells.keys()].map((id) => JSON.parse(id)[0] as string))].sort());
  }
  /** Bounded historical evidence from this already verified, exclusively owned journal. */
  history(namespace: string, key: string, limit = 100): Promise<Array<{
    seq: number; recordedAt: string; cause: string; digest: string; version: number; content: string | null;
  }>> {
    name(namespace); name(key);
    requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, 'history limit must be 1-1000.');
    if (transaction.getStore()) return Promise.reject(new Error('Host WAL: historical inspection cannot run inside a mutation.'));
    return this.#serialize(async () => {
      if (!this.#file && !await exists(this.path)) return [];
      await this.#ensureWriter(); await this.#assertStable();
      const entries: Array<{ seq: number; recordedAt: string; cause: string; digest: string; version: number; content: string | null }> = [];
      let offset = 0, sequence = 0, previousHash: string | null = null;
      while (offset < this.#offset) {
        const header = (await this.#readBytes(9, offset)).toString('ascii');
        requireValue(/^[0-9a-f]{8}:$/.test(header), 'invalid historical frame header.');
        const length = Number.parseInt(header.slice(0, 8), 16);
        requireValue(length > 0 && length <= this.#limit && offset + length + 10 <= this.#offset, 'invalid historical frame size.');
        const bytes = await this.#readBytes(length, offset + 9), content = bytes.toString('utf8');
        requireValue(Buffer.from(content, 'utf8').equals(bytes)
          && (await this.#readBytes(1, offset + length + 9))[0] === 10, 'invalid historical frame encoding.');
        const record = JSON.parse(content) as RecordFrame;
        const { digest, ...body } = record;
        requireValue(record.seq === ++sequence && record.previousHash === previousHash
          && digest === hostStateDigest(JSON.stringify(body))
          && this.#receipts.get(record.id)?.receipt.digest === digest, 'historical frame differs from verified replay.');
        previousHash = digest;
        for (const update of record.updates) if (update.namespace === namespace && update.key === key) {
          requireValue(entries.length < limit, 'complete document history exceeds the inspection limit; no evidence was truncated.');
          entries.push({ seq: record.seq, recordedAt: record.recordedAt, cause: record.cause, digest,
            version: update.version, content: update.content });
        }
        offset += length + 10;
      }
      requireValue(sequence === this.#seq && previousHash === this.#hash
        && entries.length === this.#view().version(namespace, key), 'historical document evidence is incomplete.');
      await this.#assertStable();
      return entries;
    });
  }
  async inventory(after: string | null = null, limit = 100): Promise<{
    schemaVersion: 'host-state-inventory/v1'; path: string; owned: boolean; writerId: string | null; sequence: number | null;
    entries: Array<{ cursor: string; namespace: string; key: string; revision: number; digest: string | null; schema: string | null; deleted: boolean }>;
    next: string | null;
  }> {
    requireValue(Number.isInteger(limit) && limit > 0 && limit <= 100, 'inventory limit must be 1-100.');
    this.#healthy();
    if (!this.#file) return { schemaVersion: 'host-state-inventory/v1', path: this.path, owned: false, writerId: null, sequence: null, entries: [], next: null };
    return this.#read(() => {
      const rows = [...this.#cells].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const offset = after === null ? 0 : rows.findIndex(([key]) => key === after) + 1;
      requireValue(after === null || offset > 0, 'inventory cursor is unavailable.');
      const selected = rows.slice(offset, offset + limit);
      const entries = selected.map(([cursor, cell]) => {
        const [namespace, key] = JSON.parse(cursor) as [string, string];
        const value = cell.content === null ? null : JSON.parse(cell.content);
        return { cursor, namespace, key, revision: cell.version, digest: cell.digest,
          schema: value?.moduleSchema ?? value?.schemaVersion ?? null, deleted: cell.content === null };
      });
      return { schemaVersion: 'host-state-inventory/v1', path: this.path, owned: true, writerId: this.writerId, sequence: this.#seq, entries,
        next: offset + limit < rows.length ? selected.at(-1)![0] : null };
    });
  }

  mutate<T>(namespace: string, key: string, cause: string,
    update: (original: string | undefined) => { content: string | null; result: T },
    options: { expectedDigest?: string | null; expectedRevision?: number } = {}): Promise<T> {
    return this.transaction(namespace, cause, (view) => {
      this.#expect({ namespace, key, content: null, ...options });
      const { content, result } = update(view.read(namespace, key));
      return { changes: content === view.read(namespace, key) ? [] : [{ namespace, key, content, ...options }], result };
    });
  }
  transaction<T>(source: string, cause: string, update: (view: View) =>
    { changes: HostStateChange[]; result: T } | Promise<{ changes: HostStateChange[]; result: T }>): Promise<T> {
    name(source); name(cause);
    if (transaction.getStore()) return Promise.reject(new Error('Host WAL: reentrant mutation is forbidden; stage one update group instead.'));
    return this.#serialize(() => transaction.run(this, async () => {
      await this.#ensureWriter();
      await this.#assertStable();
      const prepared = await update(this.#view());
      if (prepared.changes.length) {
        const id = randomUUID(), requestDigest = hostStateDigest(JSON.stringify({ source, cause, changes: prepared.changes }));
        await this.#append(id, source, cause, prepared.changes, requestDigest);
      }
      return structuredClone(prepared.result);
    }));
  }
  commit(input: { id: string; source: string; cause: string; changes: HostStateChange[]; requestDigest?: string }): Promise<Receipt> {
    name(input.id); name(input.source); name(input.cause);
    if (transaction.getStore()) return Promise.reject(new Error('Host WAL: reentrant commit is forbidden.'));
    return this.#serialize(() => transaction.run(this, async () => {
      await this.#ensureWriter();
      await this.#assertStable();
      if (input.requestDigest !== undefined) checksum(input.requestDigest);
      const changes = normalizedChanges(input.changes);
      const requestDigest = hostStateDigest(JSON.stringify({ source: input.source, cause: input.cause,
        requestDigest: input.requestDigest ?? null, changes }));
      const old = this.#receipts.get(input.id);
      if (old) {
        requireValue(old.requestDigest === requestDigest, 'record ID conflicts with its accepted request.');
        return { ...old.receipt, duplicate: true };
      }
      return this.#append(input.id, input.source, input.cause, changes, requestDigest);
    }));
  }
  #expect(change: HostStateChange): void {
    name(change.namespace); name(change.key);
    const prior = this.#cells.get(identifier(change.namespace, change.key));
    if (change.expectedDigest !== undefined) {
      requireValue(change.expectedDigest === (prior?.digest ?? null), 'stale expected document digest.');
    }
    if (change.expectedRevision !== undefined) {
      requireValue(Number.isSafeInteger(change.expectedRevision) && change.expectedRevision >= 0, 'invalid expected revision.');
      requireValue(change.expectedRevision === (prior?.version ?? 0), 'stale expected document revision.');
    }
  }
  async #append(id: string, source: string, cause: string, changes: HostStateChange[], requestDigest: string): Promise<Receipt> {
    const keys = new Set<string>();
    const updates = normalizedChanges(changes).map((change): SavedChange => {
      this.#expect(change);
      const key = identifier(change.namespace, change.key);
      requireValue(!keys.has(key), 'duplicate key within one atomic update group.'); keys.add(key);
      requireValue(change.content === null || typeof change.content === 'string', 'state must be JSON text or a tombstone.');
      if (change.content !== null) requireValue(Buffer.byteLength(change.content) <= this.#limit
        && Buffer.from(change.content, 'utf8').toString('utf8') === change.content, 'document exceeds its limit or is not exact UTF-8.');
      const value = change.content === null ? null : JSON.parse(change.content);
      requireValue(value?.schemaVersion === undefined || typeof value.schemaVersion === 'string', 'invalid value schema identity.');
      const prior = this.#cells.get(key);
      return { namespace: change.namespace, key: change.key, content: change.content,
        version: (prior?.version ?? 0) + 1, previousDigest: prior?.digest ?? null,
        digest: change.content === null ? null : hostStateDigest(change.content),
        valueSchema: value?.schemaVersion ?? null };
    });
    const body: Body = { schemaVersion: 'host-state-wal/v1', seq: this.#seq + 1, id, source, cause,
      previousHash: this.#hash, requestDigest, recordedAt: new Date().toISOString(), updates, writerId: this.writerId! };
    requireValue(Number.isSafeInteger(body.seq), 'journal sequence is exhausted.');
    const digest = hostStateDigest(JSON.stringify(body));
    const bytes = Buffer.from(JSON.stringify({ ...body, digest }), 'utf8');
    requireValue(bytes.length <= this.#limit, 'record exceeds the bounded frame limit.');
    const frame = Buffer.concat([Buffer.from(`${bytes.length.toString(16).padStart(8, '0')}:`), bytes, Buffer.from('\n')]);
    await this.#boundary?.('before-append');
    await this.#assertStable();
    let attempted = false;
    try {
      requireValue(this.#file, 'writer file is unavailable.');
      attempted = true;
      let written = 0;
      while (written < frame.length) {
        const result = await this.#file.write(frame, written, frame.length - written, null);
        requireValue(result.bytesWritten > 0, 'append made no progress.');
        written += result.bytesWritten;
      }
      await this.#boundary?.('after-append');
      await this.#boundary?.('before-sync');
      await this.#file.sync();
      await this.#boundary?.('after-sync');
      await this.#assertLease();
      this.#apply({ ...body, digest });
      this.#offset += frame.length;
      this.#stamp = await this.#fileStamp();
      return { id, seq: body.seq, digest, duplicate: false };
    } catch (error) {
      if (attempted) this.#failure = new Error('Host WAL: append/flush outcome is uncertain; writer is latched and no later state can be published.', { cause: error });
      throw this.#failure ?? error;
    }
  }
  #apply(record: RecordFrame): void {
    for (const change of record.updates) this.#cells.set(identifier(change.namespace, change.key),
      { content: change.content, version: change.version, digest: change.digest });
    this.#seq = record.seq; this.#hash = record.digest;
    this.#receipts.set(record.id, { requestDigest: record.requestDigest,
      receipt: { id: record.id, seq: record.seq, digest: record.digest, duplicate: false } });
  }
  async #safeDirectories(): Promise<void> {
    let path = this.workspaceRoot;
    for (const part of ['.tandem', 'living-canvas', 'host-state']) {
      path = resolve(path, part);
      try { await mkdir(path); }
      catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error; }
      const entry = await lstat(path);
      requireValue(entry.isDirectory() && !entry.isSymbolicLink(), 'managed directory is aliased or invalid.');
    }
  }
  async #ensureWriter(): Promise<void> {
    this.#healthy();
    if (this.#file) return;
    await this.#safeDirectories();
    try {
      if (await exists(this.#kernelPath)) {
        const info = await lstat(this.#kernelPath);
        requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'writer lease is aliased or invalid.');
      }
      // SQLite's OS lock disappears on process exit. It serializes dead-file reclamation
      // so two reopeners cannot unlink a newly acquired writer's ownership file.
      this.#kernelLease = new DatabaseSync(this.#kernelPath);
      this.#kernelLease.exec('BEGIN EXCLUSIVE');
      const identity = await lstat(this.#kernelPath);
      this.#kernelIdentity = `${identity.dev}:${identity.ino}`;
      try { this.#lock = await open(this.#lockPath, 'wx'); }
      catch (error) {
        requireValue(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST',
          'writer ownership file could not be created.');
        const info = await lstat(this.#lockPath);
        requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'existing writer identity is invalid.');
        const original = await readFile(this.#lockPath, 'utf8');
        const owner = JSON.parse(original) as Record<string, unknown>;
        requireValue(owner.schemaVersion === 'host-state-writer/v1'
          && Object.keys(owner).length === 4 && typeof owner.token === 'string'
          && /^[a-f0-9-]{36}$/.test(owner.token) && typeof owner.workspace === 'string'
          && rootKey(resolve(owner.workspace)) === rootKey(this.workspaceRoot)
          && typeof owner.pid === 'number' && Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.pid <= 2147483647,
        'existing writer ownership is unverified.');
        let absent = false;
        try { process.kill(owner.pid, 0); }
        catch (error) { absent = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'; }
        requireValue(absent, 'the recorded writer is live or its liveness is unavailable.');
        requireValue(await readFile(this.#lockPath, 'utf8') === original, 'writer ownership changed during recovery.');
        await rm(this.#lockPath);
        this.#lock = await open(this.#lockPath, 'wx');
      }
    } catch (error) {
      this.#kernelLease?.close(); this.#kernelLease = null; this.#kernelIdentity = null;
      throw new Error('Host WAL: exclusive workspace writer is unavailable; live or unverified ownership is never taken over.', { cause: error });
    }
    this.#token = JSON.stringify({ schemaVersion: 'host-state-writer/v1', token: randomUUID(), pid: process.pid, workspace: this.workspaceRoot });
    try {
      await this.#lock.writeFile(this.#token, 'utf8'); await this.#lock.sync();
      if (await exists(this.path)) {
        const info = await lstat(this.path);
        requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'journal is aliased or not a regular file.');
      }
      this.#file = await open(this.path, 'a+');
      await this.#replay();
      this.#stamp = await this.#fileStamp();
    } catch (error) {
      this.#failure = new Error('Host WAL: writer initialization/replay failed; saved evidence was not replaced.', { cause: error });
      throw this.#failure;
    }
  }
  async #readBytes(length: number, position: number): Promise<Buffer> {
    requireValue(this.#file, 'journal is unavailable.');
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const result = await this.#file.read(bytes, offset, length - offset, position + offset);
      requireValue(result.bytesRead > 0, 'incomplete tail; no repair or successful outcome was inferred.');
      offset += result.bytesRead;
    }
    return bytes;
  }
  async #replay(): Promise<void> {
    requireValue(this.#file, 'journal is unavailable.');
    const size = (await this.#file.stat()).size;
    while (this.#offset < size) {
      requireValue(size - this.#offset >= 9, 'incomplete frame header.');
      const header = (await this.#readBytes(9, this.#offset)).toString('ascii');
      requireValue(/^[0-9a-f]{8}:$/.test(header), 'invalid frame header.');
      const length = Number.parseInt(header.slice(0, 8), 16);
      requireValue(length > 0 && length <= this.#limit, 'invalid or oversized frame length.');
      requireValue(this.#offset + 9 + length + 1 <= size, 'incomplete tail; no repair or successful outcome was inferred.');
      const raw = await this.#readBytes(length, this.#offset + 9), content = raw.toString('utf8');
      requireValue(Buffer.from(content, 'utf8').equals(raw), 'invalid frame UTF-8.');
      requireValue((await this.#readBytes(1, this.#offset + 9 + length))[0] === 10, 'invalid frame terminator.');
      const record = this.#parseFrame(content);
      this.#apply(record);
      this.#offset += 10 + length;
    }
  }
  #parseFrame(content: string): RecordFrame {
    const raw = JSON.parse(content) as Record<string, unknown>;
    const fields = ['schemaVersion', 'seq', 'id', 'source', 'cause', 'previousHash', 'requestDigest', 'recordedAt', 'updates', 'writerId', 'digest'];
    requireValue(raw && typeof raw === 'object' && Object.keys(raw).length === fields.length
      && fields.every((key) => Object.hasOwn(raw, key)), 'invalid envelope schema.');
    const { digest, ...body } = raw;
    checksum(digest);
    requireValue(raw.schemaVersion === 'host-state-wal/v1' && raw.seq === this.#seq + 1
      && raw.previousHash === this.#hash && digest === hostStateDigest(JSON.stringify(body)), 'sequence/hash integrity failure.');
    name(raw.id); name(raw.source); name(raw.cause); checksum(raw.requestDigest); checksum(raw.writerId);
    requireValue(!this.#receipts.has(raw.id), 'duplicate accepted record identity in journal.');
    requireValue(typeof raw.recordedAt === 'string' && Number.isFinite(Date.parse(raw.recordedAt)) && Array.isArray(raw.updates), 'invalid record metadata.');
    const keys = new Set<string>();
    const updates = raw.updates.map((value: unknown): SavedChange => {
      requireValue(value && typeof value === 'object' && !Array.isArray(value), 'invalid update.');
      const update = value as Record<string, unknown>;
      const allowed = ['namespace', 'key', 'content', 'version', 'previousDigest', 'digest', 'valueSchema'];
      requireValue(Object.keys(update).length === allowed.length && allowed.every((key) => Object.hasOwn(update, key)), 'invalid update shape.');
      name(update.namespace); name(update.key);
      const key = identifier(update.namespace, update.key), prior = this.#cells.get(key);
      requireValue(!keys.has(key), 'interleaved or duplicate update key.'); keys.add(key);
      requireValue(update.version === (prior?.version ?? 0) + 1 && update.previousDigest === (prior?.digest ?? null), 'document revision integrity failure.');
      requireValue(update.content === null || typeof update.content === 'string', 'invalid document content.');
      const document = update.content === null ? null : JSON.parse(update.content);
      requireValue(update.digest === (update.content === null ? null : hostStateDigest(update.content))
        && update.valueSchema === (document?.schemaVersion ?? null), 'document checksum/schema failure.');
      return { namespace: update.namespace, key: update.key, content: update.content,
        version: update.version as number, previousDigest: update.previousDigest as string | null,
        digest: update.digest as string | null, valueSchema: update.valueSchema as string | null };
    });
    return { schemaVersion: 'host-state-wal/v1', seq: raw.seq as number, id: raw.id, source: raw.source,
      cause: raw.cause, previousHash: raw.previousHash as string | null, requestDigest: raw.requestDigest,
      recordedAt: raw.recordedAt, updates, digest, writerId: raw.writerId };
  }
  async #assertLease(): Promise<void> {
    requireValue(this.#lock && this.#token && this.#kernelLease, 'writer ownership is unavailable.');
    const lease = await lstat(this.#kernelPath);
    requireValue(lease.isFile() && !lease.isSymbolicLink() && lease.nlink === 1
      && `${lease.dev}:${lease.ino}` === this.#kernelIdentity, 'OS writer lease identity changed.');
    const info = await lstat(this.#lockPath);
    requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1
      && await readFile(this.#lockPath, 'utf8') === this.#token, 'writer ownership changed.');
  }
  async #fileStamp(): Promise<string> {
    const info = await lstat(this.path, { bigint: true });
    requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n, 'journal identity is invalid.');
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`;
  }
  async #assertStable(): Promise<void> {
    try {
      await this.#assertLease();
      requireValue(this.#stamp === await this.#fileStamp(), 'journal changed outside its writer.');
    } catch (error) {
      this.#failure = new Error('Host WAL: ownership or journal changed; writer is latched.', { cause: error });
      throw this.#failure;
    }
  }
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closing) return Promise.reject(new Error('Host WAL: writer is closing.'));
    this.#pendingCount++;
    const pending = this.#tail.then(async () => { this.#healthy(); return work(); }).finally(() => { this.#pendingCount--; });
    this.#tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
  releaseDrainedWriterOnExit(): void {
    if (this.#closed || this.#failure || this.#pendingCount || !this.#token) return;
    try {
      const info = lstatSync(this.#lockPath);
      if (info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && readFileSync(this.#lockPath, 'utf8') === this.#token) unlinkSync(this.#lockPath);
    } catch (error) {
      if (!missing(error)) process.emitWarning('Host WAL writer lease could not be released at exit; ownership remains blocked.', { code: 'HOST_WAL_EXIT_LEASE' });
    }
  }
  async close(): Promise<void> {
    requireValue(transaction.getStore() !== this, 'reentrant close is forbidden.');
    if (this.#closed) return;
    this.#closing = true;
    await this.#tail;
    if (!this.#failure && this.#lock) await this.#assertLease();
    await this.#file?.close(); await this.#lock?.close();
    this.#file = null; this.#lock = null;
    if (!this.#failure && this.#token) await rm(this.#lockPath);
    this.#kernelLease?.close(); this.#kernelLease = null; this.#kernelIdentity = null;
    this.#closed = true;
    if (!this.#failure && instances.get(rootKey(this.workspaceRoot)) === this) instances.delete(rootKey(this.workspaceRoot));
  }
}

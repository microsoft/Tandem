import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renameWithRetry } from '../backbone/artifact-store.ts';
import { object, requireCondition } from './validation.ts';
import { LEGACY_V1_POLICY, parsePolicySnapshot, type PolicySnapshot } from './policy.ts';
import { HostStateFile, immutableHostArtifact, workspaceForHostPath } from '../host-state-file.ts';

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export async function readExactUtf8(path: string): Promise<string> {
  const bytes = await readFile(path);
  const content = bytes.toString('utf8');
  requireCondition(Buffer.from(content, 'utf8').equals(bytes), 'stored evidence is not valid UTF-8.');
  return content;
}

export function encodeRecord(value: unknown): string {
  return `${JSON.stringify({
    schemaVersion: 'workflow-document/v1', digest: sha256(JSON.stringify(value)), payload: value,
  }, null, 2)}\n`;
}

export function decodeRecord(content: string): unknown {
  const record = object(JSON.parse(content), ['schemaVersion', 'digest', 'payload']);
  requireCondition(record.schemaVersion === 'workflow-document/v1'
    && record.digest === sha256(JSON.stringify(record.payload)), 'stored document checksum or schema is invalid.');
  return record.payload;
}

export interface StorageBoundary {
  label: string;
  point: 'before-rename' | 'after-rename';
}

// This lock fences only cooperating writers of this isolated store directory.
// It neither fences legacy code nor proves that a Copilot task has stopped.
export class FoundationStorage {
  readonly directory: string;
  readonly #policy: PolicySnapshot;
  readonly #boundary: ((boundary: StorageBoundary) => void | Promise<void>) | undefined;
  #lock: FileHandle | undefined;
  #lockContent: string | undefined;
  #leaseState: 'unleased' | 'acquiring' | 'open' | 'closing' = 'unleased';
  #closing: Promise<void> | undefined;
  #tail: Promise<void> = Promise.resolve();
  readonly #walPending = new Set<Promise<unknown>>();
  readonly #workspaceRoot: string | null;
  readonly #namespace: string | undefined;

  constructor(directory: string, boundary?: (boundary: StorageBoundary) => void | Promise<void>,
    policy: PolicySnapshot = LEGACY_V1_POLICY, options: { workspaceRoot?: string; namespace?: string } = {}) {
    this.directory = resolve(directory);
    this.#boundary = boundary;
    this.#policy = parsePolicySnapshot(policy);
    this.#workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : workspaceForHostPath(this.directory);
    this.#namespace = options.namespace;
  }

  #stateFile(name: string): HostStateFile | null {
    return this.#workspaceRoot && !immutableHostArtifact(name)
      ? new HostStateFile(this.#workspaceRoot, resolve(this.directory, name), this.#namespace) : null;
  }

  get policy(): PolicySnapshot {
    return this.#policy;
  }

  get writerId(): string | null {
    return this.#lockContent ? sha256(this.#lockContent) : null;
  }

  async verifyWriter(): Promise<void> {
    const writerId = this.writerId;
    requireCondition(this.#leaseState === 'open' && writerId, 'an exclusive store writer lease is required.');
    await this.#assertWriter(writerId);
  }

  async acquireWriter(): Promise<void> {
    requireCondition(this.#leaseState === 'unleased', `writer lease is ${this.#leaseState}; close it before acquisition.`);
    this.#leaseState = 'acquiring';
    try {
      await mkdir(this.directory, { recursive: true });
      const handle = await open(resolve(this.directory, '.writer-lock'), 'wx');
      const content = JSON.stringify({
        schemaVersion: 'workflow-foundation-lock/v1', token: randomUUID(), pid: process.pid,
      });
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } catch (error) {
        await handle.close();
        throw error;
      }
      this.#lock = handle;
      this.#lockContent = content;
      this.#leaseState = 'open';
    } catch (error) {
      this.#leaseState = 'unleased';
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#leaseState === 'closing') {
      requireCondition(this.#closing, 'writer release is unavailable.');
      return this.#closing;
    }
    requireCondition(this.#leaseState !== 'acquiring', 'writer acquisition must finish before close.');
    if (this.#leaseState === 'unleased') return;
    const stateFile = this.#stateFile('store-close.json');
    requireCondition(!stateFile?.inTransaction(), 'store close cannot run inside a Host transaction.');
    const handle = this.#lock;
    const writerId = this.writerId;
    requireCondition(handle && writerId, 'writer lease is unavailable.');
    // Seal admission before yielding; already admitted mutations drain under this lease.
    this.#leaseState = 'closing';
    const closing = Promise.allSettled([this.#tail, ...this.#walPending]).then(async () => {
      try {
        if (stateFile && !await stateFile.uncertain()) await stateFile.read();
        await this.#assertWriter(writerId);
      } finally {
        this.#lock = undefined;
        this.#lockContent = undefined;
        await handle.close();
      }
      await rm(resolve(this.directory, '.writer-lock'));
    }).finally(() => {
      this.#leaseState = 'unleased';
      this.#closing = undefined;
    });
    this.#closing = closing;
    this.#tail = closing.then(() => undefined, () => undefined);
    return closing;
  }

  async read(name: string): Promise<string | undefined> {
    requireCondition(/^[a-z][a-z0-9-]*\.json$/.test(name), 'invalid store filename.');
    const state = this.#stateFile(name);
    if (state) return state.read();
    try {
      return await readExactUtf8(resolve(this.directory, name));
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }

  }

  async list(): Promise<string[]> {
    const state = this.#stateFile('store-list.json');
    if (state) return state.list();
    const { readdir } = await import('node:fs/promises');
    try { return (await readdir(this.directory)).filter((name) => name.endsWith('.json')); }
    catch (error) { if (isMissing(error)) return []; throw error; }
  }

  async mutate<T>(
    name: string,
    label: string,
    update: (original: string | undefined, writerId: string) => { content: string; result: T },
  ): Promise<T> {
    requireCondition(this.#leaseState !== 'closing', 'writer lease is closing; mutation admission is closed.');
    const writerId = this.writerId;
    requireCondition(this.#leaseState === 'open' && writerId, 'an exclusive store writer lease is required.');
    const state = this.#stateFile(name);
    if (state) {
      let changed = false;
      const pending = state.transact(label, async (original) => {
        await this.#assertWriter(writerId);
        const updateResult = update(original, writerId);
        changed = updateResult.content !== original;
        if (changed) {
          await this.#boundary?.({ label, point: 'before-rename' });
          await this.#assertWriter(writerId);
        }
        return updateResult;
      }).then(async (result) => {
        if (changed) await state.afterCommit(() => this.#boundary?.({ label, point: 'after-rename' }));
        return structuredClone(result);
      });
      this.#walPending.add(pending);
      void pending.finally(() => this.#walPending.delete(pending)).catch(() => undefined);
      return pending;
    }
    const pending = this.#tail.then(async () => {
      await this.#assertWriter(writerId);
      const original = await this.read(name);
      const { content, result } = update(original, writerId);
      if (content === original) return result;
      const target = resolve(this.directory, name);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx');
        try {
          await file.writeFile(content, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await this.#boundary?.({ label, point: 'before-rename' });
        await this.#assertWriter(writerId);
        requireCondition(await this.read(name) === original, 'store changed outside its writer lease.');
        await renameWithRetry(temporary, target, this.policy);
        await this.#boundary?.({ label, point: 'after-rename' });
      } finally {
        await rm(temporary, { force: true });
      }
      return structuredClone(result);
    });
    this.#tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #assertWriter(writerId: string): Promise<void> {
    const lockContent = this.#lockContent;
    requireCondition(this.#lock && lockContent && this.writerId === writerId, 'the admitted writer lease is no longer available.');
    const content = await readFile(resolve(this.directory, '.writer-lock'), 'utf8');
    requireCondition(this.#lock && this.#lockContent === lockContent
      && this.writerId === writerId && content === lockContent, 'writer ownership changed; refuse to write or remove its lock.');
  }
}

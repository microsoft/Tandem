import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";

export interface StoredProject {
    version: 1;
    prototypeId: string;
    revision: number;
    updatedAt: string;
}

export class ProjectStoreError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly statusCode = 409,
        options?: ErrorOptions,
    ) {
        super(message, options);
    }
}

export function normalizeProjectId(value: unknown): string {
    const id = String(value || "active").trim().toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    if (
        !/^[a-z0-9][a-z0-9._-]*$/.test(id) || id.endsWith(".") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)
    ) {
        throw new ProjectStoreError("invalid_project_id", "Choose a project ID starting with a letter or number that is not a reserved filename.", 400);
    }
    return id;
}

export async function readJsonFile(path: string): Promise<unknown | undefined> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw new ProjectStoreError("state_unreadable", `Cannot read ${path}. The saved file has been preserved.`, 503, { cause: error });
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new ProjectStoreError("state_corrupt", `Invalid JSON in ${path}. Restore or repair this file before continuing; it has not been overwritten.`, 422, { cause: error });
    }
}

export async function writeJsonAtomically(path: string, value: unknown, beforeCommit = () => {}): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
        const file = await open(temporaryPath, "wx");
        try {
            await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
            await file.sync();
        } finally {
            await file.close();
        }
        beforeCommit();
        await rename(temporaryPath, path);
    } finally {
        await rm(temporaryPath, { force: true });
    }
}

interface Transaction {
    id: string;
    active: boolean;
    assertOwned(): void;
}

interface StoreOptions<T extends StoredProject> {
    root: string;
    create(id: string): T;
    normalize(value: unknown, id: string): T;
    legacyPaths?(id: string): string[];
}

export class ProjectStore<T extends StoredProject> {
    private readonly transactions = new AsyncLocalStorage<Transaction>();

    constructor(private readonly options: StoreOptions<T>) {}

    statePath(id: string): string {
        return join(this.options.root, "efforts", normalizeProjectId(id), "state.json");
    }

    stagePath(id: string, stage: string, revision?: number): string {
        if (!/^[a-z]+$/.test(stage)) throw new ProjectStoreError("invalid_stage", "Invalid lifecycle stage.", 400);
        return join(this.options.root, "efforts", normalizeProjectId(id), "stages", `${stage}${revision === undefined ? "" : `-r${revision}`}.json`);
    }

    private async locked<R>(key: string, operation: (assertOwned: () => void) => Promise<R>, rejectIfBusy: boolean): Promise<R> {
        const target = join(this.options.root, "locks", key);
        await mkdir(dirname(target), { recursive: true });
        let compromised: Error | undefined;
        const assertOwned = () => {
            if (compromised) throw new ProjectStoreError("state_lock_lost", "Project ownership was lost. Reload before retrying.", 409, { cause: compromised });
        };
        let release: () => Promise<void>;
        try {
            release = await lockfile.lock(target, {
                realpath: false,
                stale: 30_000,
                update: 5_000,
                retries: rejectIfBusy ? 0 : { retries: 150, minTimeout: 100, maxTimeout: 100, factor: 1 },
                onCompromised: (error) => { compromised = error; },
            });
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
                throw new ProjectStoreError("state_busy", "Another session is updating this project. Try again when it finishes.");
            }
            throw error;
        }
        try {
            const result = await operation(assertOwned);
            assertOwned();
            return result;
        } finally {
            if (!compromised) await release();
        }
    }

    async transaction<R>(id: string, operation: () => Promise<R>, rejectIfBusy = false): Promise<R> {
        id = normalizeProjectId(id);
        const existing = this.transactions.getStore();
        if (existing?.id === id && existing.active) {
            existing.assertOwned();
            return operation();
        }
        return this.locked(`effort-${id}`, async (assertOwned) => {
            const transaction = { id, assertOwned, active: true };
            try {
                return await this.transactions.run(transaction, operation);
            } finally {
                transaction.active = false;
            }
        }, rejectIfBusy);
    }

    private decode(value: unknown, id: string): T {
        if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
            !("prototypeId" in value) || value.prototypeId !== id) {
            throw new ProjectStoreError("state_schema_invalid", `Saved state for "${id}" has an unsupported version or identity. The file has been preserved.`, 422);
        }
        if ("revision" in value && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)) {
            throw new ProjectStoreError("state_schema_invalid", `Saved state for "${id}" has an invalid revision.`, 422);
        }
        return this.options.normalize(value, id);
    }

    async load(id: string): Promise<T> {
        id = normalizeProjectId(id);
        const stored = await readJsonFile(this.statePath(id));
        if (stored !== undefined) return this.decode(stored, id);
        return this.transaction(id, async () => {
            const current = await readJsonFile(this.statePath(id));
            if (current !== undefined) return this.decode(current, id);
            for (const path of this.options.legacyPaths?.(id) || []) {
                const legacy = await readJsonFile(path);
                if (legacy === undefined) continue;
                // The old "current" effort shared a filename with pointer metadata.
                if (id === "current" && legacy && typeof legacy === "object" &&
                    Object.keys(legacy).every((key) => ["version", "prototypeId", "updatedAt"].includes(key))) continue;
                const state = this.decode(legacy, id);
                state.revision = 0;
                await this.save(state);
                return state;
            }
            return this.options.create(id);
        });
    }

    async save(state: T): Promise<void> {
        return this.transaction(state.prototypeId, async () => {
            const transaction = this.transactions.getStore()!;
            const stored = await readJsonFile(this.statePath(state.prototypeId));
            const revision = stored === undefined ? 0 : this.decode(stored, state.prototypeId).revision;
            if (state.revision !== revision) {
                throw new ProjectStoreError("state_conflict", "This update is based on an older project revision. Reload and retry.");
            }
            const next = { ...state, revision: revision + 1 };
            await writeJsonAtomically(this.statePath(state.prototypeId), next, transaction.assertOwned);
            state.revision = next.revision;
        });
    }

    async current(legacyPaths: string[] = []): Promise<string | null> {
        for (const path of [join(this.options.root, "metadata", "current.json"), ...legacyPaths]) {
            const value = await readJsonFile(path);
            if (value === undefined) continue;
            if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
                !("prototypeId" in value) || typeof value.prototypeId !== "string") {
                throw new ProjectStoreError("state_schema_invalid", `Invalid project pointer in ${path}. The file has been preserved.`, 422);
            }
            return normalizeProjectId(value.prototypeId);
        }
        return null;
    }

    async clearEffortData(id: string): Promise<void> {
        return this.transaction(id, async () => {
            const effort = dirname(this.statePath(id));
            const assertDirectory = async (path: string) => {
                const entry = await lstat(path);
                if (entry.isSymbolicLink() || !entry.isDirectory()) {
                    throw new ProjectStoreError("unsafe_reset_path", "Reset refused a redirected operational directory; saved data was preserved.", 409);
                }
            };
            for (const path of [this.options.root, join(this.options.root, "efforts"), effort]) {
                await assertDirectory(path);
            }
            const children = (await readdir(effort)).filter((name) => name !== "state.json");
            const inspect = async (path: string): Promise<void> => {
                const entry = await lstat(path);
                if (entry.isSymbolicLink()) {
                    throw new ProjectStoreError("unsafe_reset_path", "Reset refused a linked operational file; its target was preserved.", 409);
                }
                if (entry.isDirectory()) {
                    for (const name of await readdir(path)) await inspect(join(path, name));
                }
            };
            for (const name of children) await inspect(join(effort, name));
            for (const name of children) {
                this.transactions.getStore()!.assertOwned();
                await rm(join(effort, name), { recursive: true, force: false });
            }
        });
    }

    async setCurrent(id: string): Promise<void> {
        id = normalizeProjectId(id);
        return this.locked("metadata-current", async (assertOwned) => {
            await this.current();
            await writeJsonAtomically(join(this.options.root, "metadata", "current.json"), {
                version: 1, prototypeId: id, updatedAt: new Date().toISOString(),
            }, assertOwned);
        }, false);
    }
}

import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { ProjectStore, normalizeProjectId, type StoredProject } from "../src/project-store.js";

interface State extends StoredProject { answers: string[] }
function store(root: string, Store = ProjectStore) {
    return new Store<State>({
        root,
        create: (prototypeId) => ({ version: 1, prototypeId, revision: 0, updatedAt: "", answers: [] }),
        normalize: (value, id) => {
            const state = value as State;
            assert.ok(Array.isArray(state.answers));
            return { ...state, prototypeId: id, revision: state.revision ?? 0 };
        },
        legacyPaths: (id) => [join(root, `${id}.json`)],
    });
}

let compiled: Promise<string> | undefined;
async function atomicWriteHarness(options: {
    rename: typeof rename;
    platform?: NodeJS.Platform;
    sleep?: (delay: number) => Promise<void>;
}) {
    compiled ??= readFile(new URL("../src/project-store.ts", import.meta.url), "utf8")
        .then((source) => transform(source, { loader: "ts", format: "cjs", target: "node20" }))
        .then((result) => result.code);
    const require = createRequire(import.meta.url);
    const module = { exports: {} };
    runInNewContext(await compiled, {
        module, exports: module.exports, Error,
        process: { platform: options.platform ?? "win32" },
        require: (id: string) => {
            if (id === "node:fs/promises") return { ...fs, rename: options.rename };
            if (id === "node:timers/promises") return { setTimeout: options.sleep ?? setTimeout };
            return require(id);
        },
    });
    return module.exports as typeof import("../src/project-store.js");
}

test("atomic saves retry transient Windows rename failures without changing the saved file early", async (t) => {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
        await t.test(code, async () => {
            const root = await mkdtemp(join(tmpdir(), "tandem-atomic-store-"));
            const path = join(root, "state.json");
            const previous = '{"revision":1,"answers":["kept"]}\n';
            const next = { revision: 2, answers: ["kept", "new"] };
            const sources: string[] = [];
            const delays: number[] = [];
            let ownershipChecks = 0;
            try {
                await writeFile(path, previous);
                const h = await atomicWriteHarness({
                    rename: async (source, target) => {
                        sources.push(String(source));
                        assert.equal(target, path);
                        assert.equal(ownershipChecks, sources.length);
                        assert.equal(await readFile(path, "utf8"), previous);
                        assert.deepEqual(JSON.parse(await readFile(source, "utf8")), next);
                        if (sources.length < 3) throw Object.assign(new Error("File is busy"), { code });
                        await rename(source, target);
                    },
                    sleep: async (delay) => { delays.push(delay); },
                });
                await h.writeJsonAtomically(path, next, () => { ownershipChecks++; });
                assert.equal(sources.length, 3);
                assert.equal(new Set(sources).size, 1, "Retries reuse the same complete temporary file.");
                assert.deepEqual(delays, [25, 50]);
                assert.deepEqual(JSON.parse(await readFile(path, "utf8")), next);
                assert.deepEqual(await readdir(root), ["state.json"]);
            } finally { await rm(root, { recursive: true, force: true }); }
        });
    }
});

test("exhausted Windows retries preserve persisted state and revision and allow a later save", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-atomic-store-"));
    const blocked = Object.assign(new Error("File remains locked"), { code: "EPERM" });
    const delays: number[] = [];
    let attempts = 0;
    let locked = true;
    try {
        const initial = store(root);
        await initial.save(await initial.load("shared"));
        const previous = await readFile(initial.statePath("shared"), "utf8");
        const h = await atomicWriteHarness({
            rename: async (source, target) => {
                attempts++;
                if (locked) throw blocked;
                await rename(source, target);
            },
            sleep: async (delay) => {
                delays.push(delay);
                if (delays.length === 1) {
                    await assert.rejects(initial.transaction("shared", async () => {
                        assert.fail("Another writer acquired ownership during the retry.");
                    }, true), { code: "state_busy" });
                }
            },
        });
        const current = store(root, h.ProjectStore);
        const state = await current.load("shared");
        state.answers.push("new");
        await assert.rejects(current.save(state), (error: Error) => {
            assert.ok(error instanceof h.ProjectStoreError);
            assert.equal(error.code, "state_write_blocked");
            assert.equal(error.statusCode, 503);
            assert.equal(error.cause, blocked);
            assert.ok(error.message.includes(current.statePath("shared")));
            assert.match(error.message, /preserved/);
            assert.match(error.message, /permissions.*retry/i);
            return true;
        });
        assert.equal(attempts, 7);
        assert.deepEqual(delays, [25, 50, 100, 200, 400, 500]);
        assert.equal(state.revision, 1);
        assert.equal(await readFile(current.statePath("shared"), "utf8"), previous);
        assert.deepEqual(await readdir(join(root, "efforts", "shared")), ["state.json"]);
        locked = false;
        await current.save(state);
        assert.equal(state.revision, 2);
        assert.deepEqual((await initial.load("shared")).answers, ["new"]);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("a lost ownership check aborts a rename retry and preserves saved state", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-atomic-store-"));
    const path = join(root, "state.json");
    let attempts = 0;
    let ownershipChecks = 0;
    let lostOwnership = false;
    try {
        await writeFile(path, '{"revision":1}\n');
        const h = await atomicWriteHarness({
            rename: async () => {
                attempts++;
                throw Object.assign(new Error("File is busy"), { code: "EPERM" });
            },
            sleep: async () => { lostOwnership = true; },
        });
        const lost = new h.ProjectStoreError("state_lock_lost", "Ownership lost.");
        await assert.rejects(h.writeJsonAtomically(path, { revision: 2 }, () => {
            ownershipChecks++;
            if (lostOwnership) throw lost;
        }), (error) => error === lost);
        assert.equal(attempts, 1);
        assert.equal(ownershipChecks, 2);
        assert.equal(await readFile(path, "utf8"), '{"revision":1}\n');
        assert.deepEqual(await readdir(root), ["state.json"]);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("non-transient and non-Windows rename failures are not retried", async (t) => {
    const cases: Array<{ platform: NodeJS.Platform; code: string }> = [
        { platform: "win32", code: "EIO" },
        { platform: "win32", code: "ENOENT" },
        { platform: "linux", code: "EACCES" },
        { platform: "darwin", code: "EPERM" },
    ];
    for (const { platform, code } of cases) {
        await t.test(`${platform} ${code}`, async () => {
            const root = await mkdtemp(join(tmpdir(), "tandem-atomic-store-"));
            const path = join(root, "state.json");
            const failure = Object.assign(new Error("Cannot replace file"), { code });
            let attempts = 0;
            try {
                await writeFile(path, '{"revision":1}\n');
                const h = await atomicWriteHarness({
                    platform,
                    rename: async () => { attempts++; throw failure; },
                    sleep: async () => { assert.fail("Unexpected retry"); },
                });
                await assert.rejects(h.writeJsonAtomically(path, { revision: 2 }), (error) => error === failure);
                assert.equal(attempts, 1);
                assert.equal(await readFile(path, "utf8"), '{"revision":1}\n');
                assert.deepEqual(await readdir(root), ["state.json"]);
            } finally { await rm(root, { recursive: true, force: true }); }
        });
    }
});

test("atomic save recovers from an actual Windows file-sharing lock", {
    skip: process.platform !== "win32", timeout: 15_000,
}, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tandem-atomic-store-"));
    const path = join(root, "state.json");
    let lock: ReturnType<typeof spawn> | undefined;
    let sharingFailures = 0;
    try {
        await writeFile(path, '{"revision":1}\n');
        const escaped = path.replaceAll("'", "''");
        lock = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
            `$f = [IO.File]::Open('${escaped}', 'Open', 'Read', 'ReadWrite'); try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $f.Dispose() }`,
        ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        const [output] = await once(lock.stdout!, "data", { signal: t.signal });
        assert.match(output.toString(), /locked/);
        const h = await atomicWriteHarness({
            rename: async (source, target) => {
                try { await rename(source, target); }
                catch (error) {
                    assert.ok(error instanceof Error && "code" in error);
                    assert.ok(["EPERM", "EACCES", "EBUSY"].includes(String(error.code)));
                    sharingFailures++;
                    if (sharingFailures === 1) lock!.stdin!.end("\n");
                    throw error;
                }
            },
        });
        await h.writeJsonAtomically(path, { revision: 2 });
        assert.ok(sharingFailures > 0, "The operating system must reject at least one rename.");
        assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { revision: 2 });
        assert.deepEqual(await readdir(root), ["state.json"]);
    } finally {
        if (lock && lock.exitCode === null) {
            const exited = once(lock, "exit");
            if (!lock.stdin!.writableEnded) lock.stdin!.end("\n");
            await exited;
        }
        await rm(root, { recursive: true, force: true });
    }
});

test("project transactions preserve concurrent updates and reject stale snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-store-"));
    try {
        const a = store(root);
        const b = store(root);
        const stale = await a.load("shared");
        await Promise.all([a, b].map((current, index) => current.transaction("shared", async () => {
            const state = await current.load("shared");
            state.answers.push(String(index));
            await current.save(state);
        })));
        assert.equal((await a.load("shared")).answers.length, 2);
        await assert.rejects(a.save(stale), { code: "state_conflict" });
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("current is a safe effort ID and pointer writes do not overwrite legacy state", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-store-"));
    try {
        const current = store(root);
        const legacy = { version: 1, prototypeId: "current", updatedAt: "", answers: ["kept"] };
        await writeFile(join(root, "current.json"), JSON.stringify(legacy));
        await current.setCurrent("current");
        assert.deepEqual((await current.load("current")).answers, ["kept"]);
        assert.deepEqual(JSON.parse(await readFile(join(root, "current.json"), "utf8")), legacy);
        assert.equal(await current.current(), "current");
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("corrupt and unsupported state is never replaced with a new project", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-store-"));
    try {
        const current = store(root);
        await writeFile(join(root, "broken.json"), "{broken");
        await assert.rejects(current.load("broken"), { code: "state_corrupt" });
        assert.equal(await readFile(join(root, "broken.json"), "utf8"), "{broken");
        await writeFile(join(root, "future.json"), '{"version":2,"prototypeId":"future"}');
        await assert.rejects(current.load("future"), { code: "state_schema_invalid" });
        for (const id of ["..", ".", "CON", "nul.txt", "trailing."]) {
            assert.throws(() => normalizeProjectId(id), { code: "invalid_project_id" });
        }
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("independent Node processes serialize shared project updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-process-store-"));
    try {
        const runWriter = (id: string) => new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, [
                "--import", "tsx", fileURLToPath(new URL("./helpers/store-writer.ts", import.meta.url)), root, id,
            ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
            let error = "";
            child.stderr.on("data", (data) => { error += data; });
            child.on("error", reject);
            child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(error || `Writer exited ${code}`)));
        });
        const results = await Promise.allSettled([runWriter("a"), runWriter("b")]);
        for (const result of results) if (result.status === "rejected") throw result.reason;
        const state = await store(root).load("shared");
        assert.equal(new Set(state.answers).size, 10);
        assert.equal(state.revision, 10);
    } finally { await rm(root, { recursive: true, force: true }); }
});

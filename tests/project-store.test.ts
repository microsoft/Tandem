import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ProjectStore, normalizeProjectId, type StoredProject } from "../src/project-store.js";

interface State extends StoredProject { answers: string[] }
function store(root: string) {
    return new ProjectStore<State>({
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

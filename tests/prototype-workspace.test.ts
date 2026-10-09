import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { preparePrototypeWorkspace } from "../src/prototype-workspace.js";
import { prototypePreviewBridgeSource } from "../src/prototype-bridge.js";
import { buildPrototypeCheckpointPrompt } from "../src/planning-prompts.js";
import { fingerprintWorkspace } from "../src/execution.js";
import {
    fingerprintPrototypeWorkspace, isPrototypeRuntimeDirectory, prototypeRuntimePath,
} from "../src/prototype-runtime.js";

async function fixture() {
    const root = join(process.cwd(), ".tandem", `prototype-workspace-tests-${randomUUID()}`);
    const projectRoot = join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    return {
        root, projectRoot,
        checkpoint: (id: string) => join(projectRoot, ".tandem", "efforts", "demo", "previews", id),
        async file(path: string, content = path) {
            await mkdir(dirname(join(projectRoot, path)), { recursive: true });
            await writeFile(join(projectRoot, path), content);
        },
        close: () => rm(root, { recursive: true, force: true }),
    };
}

const directoryLink = process.platform === "win32" ? "junction" : "dir";

test("runtime profiles and dev caches are excluded from copies and new source fingerprints, not ordinary source", async () => {
    const f = await fixture();
    try {
        await f.file("app.ts", "application source");
        await f.file(join(".browser-components", "camera.ts"), "real browser UI source");
        await f.file(join("session-browser", "Local State"), "{}");
        await f.file(join("session-browser", "Default", "Preferences"), "{}");
        await f.file(join("session-browser", "CrashpadMetrics.pma"), "browser metrics");
        await f.file(join(".browser-checkpoint", "CrashpadMetrics.pma"), "runtime data");
        await f.file(join(".vite-checkpoint", "deps", "metadata.json"), "dev cache");
        const before = await fingerprintPrototypeWorkspace(f.projectRoot);
        const legacy = await fingerprintWorkspace(f.projectRoot);
        assert.match(before, /^prototype-v2:[0-9a-f]{64}$/);
        assert.match(legacy, /^[0-9a-f]{64}$/);
        const checkpointRoot = f.checkpoint("copy");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot });
        for (const name of [".browser-checkpoint", ".vite-checkpoint", "session-browser"]) {
            await assert.rejects(lstat(join(checkpointRoot, name)), { code: "ENOENT" });
        }
        assert.equal(await readFile(join(checkpointRoot, ".browser-components", "camera.ts"), "utf8"), "real browser UI source");
        assert.equal((await lstat(prototypeRuntimePath(checkpointRoot))).isDirectory(), true);
        assert.equal(prototypeRuntimePath(checkpointRoot), join(f.projectRoot, ".tandem", "efforts", "demo", "runtime", "copy"));
        await f.file(join(".browser-checkpoint", "CrashpadMetrics.pma"), "updated metrics");
        await f.file(join(".vite-checkpoint", "deps", "metadata.json"), "updated cache");
        assert.equal(await fingerprintPrototypeWorkspace(f.projectRoot), before);
        assert.notEqual(await fingerprintWorkspace(f.projectRoot), legacy, "Legacy source baselines retain their original meaning.");
        await f.file(join(".browser-components", "camera.ts"), "changed application source");
        assert.notEqual(await fingerprintPrototypeWorkspace(f.projectRoot), before);
        await f.file(join("ordinary-source", "Local State"), "{}");
        await f.file(join("ordinary-source", "Default", "app.ts"), "source");
        assert.equal(await isPrototypeRuntimeDirectory(join(f.projectRoot, "ordinary-source")), false);
    } finally { await f.close(); }
});

test("Windows-locked browser metrics do not block a checkpoint copy or fingerprint", {
    skip: process.platform !== "win32", timeout: 15000,
}, async (context) => {
    const f = await fixture();
    let lock: ReturnType<typeof spawn> | undefined;
    try {
        await f.file("app.ts", "keep the application");
        const relativePath = join(".browser-checkpoint", "CrashpadMetrics.pma");
        await f.file(relativePath, "locked browser metrics");
        const path = join(f.projectRoot, relativePath).replaceAll("'", "''");
        lock = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
            `$f = [IO.File]::Open('${path}', 'Open', 'ReadWrite', 'None'); try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $f.Dispose() }`,
        ], { stdio: ["pipe", "pipe", "pipe"] });
        const [output] = await once(lock.stdout!, "data", { signal: context.signal });
        assert.match(output.toString(), /locked/);
        await assert.rejects(readFile(join(f.projectRoot, relativePath)), /EPERM|EACCES|EBUSY/);
        const checkpointRoot = f.checkpoint("locked");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot });
        assert.equal(await readFile(join(checkpointRoot, "app.ts"), "utf8"), "keep the application");
        await assert.rejects(lstat(join(checkpointRoot, ".browser-checkpoint")), { code: "ENOENT" });
        assert.match(await fingerprintPrototypeWorkspace(f.projectRoot), /^prototype-v2:/);
    } finally {
        if (lock && lock.exitCode === null) {
            const exited = once(lock, "exit");
            lock.stdin!.end("\n");
            await exited;
        }
        await f.close();
    }
});

test("checkpoint copies isolate original and previous source, skip operational/secrets/generated roots, and share only dependencies", async () => {
    const f = await fixture();
    try {
        await f.file(join("src", "App.tsx"), "original");
        await f.file(join("src", "build", "real-source.ts"), "nested build source");
        await f.file(join("nested", "dist", "source.ts"), "nested dist source");
        for (const path of [".git", ".tandem", "dist", "build", "coverage", ".next", "out"]) {
            await f.file(join(path, "excluded.txt"), "must not copy");
        }
        for (const path of [".env", ".env.local", ".npmrc", "private.pem", join("src", ".env.production")]) await f.file(path, "secret");
        await f.file(join("node_modules", "dependency", "index.js"), "dependency");
        await f.file(join("apps", "web", "node_modules", "nested", "index.js"), "nested dependency");
        const first = f.checkpoint("first");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: first });
        assert.equal(await readFile(join(first, "src", "App.tsx"), "utf8"), "original");
        assert.equal(await readFile(join(first, "src", "build", "real-source.ts"), "utf8"), "nested build source");
        assert.equal(await readFile(join(first, "nested", "dist", "source.ts"), "utf8"), "nested dist source");
        for (const path of [".git", ".tandem", "dist", "build", "coverage", ".next", "out", ".env", ".env.local", ".npmrc", "private.pem", join("src", ".env.production")]) {
            await assert.rejects(lstat(join(first, path)), { code: "ENOENT" });
        }
        assert.equal((await lstat(join(first, "node_modules"))).isSymbolicLink(), true);
        assert.equal(await realpath(join(first, "node_modules")), await realpath(join(f.projectRoot, "node_modules")));
        assert.equal(await readFile(join(first, "apps", "web", "node_modules", "nested", "index.js"), "utf8"), "nested dependency");
        assert.equal(await readFile(join(first, "tandem-preview-bridge.js"), "utf8"), prototypePreviewBridgeSource);
        await writeFile(join(first, "src", "App.tsx"), "first revision");
        assert.equal(await readFile(join(f.projectRoot, "src", "App.tsx"), "utf8"), "original");
        const second = f.checkpoint("second");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: second, sourceRoot: first });
        assert.equal(await readFile(join(second, "src", "App.tsx"), "utf8"), "first revision");
        await writeFile(join(second, "src", "App.tsx"), "second revision");
        assert.equal(await readFile(join(first, "src", "App.tsx"), "utf8"), "first revision");
        assert.equal(await readFile(join(f.projectRoot, "src", "App.tsx"), "utf8"), "original");
        assert.equal(await realpath(join(second, "node_modules")), await realpath(join(f.projectRoot, "node_modules")));
    } finally { await f.close(); }
});

test("completed preparation resumes the same normalized source without replacing edited work", async () => {
    const f = await fixture();
    try {
        await f.file("app.ts", "original");
        const first = f.checkpoint("first");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: first });
        await writeFile(join(first, "app.ts"), "worker edits");
        await f.file("app.ts", "original changed later");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: join(first, "."), sourceRoot: join(f.projectRoot, ".") });
        assert.equal(await readFile(join(first, "app.ts"), "utf8"), "worker edits");
        const next = f.checkpoint("next");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: next, sourceRoot: first });
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: next }), /identity mismatch/);
        assert.equal(await readFile(join(next, "app.ts"), "utf8"), "worker edits");
        await rm(join(next, ".tandem-prototype-workspace.complete.json"));
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: next, sourceRoot: first }), /Incomplete.*preserved/);
        assert.equal(await readFile(join(next, "app.ts"), "utf8"), "worker edits");
    } finally { await f.close(); }
});

test("repeated phase and prepared-failure clones retain their own marker identities and regenerate only their bridge", async () => {
    const f = await fixture();
    try {
        await f.file("app.ts", "initial source");
        let sourceRoot = f.projectRoot;
        const normalized = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
        for (const id of ["displayed", "prepared-but-worker-failed", "explicit-resume"]) {
            const checkpointRoot = f.checkpoint(id);
            const sourceMarker = sourceRoot === f.projectRoot ? null :
                await readFile(join(sourceRoot, ".tandem-prototype-workspace.json"), "utf8");
            await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot, sourceRoot });
            const expected = {
                version: 1, projectRoot: normalized(f.projectRoot), sourceRoot: normalized(sourceRoot),
                storageRoot: normalized(join(f.projectRoot, ".tandem")),
                checkpointRoot: normalized(checkpointRoot),
            };
            assert.deepEqual(JSON.parse(await readFile(join(checkpointRoot, ".tandem-prototype-workspace.json"), "utf8")), { ...expected, complete: false });
            assert.deepEqual(JSON.parse(await readFile(join(checkpointRoot, ".tandem-prototype-workspace.complete.json"), "utf8")), { ...expected, complete: true });
            assert.equal(await readFile(join(checkpointRoot, "tandem-preview-bridge.js"), "utf8"), prototypePreviewBridgeSource);
            if (sourceMarker !== null) {
                assert.equal(await readFile(join(sourceRoot, ".tandem-prototype-workspace.json"), "utf8"), sourceMarker);
                assert.equal(await readFile(join(sourceRoot, "tandem-preview-bridge.js"), "utf8"), "older served bridge");
                assert.equal(await readFile(join(checkpointRoot, "app.ts"), "utf8"), "candidate work");
            }
            await writeFile(join(checkpointRoot, "app.ts"), "candidate work");
            await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot, sourceRoot });
            assert.equal(await readFile(join(checkpointRoot, "app.ts"), "utf8"), "candidate work");
            await writeFile(join(checkpointRoot, "tandem-preview-bridge.js"), "older served bridge");
            sourceRoot = checkpointRoot;
        }
        assert.equal(await readFile(join(f.projectRoot, "app.ts"), "utf8"), "initial source");
    } finally { await f.close(); }
});

test("existing partial checkpoint, corrupt markers and source marker collisions are never overwritten", async () => {
    const f = await fixture();
    try {
        const partial = f.checkpoint("partial");
        await mkdir(partial, { recursive: true });
        await writeFile(join(partial, "work.ts"), "precious");
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: partial }), /Incomplete/);
        assert.equal(await readFile(join(partial, "work.ts"), "utf8"), "precious");
        const complete = f.checkpoint("complete");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: complete });
        await writeFile(join(complete, ".tandem-prototype-workspace.json"), "{broken");
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: complete }), SyntaxError);
        assert.equal(await readFile(join(complete, ".tandem-prototype-workspace.json"), "utf8"), "{broken");
        await f.file("tandem-preview-bridge.js", "user source");
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: f.checkpoint("collision") }), /reserved preparation filename/);
        assert.equal(await readFile(join(f.projectRoot, "tandem-preview-bridge.js"), "utf8"), "user source");
    } finally { await f.close(); }
});

test("shared repository storage outside the active worktree supports first preparation, checkpoint cloning, local dependencies and reload", async () => {
    const f = await fixture();
    try {
        const storageRoot = join(f.root, "shared-repository", ".tandem");
        const checkpoint = (id: string) => join(storageRoot, "efforts", "demo", "previews", id);
        await f.file("app.ts", "worktree source");
        await f.file(join("node_modules", "existing", "index.js"), "worktree dependency");
        const first = checkpoint("first");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, storageRoot, checkpointRoot: first });
        assert.equal(await readFile(join(first, "app.ts"), "utf8"), "worktree source");
        assert.equal(await realpath(join(first, "node_modules")), await realpath(join(f.projectRoot, "node_modules")));
        await writeFile(join(first, "app.ts"), "displayed source");
        await mkdir(join(first, "app", "node_modules", "local"), { recursive: true });
        await writeFile(join(first, "app", "node_modules", "local", "index.js"), "candidate-local dependency");
        const second = checkpoint("second");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, storageRoot, checkpointRoot: second, sourceRoot: first });
        await writeFile(join(second, "app.ts"), "new revision");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, storageRoot, checkpointRoot: second, sourceRoot: first });
        assert.equal(await readFile(join(second, "app.ts"), "utf8"), "new revision");
        assert.equal(await readFile(join(first, "app.ts"), "utf8"), "displayed source");
        assert.equal(await readFile(join(f.projectRoot, "app.ts"), "utf8"), "worktree source");
        assert.equal(await readFile(join(second, "tandem-preview-bridge.js"), "utf8"), prototypePreviewBridgeSource);
        assert.equal(await realpath(join(second, "app", "node_modules")), await realpath(join(first, "app", "node_modules")));
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, storageRoot, checkpointRoot: f.checkpoint("wrong-storage") }), /Checkpoint path/);
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, storageRoot, checkpointRoot: checkpoint("escape"), sourceRoot: f.checkpoint("foreign-source") }), /path escape/);
    } finally { await f.close(); }
});

test("custom in-project storage is excluded from source copying and linked external storage is rejected", async () => {
    const f = await fixture();
    try {
        await f.file("app.ts", "source");
        const storageRoot = join(f.projectRoot, "operations");
        const checkpointRoot = join(storageRoot, "efforts", "demo", "previews", "first");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, storageRoot, checkpointRoot });
        await assert.rejects(lstat(join(checkpointRoot, "operations")), { code: "ENOENT" });
        const external = join(f.root, "external-storage");
        const alias = join(f.root, "storage-alias");
        await mkdir(external);
        await symlink(external, alias, directoryLink);
        await assert.rejects(preparePrototypeWorkspace({
            projectRoot: f.projectRoot, storageRoot: alias,
            checkpointRoot: join(alias, "efforts", "demo", "previews", "linked"),
        }), /Unsupported linked/);
        assert.deepEqual(await readdir(external), []);
    } finally { await f.close(); }
});

test("generated directory names do not exclude ordinary root files", async () => {
    const f = await fixture();
    try {
        await f.file("build", "build script");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: f.checkpoint("files") });
        assert.equal(await readFile(join(f.checkpoint("files"), "build"), "utf8"), "build script");
    } finally { await f.close(); }
});

test("checkpoint path escape, self-source, and non-checkpoint operational sources are rejected", async () => {
    const f = await fixture();
    try {
        for (const checkpointRoot of [join(f.root, "outside"), f.projectRoot, join(f.projectRoot, "source"), join(f.checkpoint("x"), "..")]) {
            await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot }), /Checkpoint path/);
        }
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: ".", checkpointRoot: f.checkpoint("relative") }), /absolute/);
        for (const sourceRoot of [f.root, f.checkpoint("same"), join(f.projectRoot, ".tandem", "efforts", "demo")]) {
            await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: f.checkpoint("same"), sourceRoot }), /path escape/);
        }
    } finally { await f.close(); }
});

test("source symlinks/junctions, including internal links, fail visibly rather than omitting linked code", async () => {
    for (const external of [true, false]) {
        const f = await fixture();
        try {
            const target = join(external ? f.root : f.projectRoot, "linked-source");
            await mkdir(target);
            await writeFile(join(target, "code.ts"), "linked source");
            await symlink(target, join(f.projectRoot, "alias"), directoryLink);
            const checkpointRoot = f.checkpoint("linked");
            await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot }), /Unsupported source symlink\/junction/);
            await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot }), /Incomplete/);
            assert.equal(await readFile(join(target, "code.ts"), "utf8"), "linked source");
        } finally { await f.close(); }
    }
});

test("target ancestor junctions cannot write outside the project", async () => {
    const f = await fixture();
    try {
        const outside = join(f.root, "outside");
        await mkdir(outside);
        await symlink(outside, join(f.projectRoot, ".tandem"), directoryLink);
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: f.checkpoint("escape") }), /Unsupported linked/);
        assert.deepEqual(await readdir(outside), []);
    } finally { await f.close(); }
});

test("workspace-linked dependencies and their peers resolve isolated copied source across checkpoints", async () => {
    const f = await fixture();
    try {
        const manifest = JSON.stringify({ type: "commonjs", main: "index.js" });
        await f.file(join("packages", "ui", "package.json"), manifest);
        await f.file(join("packages", "ui", "index.js"), 'module.exports = "original";');
        await f.file(join("node_modules", "consumer", "package.json"), manifest);
        await f.file(join("node_modules", "consumer", "index.js"), 'module.exports = require("workspace-package");');
        await symlink(join(f.projectRoot, "packages", "ui"), join(f.projectRoot, "node_modules", "workspace-package"), directoryLink);
        const first = f.checkpoint("deps-first");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: first });
        assert.equal((await lstat(join(first, "node_modules"))).isSymbolicLink(), false);
        assert.equal(await realpath(join(first, "node_modules", "workspace-package")), await realpath(join(first, "packages", "ui")));
        await writeFile(join(first, "packages", "ui", "index.js"), 'module.exports = "first";');
        assert.equal(createRequire(join(first, "package.json"))("consumer"), "first");
        assert.equal(createRequire(join(f.projectRoot, "package.json"))("consumer"), "original");
        const second = f.checkpoint("deps-second");
        await preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: second, sourceRoot: first });
        await writeFile(join(second, "packages", "ui", "index.js"), 'module.exports = "second";');
        assert.equal(await realpath(join(second, "node_modules", "workspace-package")), await realpath(join(second, "packages", "ui")));
        assert.equal(createRequire(join(second, "package.json"))("consumer"), "second");
        assert.equal(await readFile(join(first, "packages", "ui", "index.js"), "utf8"), 'module.exports = "first";');
    } finally { await f.close(); }
});

test("external dependencies still fail rather than following source outside the project", async () => {
    const f = await fixture();
    try {
        const target = join(f.root, "external-package");
        await mkdir(target);
        await writeFile(join(target, "index.js"), "external application");
        await mkdir(join(f.projectRoot, "node_modules"));
        await symlink(target, join(f.projectRoot, "node_modules", "external-package"), directoryLink);
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot: f.checkpoint("deps") }), /Unsupported workspace\/external dependency link/);
        assert.equal(await readFile(join(target, "index.js"), "utf8"), "external application");
    } finally { await f.close(); }
});

test("bounded source copy rejects oversized files before copying data and preserves interrupted preparation", async () => {
    const f = await fixture();
    try {
        const file = await open(join(f.projectRoot, "huge.bin"), "wx");
        try { await file.truncate(256 * 1024 * 1024 + 1); } finally { await file.close(); }
        const checkpointRoot = f.checkpoint("large");
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot }), /256 MiB copy limit/);
        await assert.rejects(lstat(join(checkpointRoot, "huge.bin")), { code: "ENOENT" });
        await assert.rejects(preparePrototypeWorkspace({ projectRoot: f.projectRoot, checkpointRoot }), /Incomplete/);
    } finally { await f.close(); }
});

class FakeControl {
    id = "";
    name = "";
    tagName = "INPUT";
    type = "text";
    value = "";
    checked = false;
    disabled = false;
    multiple = false;
    privateField = false;
    form: { id: string; name: string } | null = null;
    attributes: Record<string, string> = {};
    options: Array<{ value: string; selected: boolean }> = [];
    events: string[] = [];
    constructor(values: Partial<FakeControl>) { Object.assign(this, values); }
    getAttribute(name: string) { return this.attributes[name] ?? null; }
    closest() { return this.privateField ? this : null; }
    dispatchEvent(event: Event) { this.events.push(event.type); return true; }
}

interface PreviewState {
    version: number;
    route: string | null;
    scroll: { x: number; y: number };
    fields: Array<{ key: Record<string, unknown>; value: unknown }>;
    app?: unknown;
}

function bridgeHarness(options: {
    referrer?: string; base?: string; controls?: FakeControl[];
    hook?: { capture?: () => unknown; restore?: (value: unknown) => void };
} = {}) {
    const messages: Array<{ message: { type: string; requestId: string; prototypeId: string; state: PreviewState }; origin: string }> = [];
    const warnings: unknown[][] = [];
    const handlers = new Map<string, (event: { source: unknown; origin: string; data: unknown }) => void>();
    const replaced: string[] = [];
    const scrolls: number[][] = [];
    const events: string[] = [];
    let prototypeId = "demo";
    const parent = { postMessage: (message: typeof messages[number]["message"], origin: string) => messages.push({ message, origin }) };
    const window = {
        parent,
        location: new URL("http://127.0.0.1:5177/app/start?view=grid&access_token=secret#details"),
        scrollX: 12, scrollY: 140,
        tandemPreviewState: options.hook,
        history: { replaceState(_state: unknown, _unused: string, url: string) { replaced.push(url); } },
        dispatchEvent(event: Event) { events.push(event.type); },
        scrollTo(x: number, y: number) { scrolls.push([x, y]); },
        requestAnimationFrame(callback: () => void) { callback(); },
        addEventListener(name: string, callback: typeof handlers extends Map<string, infer T> ? T : never) { handlers.set(name, callback); },
    };
    runInNewContext(prototypePreviewBridgeSource, {
        window, URL, Event, TextEncoder,
        console: { warn: (...args: unknown[]) => warnings.push(args) },
        document: {
            referrer: options.referrer ?? "https://tandem.example/panel",
            querySelector(selector: string) {
                if (selector === 'meta[name="tandem-prototype-id"]') return { getAttribute: () => prototypeId };
                if (selector === "base[href]" && options.base) return { getAttribute: () => options.base };
                return null;
            },
            querySelectorAll(selector: string) {
                assert.equal(selector, "input, textarea, select");
                return options.controls ?? [];
            },
        },
    });
    return {
        messages, warnings, replaced, scrolls, events, window, parent,
        setPrototypeId(value: string) { prototypeId = value; },
        send(data: unknown, origin = "https://tandem.example", source: unknown = parent) { handlers.get("message")?.({ data, origin, source }); },
        capture() {
            handlers.get("message")?.({ source: parent, origin: "https://tandem.example", data: { type: "tandem:preview:capture", prototypeId, requestId: "capture-1" } });
            return messages.at(-1)?.message.state;
        },
    };
}

test("bridge authenticates parent window, referrer origin, actual document identity and capture request identity", () => {
    const h = bridgeHarness();
    const request = { type: "tandem:preview:capture", prototypeId: "demo", requestId: "request" };
    h.send(request, "https://untrusted.example");
    h.send(request, "https://tandem.example", {});
    h.send({ ...request, prototypeId: "other" });
    h.send({ ...request, requestId: "" });
    assert.equal(h.messages.length, 0);
    h.send(request);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].origin, "https://tandem.example");
    assert.equal(h.messages[0].message.type, "tandem:preview:state");
    assert.equal(h.messages[0].message.requestId, "request");
    h.setPrototypeId("new-document");
    h.send(request);
    assert.equal(h.messages.length, 1);
    for (const referrer of ["", "not a URL", "file:///local/parent", "data:text/html,hello"]) {
        const disabled = bridgeHarness({ referrer });
        disabled.send(request);
        assert.equal(disabled.messages.length, 0);
        assert.equal(disabled.warnings.length, 1);
    }
});

test("bridge captures safe form fields using exact id/name identities and restores route, controls, scroll and app camera", () => {
    const title = new FakeControl({ id: 'title:with["punctuation"]', name: "title", value: "Mock title", form: { id: "editor", name: "" } });
    const duplicate = new FakeControl({ name: "choice", type: "radio", checked: true });
    const duplicate2 = new FakeControl({ name: "choice", type: "radio", checked: false });
    const select = new FakeControl({ name: "selectedItems", tagName: "SELECT", type: "select-multiple", multiple: true, options: [{ value: "a", selected: true }, { value: "b", selected: false }] });
    const restored: unknown[] = [];
    const h = bridgeHarness({ controls: [title, duplicate, duplicate2, select], hook: {
        capture: () => ({ camera: { x: 3, zoom: 2 }, selected: "item-1" }),
        restore: (state) => restored.push(state),
    } });
    const captured = h.capture();
    assert.ok(captured);
    assert.equal(captured.route, "/app/start?view=grid#details");
    assert.equal(captured.fields.length, 4);
    assert.equal(captured.fields[1].key.index, 0);
    assert.equal(captured.fields[2].key.index, 1);
    title.value = "changed"; duplicate.checked = false; duplicate2.checked = true;
    select.options[0].selected = false; select.options[1].selected = true;
    h.send({ type: "tandem:preview:restore", prototypeId: "demo", state: captured });
    assert.equal(title.value, "Mock title");
    assert.equal(duplicate.checked, true);
    assert.equal(duplicate2.checked, false);
    assert.equal(select.options[0].selected, true);
    assert.equal(select.options[1].selected, false);
    assert.deepEqual(title.events, ["input", "change"]);
    assert.deepEqual(h.replaced, ["/app/start?view=grid#details"]);
    assert.deepEqual(h.scrolls, [[12, 140]]);
    assert.deepEqual(h.events, ["popstate"]);
    assert.deepEqual(JSON.parse(JSON.stringify(restored)), [{ camera: { x: 3, zoom: 2 }, selected: "item-1" }]);
});

test("bridge excludes credentials, payment/autocomplete fields, anonymous/private controls and token-like values", () => {
    const sensitive = [
        new FakeControl({ name: "password", type: "password", value: "secret" }),
        new FakeControl({ name: "attachment", type: "file", value: "file" }),
        new FakeControl({ name: "accessToken", value: "secret" }),
        new FakeControl({ name: "card", value: "123", attributes: { autocomplete: "section-payment cc-number" } }),
        new FakeControl({ name: "login", value: "secret", attributes: { autocomplete: "current-password" } }),
        new FakeControl({ name: "misc", value: "ghp_abc123" }),
        new FakeControl({ name: "internal", value: "secret", type: "hidden" }),
        new FakeControl({ name: "csrf", value: "secret" }),
        new FakeControl({ name: "session", value: "secret" }),
        new FakeControl({ name: "private", value: "secret", privateField: true }),
        new FakeControl({ value: "anonymous" }),
    ];
    const publicField = new FakeControl({ name: "search", value: "sample" });
    const h = bridgeHarness({ controls: [...sensitive, publicField], hook: { capture: () => ({ selected: "safe", accessToken: "secret", nested: { password: "secret", zoom: 2 } }) } });
    const state = h.capture();
    assert.ok(state);
    assert.equal(state.fields.length, 1);
    assert.equal(state.fields[0].value, "sample");
    assert.equal(JSON.stringify(state).includes("secret"), false);
    h.send({ type: "tandem:preview:restore", prototypeId: "demo", state: {
        ...state, fields: [{ key: { ...state.fields[0].key, name: "accessToken" }, value: "changed" }],
    } });
    assert.equal(sensitive[2].value, "secret");
});

test("bridge rejects external and out-of-app routes, oversized state, mismatched restore identity and sensitive query/hash", () => {
    const h = bridgeHarness({ base: "/app/" });
    const state = h.capture();
    assert.ok(state);
    for (const route of ["https://attacker.example/", "//attacker.example/", "/\\attacker.example/", "/outside", "/app/../outside"]) {
        h.send({ type: "tandem:preview:restore", prototypeId: "demo", state: { ...state, route } });
    }
    h.send({ type: "tandem:preview:restore", prototypeId: "wrong", state });
    h.send({ type: "tandem:preview:restore", prototypeId: "demo", state: { ...state, app: "x".repeat(70_000) } });
    assert.equal(h.replaced.length, 0);
    assert.equal(h.warnings.length, 6);
    h.send({ type: "tandem:preview:restore", prototypeId: "demo", state: { ...state, route: "/app/result?code=secret&tab=items#access_token=secret" } });
    assert.deepEqual(h.replaced, ["/app/result?tab=items"]);
    assert.deepEqual(h.events, ["popstate", "hashchange"]);
});

test("bridge caps payloads and hook failures warn visibly without losing ordinary state", () => {
    const controls = Array.from({ length: 200 }, (_, index) => new FakeControl({ name: `field${index}`, value: "界".repeat(4096) }));
    const h = bridgeHarness({ controls, hook: {
        capture() { throw new Error("App capture unavailable"); },
        restore() { throw new Error("App restore unavailable"); },
    } });
    const state = h.capture();
    assert.ok(state);
    assert.ok(state.fields.length > 0 && state.fields.length < 128);
    assert.ok(new TextEncoder().encode(JSON.stringify(h.messages[0].message)).length <= 65536);
    assert.equal(h.warnings.length, 1);
    h.send({ type: "tandem:preview:restore", prototypeId: "demo", state: { ...state, app: { zoom: 2 } } });
    assert.equal(h.warnings.length, 2);
    assert.deepEqual(h.scrolls, [[12, 140]]);
    const hugeHook = bridgeHarness({ hook: { capture: () => Array.from({ length: 20 }, () => "x".repeat(4096)) } });
    assert.ok(hugeHook.capture());
    assert.equal(hugeHook.messages[0].message.state.app, undefined);
    assert.equal(hugeHook.warnings.length, 1);
});

test("checkpoint production prompt differentiates milestone scope and binds isolation, verification, revision and reduced output contracts", () => {
    const projectRoot = process.cwd();
    const workspacePath = join(projectRoot, ".tandem", "efforts", "demo", "previews", "candidate");
    const args: Parameters<typeof buildPrototypeCheckpointPrompt>[0] = {
        prototypeId: "demo", projectRoot,
        checkpoint: { id: "candidate", milestone: "structure", workspacePath, timeoutSeconds: 999, baseCheckpointId: "newest-base" },
        goal: "Build a task map", approach: "build", requirements: { actor: "editor" }, confirmed: ["mock changes"],
        revision: null,
        baseSummary: "Added newer navigation", baseFocus: "Navigation", parentOrigin: "https://tandem.example", artifacts: [],
    };
    const structure = buildPrototypeCheckpointPrompt(args);
    for (const expected of [
        "STRUCTURE: deliver the smallest real clickable primary journey ASAP.",
        workspacePath, "last-good published preview remains running",
        "manual Update promotion", "No canvases", "Edit ONLY", "shared dependencies are",
        "NOT recursive target deletion", "Never reuse a live published preview port", "actually fetch the EXACT preview URL",
        'name="tandem-prototype-id" content="demo"', 'name="tandem-prototype-checkpoint" content="candidate"',
        "tandem-preview-bridge.js", "JavaScript MIME", "document.referrer", "tandemPreviewState",
        "Newest selected base checkpoint: newest-base", "preserve unrelated newer changes",
        "3-5 distinct choices", "DO NOT edit files", "artifactChanges", "stage: 'prototype'",
        "NOT candidate-relative", "full current state", "actual relative", "session-managed",
        "not the target GUI",
        "Auxiliary runtime directory:", "outside checkpoint source", "Never reuse",
    ]) assert.ok(structure.includes(expected), expected);
    assert.ok(relative(projectRoot, workspacePath).startsWith(".tandem"));
    assert.ok(!structure.includes("INTERACTION: improve"));
    const interaction = buildPrototypeCheckpointPrompt({ ...args, checkpoint: { ...args.checkpoint, milestone: "interaction", timeoutSeconds: 120 } });
    assert.match(interaction, /INTERACTION: improve one primary end-to-end workflow/);
    assert.doesNotMatch(structure, /Bounded execution budget|never more than 300|Stop within the time budget/);
    assert.doesNotMatch(interaction, /120 seconds|Bounded execution budget|Stop within the time budget/);
    assert.match(interaction, /deterministic mock/);
    assert.ok(!interaction.includes("STRUCTURE: deliver"));
    const visual = buildPrototypeCheckpointPrompt({ ...args, checkpoint: { ...args.checkpoint, milestone: "visual" } });
    assert.match(visual, /VISUAL DIRECTION \(optional\)/);
    assert.match(visual, /Do not create a new design system/);
    const existing = buildPrototypeCheckpointPrompt({ ...args, approach: "validate-existing" });
    assert.match(existing, /SAME existing GUI/);
    assert.match(existing, /never create a parallel reimplementation/);
    assert.match(existing, /DecisionQuestion uses \{ id, text, rationale/);
    const sharedWorkspace = join(dirname(projectRoot), "shared-repository", ".tandem", "efforts", "demo", "previews", "shared");
    const shared = buildPrototypeCheckpointPrompt({ ...args, checkpoint: { ...args.checkpoint, workspacePath: sharedWorkspace } });
    assert.ok(shared.includes(`Checkpoint path relative to original project root: ${relative(projectRoot, sharedWorkspace)}`));
    assert.match(shared, /preserve the required parent path segments/);
});

test("checkpoint revisions follow only requested scope at every fidelity, including behavior changes after Visual direction", () => {
    for (const milestone of ["structure", "interaction", "visual"] as const) {
        const prompt = buildPrototypeCheckpointPrompt({
            prototypeId: "demo", projectRoot: process.cwd(),
            checkpoint: {
                id: "revision", milestone, workspacePath: join(process.cwd(), ".tandem", "efforts", "demo", "previews", "revision"),
                timeoutSeconds: 120, baseCheckpointId: "latest-visual",
            },
            goal: "Build a task map", approach: "build", requirements: {}, confirmed: ["Preserve navigation"],
            revision: { suggestion: "Add multi-select behavior", baseCheckpointId: "older-feedback-base", clarifications: ["Keep camera position"] },
        });
        for (const expected of [
            `Milestone: ${milestone} (existing fidelity; revision scope takes precedence)`,
            "REVISION: apply ONLY the requested suggestion",
            "A behavior revision after Visual", "not a task to repeat or a restriction",
            "Do not rerun the whole milestone", "rebuild unrelated completed flows",
            "Do not scaffold a replacement app", "no-production prototype boundaries",
            "Add multi-select behavior", "older-feedback-base", "Keep camera position",
            "Newest selected base checkpoint: latest-visual", "preserve unrelated newer changes",
            "Do not implement production backends", "tests/test suites",
        ]) assert.ok(prompt.includes(expected), expected);
        for (const milestoneInstruction of ["STRUCTURE: deliver", "INTERACTION: improve", "VISUAL DIRECTION (optional)", "If no suitable GUI exists"]) {
            assert.ok(!prompt.includes(milestoneInstruction), milestoneInstruction);
        }
    }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { test, type TestContext } from "node:test";
import {
    acceptStageSnapshot, exportAcceptedSnapshot, validateAcceptanceRecords,
    type AcceptanceRecord, type AcceptStageSnapshotInput,
} from "../src/accepted-artifacts.js";
import { executionDigest, fingerprintWorkspace } from "../src/execution.js";
import { ProjectStoreError } from "../src/project-store.js";
import type { LifecycleStageId } from "../src/types.js";

const hash = (value: string) => executionDigest(value);
const artifact = (overrides = {}) => ({
    id: "requirements-result", title: "Requirements", kind: "document", stage: "requirements",
    path: "requirements.md", language: "markdown", content: "Ship the requested workflow.\n", mermaid: "",
    ...overrides,
});

async function fixture(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "tandem-acceptance-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sharedRoot = join(root, "shared");
    const workspaceRoot = join(root, "worktree");
    const stages = join(sharedRoot, ".tandem", "efforts", "example", "stages");
    await mkdir(stages, { recursive: true });
    await mkdir(workspaceRoot);
    const input: AcceptStageSnapshotInput = {
        workspaceRoot, sharedRoot, effortId: "example", stageId: "requirements",
        snapshotPath: relative(sharedRoot, join(stages, "requirements-r7.json")),
        acceptedBy: { label: "Reviewer", sessionId: "session-one" },
        source: { commit: "a".repeat(40), fingerprint: hash("workspace") },
        producer: { version: "1.0.7", configurationHash: hash("configuration") },
        upstream: [{ id: hash("preparation acceptance"), hash: hash("preparation snapshot") }],
    };
    const snapshot = (revision = 7, stage: LifecycleStageId = "requirements", artifacts = [artifact()]) => ({
        version: 1, prototypeId: "example", stageId: stage, revision,
        completedAt: "2026-09-08T05:00:00.000Z", skipped: false, skipReason: null,
        result: { goal: "A safe explicit handoff", requirements: { usageItems: ["A user can accept a handoff"] }, artifacts },
    });
    const sourcePath = join(sharedRoot, input.snapshotPath);
    const bytes = Buffer.from(`${JSON.stringify(snapshot(), null, 2)}\n`);
    await writeFile(sourcePath, bytes);
    const acceptedPath = (record: AcceptanceRecord) =>
        join(sharedRoot, ".tandem", "efforts", "example", "accepted", record.id);
    return { root, stages, input, bytes, snapshot, sourcePath, acceptedPath };
}

function projectError(error: unknown): boolean {
    assert.ok(error instanceof ProjectStoreError);
    return true;
}

test("acceptance hashes exact bytes and stage content, preserves timestamps, and makes immutable copies", async (t) => {
    const f = await fixture(t);
    const record = await acceptStageSnapshot(f.input);
    assert.match(record.id, /^[a-f0-9]{64}$/);
    assert.equal(record.snapshotHash, createHash("sha256").update(f.bytes).digest("hex"));
    assert.deepEqual(record.artifactHashes, [{ id: "requirements-result", hash: hash(artifact().content) }]);
    assert.equal(record.snapshotPath, f.input.snapshotPath);
    assert.equal(record.exportPath, null);
    assert.deepEqual(validateAcceptanceRecords([record]), [record]);
    const manifestPath = join(f.acceptedPath(record), "manifest.json");
    const before = await readFile(manifestPath);
    const beforeStat = await stat(manifestPath);
    const repeated = await acceptStageSnapshot(f.input);
    assert.deepEqual(repeated, record);
    assert.deepEqual(await readFile(manifestPath), before);
    assert.equal((await stat(manifestPath)).mtimeMs, beforeStat.mtimeMs);
    assert.deepEqual(await readFile(join(f.acceptedPath(record), "snapshot.json")), f.bytes);
    assert.deepEqual(await readFile(f.sourcePath), f.bytes);
    assert.deepEqual(await readdir(join(f.input.sharedRoot, ".tandem", "efforts", "example", "accepted")), [record.id]);
    const portablePath = f.input.snapshotPath.replace(/\\/g, "/");
    const portable = await acceptStageSnapshot({ ...f.input, snapshotPath: portablePath });
    assert.equal(portable.id, record.id);
    assert.equal(portable.acceptedAt, record.acceptedAt);
    assert.equal(portable.snapshotPath, portablePath);
});

test("concurrent repeat acceptance and exports converge without replacing files", async (t) => {
    const f = await fixture(t);
    const [first, second] = await Promise.all([acceptStageSnapshot(f.input), acceptStageSnapshot(f.input)]);
    assert.deepEqual(first, second);
    const results = await Promise.all([
        exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", first),
        exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", second),
    ]);
    assert.deepEqual(results[0], results[1]);
    const directory = join(f.input.workspaceRoot, results[0].exportPath!);
    const manifestPath = join(directory, "manifest.json");
    const before = await stat(manifestPath);
    assert.deepEqual(await exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", results[0]), results[0]);
    assert.equal((await stat(manifestPath)).mtimeMs, before.mtimeMs);
});

test("approval, session, source, producer, upstream and snapshot revision participate in identity", async (t) => {
    const f = await fixture(t);
    const original = await acceptStageSnapshot(f.input);
    const changes: Partial<AcceptStageSnapshotInput>[] = [
        { acceptedBy: { ...f.input.acceptedBy, label: "Another reviewer" } },
        { acceptedBy: { ...f.input.acceptedBy, sessionId: "session-two" } },
        { source: { ...f.input.source, fingerprint: hash("changed sources") } },
        { source: { ...f.input.source, commit: null } },
        { producer: { ...f.input.producer, version: "1.0.8" } },
        { producer: { ...f.input.producer, configurationHash: hash("changed configuration") } },
        { upstream: [{ ...f.input.upstream[0], hash: hash("changed upstream") }] },
    ];
    const ids = new Set([original.id]);
    for (const change of changes) ids.add((await acceptStageSnapshot({ ...f.input, ...change })).id);
    assert.equal(ids.size, changes.length + 1);
    const twoUpstream = { ...f.input, upstream: [...f.input.upstream, { id: hash("another"), hash: hash("another snapshot") }] };
    assert.equal((await acceptStageSnapshot(twoUpstream)).id,
        (await acceptStageSnapshot({ ...twoUpstream, upstream: [...twoUpstream.upstream].reverse() })).id);
    const newPath = relative(f.input.sharedRoot, join(f.stages, "requirements-r8.json"));
    await writeFile(join(f.input.sharedRoot, newPath), JSON.stringify(f.snapshot(8)));
    const latest = await acceptStageSnapshot({ ...f.input, snapshotPath: newPath });
    assert.notEqual(latest.id, original.id);
    assert.deepEqual(await acceptStageSnapshot(f.input), original);
    for (const record of [original, latest]) {
        const exported = await exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record);
        assert.equal(exported.snapshotPath, record.snapshotPath);
        assert.deepEqual(await readFile(join(f.input.workspaceRoot, exported.exportPath!, "snapshot.json")),
            await readFile(join(f.input.sharedRoot, record.snapshotPath)));
    }
});

test("delivery reads snapshot.json from a workspace-relative export directory without changing source fingerprints", async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.input.workspaceRoot, "source.ts"), "export const value = 1;\n");
    const fingerprint = await fingerprintWorkspace(f.input.workspaceRoot);
    const record = await acceptStageSnapshot(f.input);
    const exported = await exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record);
    assert.ok(exported.exportPath);
    assert.equal(isAbsolute(exported.exportPath), false);
    const directory = join(f.input.workspaceRoot, exported.exportPath);
    assert.ok((await lstat(directory)).isDirectory());
    const snapshot = await readFile(join(directory, "snapshot.json"));
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    assert.deepEqual(snapshot, f.bytes);
    assert.equal(JSON.parse(snapshot.toString("utf8")).result.goal, f.snapshot().result.goal);
    assert.equal(manifest.acceptance.exportPath, exported.exportPath);
    assert.equal(manifest.snapshot.hash, createHash("sha256").update(snapshot).digest("hex"));
    assert.deepEqual(exported.producer, f.input.producer);
    assert.equal(exported.snapshotPath, f.input.snapshotPath);
    assert.equal(await fingerprintWorkspace(f.input.workspaceRoot), fingerprint);
});

test("snapshot formatting is hashed without JSON canonicalization and changes require a new acceptance", async (t) => {
    const f = await fixture(t);
    const original = await acceptStageSnapshot(f.input);
    await writeFile(f.sourcePath, JSON.stringify(f.snapshot()));
    await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", original),
        { code: "acceptance_integrity" });
    const changed = await acceptStageSnapshot(f.input);
    assert.notEqual(changed.snapshotHash, original.snapshotHash);
    assert.notEqual(changed.id, original.id);
    assert.deepEqual(await readFile(join(f.acceptedPath(original), "snapshot.json")), f.bytes);
});

test("exports use safe collision-free Markdown names and portable provenance without filesystem roots", async (t) => {
    const f = await fixture(t);
    const title = '../../CON <script>alert("x")</script>\n# [link](file:///private)';
    const artifacts = [
        artifact({ id: "../../outside", title, path: "C:\\private\\credentials.txt" }),
        artifact({ id: "second", title }),
        artifact({ id: "upper", title: "README" }),
        artifact({ id: "code", title: "Code", content: "const x = `value`; // ```", language: "typescript", mermaid: "graph TD; A-->B" }),
        artifact({ id: "other-stage", stage: "design", content: "Not accepted in Requirements" }),
    ];
    await writeFile(f.sourcePath, JSON.stringify(f.snapshot(7, "requirements", artifacts)));
    const record = await acceptStageSnapshot(f.input);
    assert.equal(record.artifactHashes.length, 4);
    const exported = await exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record);
    assert.equal(exported.exportPath, `tandem-records/example/${record.id}`);
    assert.equal(record.exportPath, null);
    assert.equal(exported.snapshotPath, f.input.snapshotPath);
    const directory = join(f.input.workspaceRoot, exported.exportPath!);
    const names = await readdir(directory);
    const documents = names.filter((name) => /^\d+/.test(name));
    assert.equal(documents.length, 4);
    assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
    for (const name of documents) assert.match(name, /^\d{3}-[a-z0-9-]+\.md$/);
    const markdown = await readFile(join(directory, documents[0]), "utf8");
    assert.ok(markdown.includes("&lt;script&gt;"));
    assert.ok(!markdown.includes("\n# [link]"));
    assert.ok(!markdown.includes("<script>"));
    assert.ok(markdown.includes(artifacts[0].content));
    const code = await readFile(join(directory, documents[3]), "utf8");
    assert.ok(code.includes("````typescript\n"));
    assert.ok(code.includes("```mermaid\n"));
    const manifestBytes = await readFile(join(directory, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.acceptance.snapshotPath, f.input.snapshotPath.replace(/\\/g, "/"));
    assert.deepEqual(manifest.acceptance.source, record.source);
    assert.deepEqual(manifest.acceptance.acceptedBy, record.acceptedBy);
    assert.deepEqual(manifest.acceptance.upstream, record.upstream);
    assert.equal(manifest.acceptanceHash, executionDigest(manifest.acceptance));
    assert.equal(manifest.snapshot.path, "snapshot.json");
    for (const entry of manifest.artifactFiles) {
        assert.equal(entry.fileHash, createHash("sha256").update(await readFile(join(directory, entry.path))).digest("hex"));
    }
    assert.ok(!manifestBytes.includes("credentials"));
    for (const path of [f.root, f.input.workspaceRoot, f.input.sharedRoot]) {
        assert.ok(!manifestBytes.includes(path.replace(/\\/g, "\\\\")));
        assert.ok(!manifestBytes.includes(path.replace(/\\/g, "/")));
    }
    assert.match(await readFile(join(directory, "README.md"), "utf8"), /not authenticated code-owner approval/);
    assert.deepEqual(await readdir(f.input.workspaceRoot), ["tandem-records"]);
});

test("tampered archive bytes and manifest metadata are rejected, never repaired or exported", async (t) => {
    for (const target of ["snapshot.json", "manifest.json"]) {
        await t.test(target, async (t) => {
            const f = await fixture(t);
            const record = await acceptStageSnapshot(f.input);
            const path = join(f.acceptedPath(record), target);
            const original = await readFile(path, "utf8");
            const tampered = target === "snapshot.json" ? original.replace("safe explicit", "tampered")
                : original.replace("Reviewer", "Imposter");
            await writeFile(path, tampered);
            await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record), projectError);
            await assert.rejects(acceptStageSnapshot(f.input), projectError);
            assert.equal(await readFile(path, "utf8"), tampered);
            assert.deepEqual(await readdir(f.input.workspaceRoot), []);
        });
    }
});

test("saved timestamp or metadata changes are rejected even with a recomputed manifest hash", async (t) => {
    const f = await fixture(t);
    const record = await acceptStageSnapshot(f.input);
    const supplied = { ...record, acceptedAt: "2026-09-08T05:01:00.000Z" };
    await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", supplied),
        { code: "acceptance_integrity" });
    const path = join(f.acceptedPath(record), "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.acceptance.acceptedAt = supplied.acceptedAt;
    manifest.acceptanceHash = executionDigest(manifest.acceptance);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record),
        { code: "acceptance_integrity" });
});

test("conflicting export files, extra files, and empty destinations are preserved", async (t) => {
    for (const conflict of ["changed", "extra", "empty"]) {
        await t.test(conflict, async (t) => {
            const f = await fixture(t);
            const record = await acceptStageSnapshot(f.input);
            const directory = join(f.input.workspaceRoot, "tandem-records", "example", record.id);
            if (conflict === "empty") await mkdir(directory, { recursive: true });
            else {
                await exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record);
                await writeFile(join(directory, conflict === "extra" ? "unrelated.txt" : "001-requirements.md"), "preserve me");
            }
            const before = await readdir(directory);
            await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record), projectError);
            assert.deepEqual(await readdir(directory), before);
            if (conflict !== "empty") assert.equal(await readFile(join(directory,
                conflict === "extra" ? "unrelated.txt" : "001-requirements.md"), "utf8"), "preserve me");
        });
    }
});

test("snapshot identity, version, revision, stage, shape, and path traversal are rejected", async (t) => {
    const f = await fixture(t);
    const invalidPaths = [
        f.sourcePath, "../requirements-r7.json", ".tandem/efforts/other/stages/requirements-r7.json",
        ".tandem/efforts/example/stages/../stages/requirements-r7.json",
        ".tandem/efforts/example/stages/design-r7.json", ".tandem/efforts/example/state.json",
        ".tandem/efforts/example/stages/requirements-r7.json:stream",
        ".tandem/efforts/example/stages/requirements-r07.json",
        ".tandem/efforts/example/stages/requirements-r9007199254740992.json",
        "\\\\server\\share\\requirements-r7.json", "C:requirements-r7.json",
    ];
    for (const snapshotPath of invalidPaths) await assert.rejects(acceptStageSnapshot({ ...f.input, snapshotPath }), projectError);
    for (const effortId of ["..", "EXAMPLE", "example.", "con", "example/../other"]) {
        await assert.rejects(acceptStageSnapshot({ ...f.input, effortId }), projectError);
    }
    for (const change of [
        { version: 2 }, { prototypeId: "other" }, { stageId: "design" }, { revision: 8 },
        { completedAt: "yesterday" }, { result: { goal: "bad", artifacts: "not a list" } },
        { result: { goal: "bad", artifacts: [artifact(), artifact()] } },
    ]) {
        await writeFile(f.sourcePath, JSON.stringify({ ...f.snapshot(), ...change }));
        await assert.rejects(acceptStageSnapshot(f.input), projectError);
    }
    await writeFile(f.sourcePath, "{broken");
    await assert.rejects(acceptStageSnapshot(f.input), { code: "acceptance_corrupt" });
    await writeFile(f.sourcePath, Buffer.concat([Buffer.from('{"invalid":"'), Buffer.from([0xff]), Buffer.from('"}')]));
    await assert.rejects(acceptStageSnapshot(f.input), { code: "acceptance_corrupt" });
    await writeFile(f.sourcePath, Buffer.alloc(64 * 1024 * 1024 + 1));
    await assert.rejects(acceptStageSnapshot(f.input), { code: "acceptance_invalid" });
});

test("preparation snapshots without artifacts and legacy unrevisioned stage filenames remain supported", async (t) => {
    const f = await fixture(t);
    const prepare = { ...f.snapshot(2, "prepare"), result: { goal: "Prepare workspace", preparation: { status: "ready" } } };
    const snapshotPath = relative(f.input.sharedRoot, join(f.stages, "prepare-r2.json"));
    await writeFile(join(f.input.sharedRoot, snapshotPath), JSON.stringify(prepare));
    const record = await acceptStageSnapshot({ ...f.input, snapshotPath, stageId: "prepare" });
    assert.deepEqual(record.artifactHashes, []);
    await exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record);
    const legacyPath = relative(f.input.sharedRoot, join(f.stages, "requirements.json"));
    const { revision: _revision, ...legacy } = f.snapshot();
    await writeFile(join(f.input.sharedRoot, legacyPath), JSON.stringify(legacy));
    await acceptStageSnapshot({ ...f.input, snapshotPath: legacyPath });
});

test("strict record normalization rejects corruption, overflows, duplicates and unexpected fields", async (t) => {
    const f = await fixture(t);
    const record = await acceptStageSnapshot(f.input);
    assert.deepEqual(validateAcceptanceRecords(undefined), []);
    const normalized = validateAcceptanceRecords([record]);
    normalized[0].acceptedBy.label = "Separate object";
    assert.equal(record.acceptedBy.label, "Reviewer");
    const corrupt: unknown[] = [
        null, {}, [null], [record, record], Array(1001).fill(record), new Array(1),
        [{ ...record, unknown: "not silently dropped" }], [{ ...record, id: "arbitrary" }],
        [{ ...record, snapshotHash: hash("wrong") }], [{ ...record, exportPath: "../escape" }],
        [{ ...record, acceptedAt: "invalid" }], [{ ...record, acceptedBy: { ...record.acceptedBy, label: "" } }],
        [{ ...record, acceptedBy: { ...record.acceptedBy, sessionId: "/private/secret" } }],
        [{ ...record, source: { ...record.source, commit: "HEAD" } }],
        [{ ...record, producer: { ...record.producer, version: "../private" } }],
        [{ ...record, upstream: [...record.upstream, ...record.upstream] }],
        [{ ...record, upstream: Array(101).fill(record.upstream[0]) }],
        [{ ...record, artifactHashes: [...record.artifactHashes, ...record.artifactHashes] }],
        [{ ...record, acceptedBy: { ...record.acceptedBy, label: "x".repeat(201) } }],
    ];
    for (const value of corrupt) assert.throws(() => validateAcceptanceRecords(value), projectError);
    await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "other", record), projectError);
});

async function directoryLink(target: string, path: string): Promise<void> {
    await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
    assert.ok((await lstat(path)).isSymbolicLink());
}

test("symlink or junction traversal through snapshot, acceptance, export and root parents is refused", async (t) => {
    for (const location of ["stages", "accepted", "archive", "export", "bundle", "lock", "shared-root", "workspace-root", "ancestor"]) {
        await t.test(location, async (t) => {
            const f = await fixture(t);
            const outside = join(f.root, "outside");
            await mkdir(outside);
            const marker = join(outside, "marker.txt");
            await writeFile(marker, "untouched");
            if (location === "stages") {
                await rm(f.sourcePath);
                await rm(f.stages, { recursive: true });
                await writeFile(join(outside, "requirements-r7.json"), f.bytes);
                await directoryLink(outside, f.stages);
                await assert.rejects(acceptStageSnapshot(f.input), { code: "acceptance_path_unsafe" });
            } else if (location === "accepted") {
                await directoryLink(outside, join(f.input.sharedRoot, ".tandem", "efforts", "example", "accepted"));
                await assert.rejects(acceptStageSnapshot(f.input), { code: "acceptance_path_unsafe" });
            } else if (location === "shared-root" || location === "workspace-root" || location === "ancestor") {
                const alias = join(f.root, "alias");
                const key = location === "workspace-root" ? "workspaceRoot" : "sharedRoot";
                await directoryLink(location === "ancestor" ? f.root : f.input[key], alias);
                const root = location === "ancestor" ? join(alias, "shared") : alias;
                await assert.rejects(acceptStageSnapshot({ ...f.input, [key]: root }), { code: "acceptance_path_unsafe" });
            } else {
                const record = await acceptStageSnapshot(f.input);
                if (location === "export") await directoryLink(outside, join(f.input.workspaceRoot, "tandem-records"));
                else if (location === "archive") {
                    await rm(f.acceptedPath(record), { recursive: true });
                    await directoryLink(outside, f.acceptedPath(record));
                } else if (location === "lock") {
                    await directoryLink(outside, join(f.input.sharedRoot, ".tandem", "efforts", "example", "accepted", `.${record.id}.lock`));
                } else {
                    const parent = join(f.input.workspaceRoot, "tandem-records", "example");
                    await mkdir(parent, { recursive: true });
                    await directoryLink(outside, join(parent, record.id));
                }
                await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record),
                    { code: "acceptance_path_unsafe" });
            }
            assert.equal(await readFile(marker, "utf8"), "untouched");
            assert.deepEqual((await readdir(outside)).sort(),
                location === "stages" ? ["marker.txt", "requirements-r7.json"] : ["marker.txt"]);
        });
    }
});

test("hard-linked files and incomplete accepted directories cannot be reused or overwritten", async (t) => {
    const f = await fixture(t);
    const record = await acceptStageSnapshot(f.input);
    const manifestPath = join(f.acceptedPath(record), "manifest.json");
    const bytes = await readFile(manifestPath);
    const hardLink = join(f.root, "manifest-hard-link.json");
    await link(manifestPath, hardLink);
    await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record),
        { code: "acceptance_path_unsafe" });
    assert.deepEqual(await readFile(hardLink), bytes);
    await rm(hardLink);
    await rm(manifestPath);
    await assert.rejects(acceptStageSnapshot(f.input), projectError);
    await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record), projectError);
    assert.deepEqual(await readdir(f.acceptedPath(record)), ["snapshot.json"]);
    assert.deepEqual(await readFile(join(f.acceptedPath(record), "snapshot.json")), f.bytes);
    assert.deepEqual(await readdir(f.input.workspaceRoot), []);
});

test("file symlinks cannot redirect snapshot or manifest reads", async (t) => {
    const f = await fixture(t);
    const probe = join(f.root, "link-probe");
    try { await symlink(f.sourcePath, probe, "file"); }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EPERM" && process.platform === "win32") {
            t.skip("File symlinks require Windows developer mode or symlink privilege; junction coverage remains active.");
            return;
        }
        throw error;
    }
    await rm(probe);
    const record = await acceptStageSnapshot(f.input);
    const manifest = join(f.acceptedPath(record), "manifest.json");
    const outside = join(f.root, "original-manifest.json");
    await writeFile(outside, await readFile(manifest));
    await rm(manifest);
    await symlink(outside, manifest, "file");
    await assert.rejects(exportAcceptedSnapshot(f.input.workspaceRoot, f.input.sharedRoot, "example", record),
        { code: "acceptance_path_unsafe" });
    const sourceCopy = join(f.root, "source-copy.json");
    await writeFile(sourceCopy, f.bytes);
    await rm(f.sourcePath);
    await symlink(sourceCopy, f.sourcePath, "file");
    await assert.rejects(acceptStageSnapshot(f.input), { code: "acceptance_path_unsafe" });
});

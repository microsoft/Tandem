import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { executionDigest, fingerprintWorkspace } from "../src/execution.js";
import {
    assertChangedPathsOwned, assertContractSkillsCurrent, buildWorkerContract, captureWorkspaceFiles,
    changedWorkspacePaths, contractInstruction, normalizeWorkerContracts,
} from "../src/worker-contracts.js";

async function fixture(t: TestContext) {
    const directory = join(process.cwd(), ".tandem", `worker-contract-tests-${randomUUID()}`);
    const workspace = join(directory, "workspace");
    await mkdir(workspace, { recursive: true });
    t.after(() => rm(directory, { recursive: true, force: true }));
    return { directory, workspace };
}

async function install(root: string, name: string, content: string | Buffer) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, "SKILL.md"), content);
}

const item = { id: "implement", files: ["src\\Feature.ts", "src\\feature.ts"], skills: ["test-skill"] };
const acceptedInputs = [{ id: "requirements", hash: "a".repeat(64) }];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("worker contracts bind exact installed skill bytes, normalized ownership, inputs, and instruction text", async (t) => {
    const { workspace } = await fixture(t);
    const root = join(workspace, ".github", "skills");
    const content = "\uFEFF---\r\nname: test-skill\r\n---\r\n# Instructions\r\nPreserve café and 中文.\r\n";
    await install(root, "test-skill", content);
    const input = { workspaceRoot: workspace, item, inputRevision: "approved-input", acceptedInputs, skillRoots: [root] };
    const contract = await buildWorkerContract(input);
    assert.equal(contract.version, 1);
    assert.equal(contract.itemId, item.id);
    assert.equal(contract.inputRevision, input.inputRevision);
    assert.deepEqual(contract.ownedPaths, ["src\\feature.ts"]);
    assert.deepEqual(contract.acceptedInputs, acceptedInputs);
    assert.notEqual(contract.acceptedInputs, acceptedInputs);
    assert.deepEqual(contract.skills, [{
        name: "test-skill", path: "project:.github/skills/test-skill/SKILL.md", hash: hash(content), content,
    }]);
    assert.equal(contract.enforcement, "host-permissions-and-postflight");
    assert.equal((await buildWorkerContract(input)).id, contract.id);
    assert.deepEqual(normalizeWorkerContracts([contract]), [contract]);
    await assertContractSkillsCurrent(contract, workspace, [root]);
    const prompt = contractInstruction(contract);
    assert.ok(prompt.includes(content));
    assert.ok(prompt.includes(acceptedInputs[0].hash));
    assert.ok(prompt.includes(JSON.stringify(contract.ownedPaths)));
    assert.match(prompt, /advisory/);
    assert.match(prompt, /does not.*enforced filesystem\/process isolation/);
    assert.match(prompt, /Do not create git commits, push, publish, or deploy/);
    assert.match(prompt, /not tool-backed verification evidence/);
    assert.match(prompt, /union of wave-owned scopes, not attributed to individual workers/);
    assert.ok(!JSON.stringify(contract).includes(workspace));
});

test("skill resolution uses documented project-first and explicit-root precedence", async (t) => {
    const { workspace, directory } = await fixture(t);
    const projectRoot = join(workspace, ".github", "skills");
    const bundledRoot = join(workspace, "skills");
    const installedRoot = join(directory, "installed-skills");
    await install(projectRoot, "test-skill", "project instructions");
    await install(bundledRoot, "test-skill", "bundled instructions");
    await install(installedRoot, "test-skill", "user instructions");
    const input = { workspaceRoot: workspace, item, inputRevision: "input", acceptedInputs: [] };
    const project = await buildWorkerContract(input);
    assert.equal(project.skills[0].content, "project instructions");
    await rm(projectRoot, { recursive: true });
    const bundled = await buildWorkerContract(input);
    assert.equal(bundled.skills[0].content, "bundled instructions");
    assert.equal(bundled.skills[0].path, "project:skills/test-skill/SKILL.md");
    const overridden = await buildWorkerContract({ ...input, skillRoots: [installedRoot, bundledRoot] });
    assert.equal(overridden.skills[0].content, "user instructions");
    assert.equal(overridden.skills[0].path, "installed:0/test-skill/SKILL.md");
    assert.ok(!JSON.stringify(overridden).includes(installedRoot));
    await assertContractSkillsCurrent(overridden, workspace, [installedRoot, bundledRoot]);
});

test("an empty skill list is valid and repeated requested skills are bound only once", async (t) => {
    const { workspace } = await fixture(t);
    const input = { workspaceRoot: workspace, item: { ...item, files: [], skills: [] },
        inputRevision: "input", acceptedInputs: [], skillRoots: [] };
    assert.deepEqual((await buildWorkerContract(input)).skills, []);
    const root = join(workspace, "skills");
    await install(root, "test-skill", "one");
    const contract = await buildWorkerContract({ ...input,
        item: { ...item, skills: ["test-skill", "test-skill"] }, skillRoots: [root] });
    assert.equal(contract.skills.length, 1);
});

test("COPILOT_HOME installed skills use a portable user scope", async (t) => {
    const { workspace, directory } = await fixture(t);
    const previousHome = process.env.COPILOT_HOME;
    try {
        process.env.COPILOT_HOME = join(directory, "copilot");
        await install(join(process.env.COPILOT_HOME, "skills"), "test-skill", "user instructions");
        const contract = await buildWorkerContract({ workspaceRoot: workspace, item,
            inputRevision: "input", acceptedInputs: [] });
        assert.equal(contract.skills[0].path, "user:test-skill/SKILL.md");
        await assertContractSkillsCurrent(contract, workspace);
    } finally {
        if (previousHome === undefined) delete process.env.COPILOT_HOME;
        else process.env.COPILOT_HOME = previousHome;
    }
});

test("explicit project skill roots remain portable when their names contain spaces", async (t) => {
    const { workspace } = await fixture(t);
    const root = join(workspace, "installed skills");
    await install(root, "test-skill", "instructions");
    const contract = await buildWorkerContract({ workspaceRoot: workspace, item,
        inputRevision: "input", acceptedInputs: [], skillRoots: [root] });
    assert.equal(contract.skills[0].path, "project:installed skills/test-skill/SKILL.md");
    await assertContractSkillsCurrent(contract, workspace, [root]);
});

test("missing and unsafe skill names and escaping ownership are rejected", async (t) => {
    const { workspace } = await fixture(t);
    const input = { workspaceRoot: workspace, item, inputRevision: "input", acceptedInputs: [], skillRoots: [] };
    await assert.rejects(buildWorkerContract(input), /Installed skill.*not found/);
    for (const name of ["../escape", "..\\escape", "C:\\skill", "foo/bar", "foo\\bar", ".", "foo:bar", "bad name", "UPPER", "", "con", "lpt1"]) {
        await assert.rejects(buildWorkerContract({ ...input, item: { ...item, skills: [name] } }), /simple lowercase slugs/);
    }
    for (const path of ["..\\escape.ts", "C:\\escape.ts"]) {
        await assert.rejects(buildWorkerContract({ ...input, item: { ...item, files: [path], skills: [] } }),
            /escape|workspace-relative/);
    }
});

test("changed, removed, or newly shadowed skills fence retries", async (t) => {
    const { workspace } = await fixture(t);
    const root = join(workspace, "skills");
    await install(root, "test-skill", "original");
    const input = { workspaceRoot: workspace, item, inputRevision: "input", acceptedInputs: [] };
    const contract = await buildWorkerContract(input);
    await install(root, "test-skill", "modified");
    await assert.rejects(assertContractSkillsCurrent(contract, workspace), /changed.*rebuild/);
    await install(root, "test-skill", "original");
    await install(join(workspace, ".github", "skills"), "test-skill", "original");
    await assert.rejects(assertContractSkillsCurrent(contract, workspace), /changed.*rebuild/);
    await rm(join(workspace, ".github"), { recursive: true });
    await rm(root, { recursive: true });
    await assert.rejects(assertContractSkillsCurrent(contract, workspace, [root]), /not found/);
});

test("skill files are bounded at 64 KiB and invalid UTF-8 is not silently rehashed", async (t) => {
    const { workspace } = await fixture(t);
    const root = join(workspace, "skills");
    const input = { workspaceRoot: workspace, item, inputRevision: "input", acceptedInputs: [], skillRoots: [root] };
    await install(root, "test-skill", "a".repeat(64 * 1024));
    assert.equal((await buildWorkerContract(input)).skills[0].content.length, 64 * 1024);
    await install(root, "test-skill", "a".repeat(64 * 1024 + 1));
    await assert.rejects(buildWorkerContract(input), /64 KiB/);
    await install(root, "test-skill", Buffer.from([0xff, 0xfe]));
    await assert.rejects(buildWorkerContract(input), /encoded data|encoding/i);
});

test("building and loading contracts enforce the combined 128 KiB UTF-8 skill budget", async (t) => {
    const { workspace } = await fixture(t);
    const root = join(workspace, "skills");
    const content = "\u00e9".repeat(32 * 1024);
    await install(root, "first-skill", content);
    await install(root, "second-skill", content);
    await install(root, "third-skill", "x");
    const input = { workspaceRoot: workspace,
        item: { ...item, skills: ["first-skill", "second-skill"] },
        inputRevision: "input", acceptedInputs: [], skillRoots: [root] };
    const contract = await buildWorkerContract(input);
    assert.equal(contract.skills.reduce((size, skill) => size + Buffer.byteLength(skill.content), 0), 128 * 1024);
    assert.deepEqual(normalizeWorkerContracts([contract]), [contract]);
    await assert.rejects(buildWorkerContract({ ...input,
        item: { ...item, skills: [...input.item.skills, "third-skill"] } }), /128 KiB limit per worker/);
    const { id, ...body } = contract;
    const oversized = { ...body, skills: [...body.skills, {
        name: "third-skill", path: "project:skills/third-skill/SKILL.md", hash: hash("x"), content: "x",
    }] };
    assert.notEqual(executionDigest(oversized), id);
    assert.throws(() => normalizeWorkerContracts([{ ...oversized, id: executionDigest(oversized) }]), /128 KiB limit per worker/);
});

test("linked skill directories, roots, and ancestor traversal are rejected", async (t) => {
    const { workspace, directory } = await fixture(t);
    const root = join(workspace, "skills");
    const outside = join(directory, "outside");
    await install(outside, "test-skill", "outside instructions");
    await mkdir(root, { recursive: true });
    await symlink(join(outside, "test-skill"), join(root, "test-skill"), process.platform === "win32" ? "junction" : "dir");
    const input = { workspaceRoot: workspace, item, inputRevision: "input", acceptedInputs: [], skillRoots: [root] };
    await assert.rejects(buildWorkerContract(input), /Linked skill directory/);
    const linkedRoot = join(workspace, "linked");
    await symlink(outside, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(buildWorkerContract({ ...input, skillRoots: [linkedRoot] }), /Linked skill roots/);
    await mkdir(join(outside, "nested"), { recursive: true });
    await install(join(outside, "nested"), "test-skill", "nested");
    await assert.rejects(buildWorkerContract({ ...input, skillRoots: [join(linkedRoot, "nested")] }), /Linked skill roots/);
});

test("a linked SKILL.md cannot import instructions from outside its installed root", async (t) => {
    const { workspace, directory } = await fixture(t);
    const root = join(workspace, "skills");
    await mkdir(join(root, "test-skill"), { recursive: true });
    const outsideFile = join(directory, "outside.md");
    await writeFile(outsideFile, "outside instructions");
    try {
        await symlink(outsideFile, join(root, "test-skill", "SKILL.md"), "file");
    } catch (error) {
        if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
            t.skip("Creating a Windows file symlink requires developer mode or elevated permissions.");
            return;
        }
        throw error;
    }
    await assert.rejects(buildWorkerContract({ workspaceRoot: workspace, item,
        inputRevision: "input", acceptedInputs: [], skillRoots: [root] }), /Linked SKILL.md/);
});

test("stored contracts reject tampered contents instead of accepting model-provided replacements", async (t) => {
    const { workspace } = await fixture(t);
    const root = join(workspace, "skills");
    await install(root, "test-skill", "original");
    const contract = await buildWorkerContract({ workspaceRoot: workspace, item,
        inputRevision: "input", acceptedInputs, skillRoots: [root] });
    assert.throws(() => normalizeWorkerContracts([{ ...contract, skills: [{ ...contract.skills[0], content: "altered" }] }]),
        /content, or hash/);
    assert.throws(() => normalizeWorkerContracts([{ ...contract, inputRevision: "other" }]), /hash does not match/);
    assert.throws(() => normalizeWorkerContracts([{ ...contract, ownedPaths: ["..\\escape"] }]), /escape/);
    assert.deepEqual(normalizeWorkerContracts(undefined), []);
});

test("contract normalization accepts at most 30 records and rejects malformed shapes without dropping entries", async (t) => {
    const { workspace } = await fixture(t);
    const root = join(workspace, "skills");
    await install(root, "test-skill", "instructions");
    const contract = await buildWorkerContract({ workspaceRoot: workspace, item,
        inputRevision: "input", acceptedInputs, skillRoots: [root] });
    const maximum = Array.from({ length: 30 }, () => contract);
    assert.deepEqual(normalizeWorkerContracts(maximum), maximum);
    assert.throws(() => normalizeWorkerContracts([...maximum, contract]), /at most 30/);
    assert.deepEqual(normalizeWorkerContracts([]), []);
    for (const value of [
        null, false, "", {}, [null], [contract, null], new Array(1),
        [{ ...contract, ignored: true }],
        [{ ...contract, version: "1" }],
        [{ ...contract, ownedPaths: new Array(1) }],
        [{ ...contract, skills: new Array(1) }],
        [{ ...contract, skills: [{ ...contract.skills[0], ignored: true }] }],
        [{ ...contract, skills: [null] }],
        [{ ...contract, acceptedInputs: new Array(1) }],
        [{ ...contract, acceptedInputs: [{ ...acceptedInputs[0], ignored: true }] }],
        [{ ...contract, acceptedInputs: [{ ...acceptedInputs[0], hash: 123 }] }],
    ]) {
        assert.throws(() => normalizeWorkerContracts(value));
    }
    for (const field of Object.keys(contract)) {
        const missing: Record<string, unknown> = { ...contract };
        delete missing[field];
        assert.throws(() => normalizeWorkerContracts([missing]), /Invalid stored worker contract/);
    }
});

test("workspace snapshots hash current file bytes and detect additions, edits, deletions, and renames", async (t) => {
    const { workspace } = await fixture(t);
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src", "changed.ts"), "initial bytes");
    await writeFile(join(workspace, "src", "removed.ts"), "removed bytes");
    await writeFile(join(workspace, "src", "old-name.ts"), "renamed bytes");
    await writeFile(join(workspace, "unchanged.txt"), "unchanged bytes");
    const before = await captureWorkspaceFiles(workspace);
    assert.deepEqual(before, {
        "src\\changed.ts": hash("initial bytes"),
        "src\\old-name.ts": hash("renamed bytes"),
        "src\\removed.ts": hash("removed bytes"),
        "unchanged.txt": hash("unchanged bytes"),
    });
    await writeFile(join(workspace, "src", "changed.ts"), "dirty bytes");
    await writeFile(join(workspace, "src", "untracked.ts"), "untracked bytes");
    await rm(join(workspace, "src", "removed.ts"));
    await rename(join(workspace, "src", "old-name.ts"), join(workspace, "src", "new-name.ts"));
    const after = await captureWorkspaceFiles(workspace);
    assert.equal(after["src\\changed.ts"], hash("dirty bytes"));
    assert.equal(after["src\\untracked.ts"], hash("untracked bytes"));
    assert.deepEqual(changedWorkspacePaths(before, after), [
        "src\\changed.ts", "src\\new-name.ts", "src\\old-name.ts", "src\\removed.ts", "src\\untracked.ts",
    ]);
    assert.deepEqual(changedWorkspacePaths(after, after), []);
    assert.doesNotThrow(() => assertChangedPathsOwned(before, after, ["SRC/"]));
    assert.throws(() => assertChangedPathsOwned(before, after, ["src\\changed.ts"]),
        /Postflight.*outside the wave-owned scopes.*src.*removed\.ts/);
});

test("snapshot exclusions match fingerprintWorkspace, while nested outputs and gitignored source files remain visible", async (t) => {
    const { workspace } = await fixture(t);
    await mkdir(join(workspace, "src", "dist"), { recursive: true });
    await writeFile(join(workspace, "src", "dist", "included.ts"), "nested output name is source");
    await writeFile(join(workspace, ".gitignore"), "gitignored.txt\n");
    await writeFile(join(workspace, "gitignored.txt"), "included even when gitignored");
    const baseline = await captureWorkspaceFiles(workspace);
    const fingerprint = await fingerprintWorkspace(workspace);
    for (const name of [".git", ".tandem", "node_modules", ".next", ".nuxt", ".cache"]) {
        for (const directory of [join(workspace, name.toUpperCase()), join(workspace, "src", name)]) {
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, "ignored.txt"), "excluded bytes");
        }
    }
    for (const name of ["dist", "build", "out", "coverage", "generated", "tandem-records"]) {
        await mkdir(join(workspace, name.toUpperCase()), { recursive: true });
        await writeFile(join(workspace, name.toUpperCase(), "ignored.txt"), "excluded bytes");
    }
    await writeFile(join(workspace, "cache.TSBUILDINFO"), "excluded cache");
    await writeFile(join(workspace, "src", "cache.tsbuildinfo"), "excluded nested cache");
    assert.deepEqual(await captureWorkspaceFiles(workspace), baseline);
    assert.equal(await fingerprintWorkspace(workspace), fingerprint);
    assert.equal(baseline["gitignored.txt"], hash("included even when gitignored"));
    assert.equal(baseline["src\\dist\\included.ts"], hash("nested output name is source"));
    await writeFile(join(workspace, "src", "dist", "included.ts"), "changed source");
    assert.deepEqual(changedWorkspacePaths(baseline, await captureWorkspaceFiles(workspace)), ["src\\dist\\included.ts"]);
    assert.notEqual(await fingerprintWorkspace(workspace), fingerprint);
});

test("wave postflight checks use unioned ownership and fence unowned additions and deletions", async (t) => {
    const { workspace } = await fixture(t);
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "tests"), { recursive: true });
    await writeFile(join(workspace, "protected.txt"), "protected bytes");
    const before = await captureWorkspaceFiles(workspace);
    await writeFile(join(workspace, "src", "implementation.ts"), "implementation");
    await writeFile(join(workspace, "tests", "verification.ts"), "verification");
    const after = await captureWorkspaceFiles(workspace);
    assert.doesNotThrow(() => assertChangedPathsOwned(before, after, ["src", "tests"]));
    assert.throws(() => assertChangedPathsOwned(before, after, ["src"]), /tests.*verification\.ts/);
    assert.throws(() => assertChangedPathsOwned(before, after, ["tests"]), /src.*implementation\.ts/);
    await rm(join(workspace, "protected.txt"));
    const deleted = await captureWorkspaceFiles(workspace);
    assert.throws(() => assertChangedPathsOwned(before, deleted, ["src", "tests"]),
        /protected\.txt.*cannot be attributed to an individual worker/);
    assert.doesNotThrow(() => assertChangedPathsOwned(before, deleted, ["*"]));
    assert.doesNotThrow(() => assertChangedPathsOwned(before, deleted, []));
    assert.throws(() => assertChangedPathsOwned(before, before, ["..\\outside"]), /escape/);
});

test("workspace snapshots reject source links, linked roots, and linked ancestors", async (t) => {
    const { workspace, directory } = await fixture(t);
    const outside = join(directory, "outside");
    await mkdir(join(outside, "nested"), { recursive: true });
    await writeFile(join(outside, "nested", "source.ts"), "outside bytes");
    const link = join(workspace, "linked");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(captureWorkspaceFiles(workspace), /Cannot capture linked source/);
    await assert.rejects(captureWorkspaceFiles(link), /Cannot capture linked source/);
    await assert.rejects(captureWorkspaceFiles(join(link, "nested")), /Cannot capture linked source/);
    await assert.rejects(captureWorkspaceFiles(join(outside, "nested", "source.ts")), /requires a directory/);
});

test("snapshot diff handles special object keys and rejects malformed hash maps", async (t) => {
    const { workspace } = await fixture(t);
    await writeFile(join(workspace, "__proto__"), "actual file");
    const snapshot = await captureWorkspaceFiles(workspace);
    assert.equal(Object.hasOwn(snapshot, "__proto__"), true);
    assert.deepEqual(changedWorkspacePaths({}, snapshot), ["__proto__"]);
    assert.deepEqual(changedWorkspacePaths(snapshot, {}), ["__proto__"]);
    assert.doesNotThrow(() => assertChangedPathsOwned({}, snapshot, ["__proto__"]));
    assert.throws(() => changedWorkspacePaths({}, { "source.ts": "not-a-sha256" }), /SHA-256 hashes/);
});

import assert from "node:assert/strict";

import { randomUUID } from "node:crypto";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { createRequire } from "node:module";

import { join, resolve } from "node:path";

import { test } from "node:test";

import { runInNewContext } from "node:vm";

import { build } from "esbuild";

import {
    assertExecutionRequest, executionDigest, executionToken, fingerprintWorkspace,
    newExecution, workerOutcome,
} from "../src/execution.js";

import { executionGraph, ownershipConflicts } from "../src/scheduling.js";

import { hasActiveWork } from "../src/workflow.js";

import { createProcessState } from "../src/process-state.js";

import { captureWorkspaceFiles } from "../src/worker-contracts.js";

const work = (id: string, dependencies: string[] = []) => ({ id, dependencies, files: [`src\\${id}.ts`] });
const outcome = (summary: string, testing = false) => ({
    summary, status: testing ? "passed" : "completed", blockers: [],
    validation: [{ requirement: "check", status: "passed", evidence: "Observed expected result" }],
    evidence: ["Observed expected result"],
});

test("execution graphs normalize both ends and reject collisions, missing references, and cycles", () => {
    assert.equal(executionGraph([work("Setup"), work("Feature", ["Setup"])])[1].dependencies[0], "setup");
    assert.throws(() => executionGraph([work("A"), work("a")]), /collide/);
    assert.throws(() => executionGraph([work("a", ["missing"])]), /Invalid dependency/);
    assert.throws(() => executionGraph([work("a", ["b"]), work("b", ["a"])]), /cycle/);
    assert.throws(() => executionGraph(Array.from({ length: 31 }, (_, i) => work(`a${i}`))), /at most 30/);
});

test("Windows ownership includes aliases, directory descendants, unknown scopes, and wildcards", () => {
    for (const [left, right] of [
        [["SRC\\Widget.ts"], ["src/widget.ts"]],
        [["src\\feature"], ["src\\feature\\view.ts"]],
        [[".\\src\\a.ts"], ["src\\a.ts"]],
        [["src\\a.ts. "], ["src\\a.ts"]],
        [[], ["src\\a.ts"]],
        [["src\\*.ts"], ["other\\b.ts"]],
    ]) assert.equal(ownershipConflicts(left, right), true);
    assert.equal(ownershipConflicts(["src\\a.ts"], ["src\\b.ts"]), false);
    assert.throws(() => ownershipConflicts(["..\\escape.ts"], ["a.ts"]), /escape/);
});

test("worker status alone cannot pass validation or conceal blockers", () => {
    assert.equal(workerOutcome(outcome("Verified"), ["check"]).status, "completed");
    for (const invalid of [
        { ...outcome(""), summary: "" }, { ...outcome("Done"), blockers: ["Build unavailable"] },
        { ...outcome("Done"), validation: [] },
        { ...outcome("Done"), validation: [{ requirement: "check", status: "skipped", evidence: "Not executed" }] },
        { ...outcome("Done", true), evidence: [] },
    ]) assert.equal(workerOutcome(invalid, ["check"], invalid.status === "passed").status, "failed");
});

test("source fingerprints cover dirty and untracked files but exclude generated state and output", async () => {
    const f = await fixture();
    try {
        await writeFile(join(f.root, "source.ts"), "one");
        const initial = await fingerprintWorkspace(f.root);
        for (const dir of [".tandem", ".git", "node_modules", "dist", "generated"]) {
            await mkdir(join(f.root, dir));
            await writeFile(join(f.root, dir, "ignored"), "anything");
        }
        assert.equal(await fingerprintWorkspace(f.root), initial);
        await writeFile(join(f.root, "source.ts"), "two");
        const dirty = await fingerprintWorkspace(f.root);
        assert.notEqual(dirty, initial);
        await writeFile(join(f.root, "untracked.ts"), "new source");
        assert.notEqual(await fingerprintWorkspace(f.root), dirty);
        const beforeBuildSource = await fingerprintWorkspace(f.root);
        await mkdir(join(f.root, "src", "build"), { recursive: true });
        await writeFile(join(f.root, "src", "build", "compiler.ts"), "real source, not generated output");
        assert.notEqual(await fingerprintWorkspace(f.root), beforeBuildSource);
    } finally { await f.close(); }
});

test("all durable identity fields participate in execution guards", () => {
    const token = { ...newExecution("revision", process.cwd(), "owner"), runId: "run" };
    assert.doesNotThrow(() => assertExecutionRequest(token, token, "revision", process.cwd(), "owner"));
    for (const key of ["requestId", "inputRevision", "ownerSessionId", "workspaceRoot", "runId", "sourceFingerprint"]) {
        assert.throws(() => assertExecutionRequest({ ...token, [key]: "different" }, token,
            "revision", process.cwd(), "owner"), /no longer active/);
    }
    assert.throws(() => assertExecutionRequest({ ...token, runId: null }, token,
        "revision", process.cwd(), "owner"), /no longer active/);
});
async function fixture() {
    const root = resolve("node_modules", "tandem-test-fixtures", randomUUID());
    await mkdir(root, { recursive: true });
    return { root, close: () => rm(root, { recursive: true, force: true }) };
}

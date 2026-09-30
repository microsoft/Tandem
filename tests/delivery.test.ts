import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { acceptStageSnapshot } from "../src/accepted-artifacts.js";
import { assertDeliveryCurrent, prepareDeliveryDraft } from "../src/delivery.js";
import { fingerprintWorkspace } from "../src/execution.js";
import { createProcessState } from "../src/process-state.js";
import { writeJsonAtomically } from "../src/project-store.js";
import type { TandemState } from "../src/types.js";
import { createProcessAdapters, HANDOFF_BODY_LIMIT_BYTES } from "../src/process-adapters.js";
import { projectDevelopmentDelivery } from "../src/development-delivery.js";
import { createHumanLoop } from "../stage2/tandem/runtime-src/domain/human-loop/model.ts";
import { DEFAULT_POLICY } from "../stage2/tandem/runtime-src/domain/workflow/policy.ts";

const projection = (summary: string) => JSON.stringify({
    schemaVersion: "tandem-development-delivery/v1",
    design: { revisionId: "design-1", digest: "a".repeat(64) },
    source: { id: "snapshot-1", digest: "b".repeat(64) },
    verificationLimits: ["This captured outcome is not a test pass."], summary,
});

test("delivery uses accepted snapshot content and rejects source or acceptance drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-delivery-"));
    try {
        await writeFile(join(root, "app.ts"), "export const value = 1;");
        const path = join(root, ".tandem", "efforts", "delivery", "stages", "development-r2.json");
        await writeJsonAtomically(path, {
            version: 1, prototypeId: "delivery", stageId: "development", revision: 2, completedAt: new Date().toISOString(),
            result: { goal: "Accepted goal", artifacts: [{
                id: "development-outcome", title: "Development outcome", stage: "development", kind: "test-results",
                language: "markdown", content: projection("Accepted evidence"), mermaid: "", path: ".",
            }] },
        });

        const record = await acceptStageSnapshot({
            workspaceRoot: root, sharedRoot: root, effortId: "delivery", stageId: "development",
            snapshotPath: relative(root, path), acceptedBy: { label: "Owner", sessionId: "session" },
            source: { commit: null, fingerprint: await fingerprintWorkspace(root) },
            producer: { version: "1.0.0", configurationHash: "0".repeat(64) }, upstream: [],
        });
        const state = {
            prototypeId: "delivery", goal: "Unaccepted changed text", process: { ...createProcessState(), acceptances: [record] },
            lifecycle: { completedStages: [], outputs: [{ stageId: "development", path: record.snapshotPath }] },
        } as TandemState;
        const prepared = await prepareDeliveryDraft(state, root, root);
        await assert.rejects(access(join(root, "tandem-records")), /ENOENT/, "Preparing a draft is not an export.");
        assert.match(prepared.draft.body, /Accepted goal/);
        assert.match(prepared.draft.body, /Accepted evidence/);
        assert.doesNotMatch(prepared.draft.body, /Unaccepted changed text/);
        state.process.deliveryDraft = prepared.draft;
        await assertDeliveryCurrent(state, root);
        const original = prepared.draft.body;
        state.process.deliveryDraft.body += "\nUnreviewed edit";
        await assert.rejects(assertDeliveryCurrent(state, root), /stale/);
        state.process.deliveryDraft.body = original;
        await writeFile(join(root, "app.ts"), "export const value = 2;");
        await assert.rejects(assertDeliveryCurrent(state, root), /stale/);
        await assert.rejects(prepareDeliveryDraft(state, root, root), /Sources changed/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("development delivery retains native failures and never turns readiness or empty Review into a test pass", () => {
    const state = createHumanLoop({ schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
        privateSessionId: "private", workspacePath: process.cwd(), policy: DEFAULT_POLICY });
    const source = { id: `snapshot-${"a".repeat(64)}`, digest: "a".repeat(64) };
    const projected = projectDevelopmentDelivery(state, source, [], [
        { id: "native:failed", sessionId: "private", toolCallId: "failed", status: "failed", exitCode: 1 },
        { id: "native:unknown", sessionId: "private", toolCallId: "unknown", status: "held", recordedStatus: "running", exitCode: null },
    ]);
    assert.equal(projected.cycle, null);
    assert.equal(projected.reviewCoverage, "unavailable");
    assert.equal(projected.outcome, null);
    assert.match(projected.verificationLimits.join(" "), /not tool-backed test passes/);
    assert.equal(projected.nativeCommandEvidence[0].status, "failed");
    assert.equal(projected.nativeCommandEvidence[1].recordedStatus, "running");
    assert.equal(Object.hasOwn(projected, "passed"), false);
});

for (const content of ["\u6f22".repeat(8000), "a".repeat(7999) + "\u{1f600}end"]) {
    test(`Unicode delivery excerpts fit both adapter payloads (${content.startsWith("a") ? "surrogate boundary" : "aggregate bytes"})`, async () => {
        const root = await mkdtemp(join(tmpdir(), "tandem-delivery-unicode-"));
        try {
            const path = join(root, ".tandem", "efforts", "unicode", "stages", "development-r1.json");
            await writeJsonAtomically(path, {
                version: 1, prototypeId: "unicode", stageId: "development", revision: 1, completedAt: new Date().toISOString(),
                result: { goal: "\u6f22".repeat(4000), artifacts:
                    ["development-outcome"].map((id) => ({
                        id, title: "\u6f22".repeat(200), stage: "development", kind: id,
                        language: "json", content: projection(content), mermaid: "", path: "",
                    })),
                },
            });
            const record = await acceptStageSnapshot({
                workspaceRoot: root, sharedRoot: root, effortId: "unicode", stageId: "development",
                snapshotPath: relative(root, path), acceptedBy: { label: "Owner", sessionId: "session" },
                source: { commit: null, fingerprint: await fingerprintWorkspace(root) },
                producer: { version: "1.0.0", configurationHash: "0".repeat(64) }, upstream: [],
            });
            const state: Parameters<typeof prepareDeliveryDraft>[0] = {
                prototypeId: "unicode", process: { ...createProcessState(), acceptances: [record] },
                lifecycle: { currentStage: "development", completedStages: [], history: [], skippedStages: [],
                    outputs: [{ stageId: "development", path: record.snapshotPath, completedAt: record.acceptedAt }] },
            };
            const { draft } = await prepareDeliveryDraft(state, root, root);
            assert.equal(Buffer.from(draft.body).toString("utf8"), draft.body);
            assert.ok(Buffer.byteLength(draft.body) <= HANDOFF_BODY_LIMIT_BYTES - 4096);
            assert.match(draft.body, /\[Excerpt:/);
            let posted = false;
            const registry = createProcessAdapters({
                workspaceRoot: root, githubRepository: "example/tandem",
                runGh: async (args) => {
                    if (args[5] === "repos/example/tandem/pulls/17") return JSON.stringify({
                        number: 17, html_url: "https://github.com/example/tandem/pull/17", state: "open",
                        draft: false, merged: false, mergeable: true, head: { sha: "a".repeat(40) }, user: null,
                    });
                    if (args[4] === "GET") return "[]";
                    assert.equal(args[5], "repos/example/tandem/issues/17/comments");
                    const body = args.at(-1)!.slice("body=".length);
                    assert.ok(Buffer.byteLength(body) <= HANDOFF_BODY_LIMIT_BYTES);
                    posted = true;
                    return JSON.stringify({ id: 1, html_url: "https://github.com/example/tandem/pull/17#issuecomment-1", body });
                },
            });
            const input = { idempotencyKey: draft.id, effortId: state.prototypeId,
                title: "Reviewed handoff", body: draft.body, reference: "17" };
            await registry.get("local").handoff(input);
            await registry.get("github").handoff(input);
            assert.equal(posted, true);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { acceptStageSnapshot } from "../src/accepted-artifacts.js";
import { assertDeliveryCurrent, prepareDeliveryDraft } from "../src/delivery.js";
import { fingerprintWorkspace } from "../src/execution.js";
import { createProcessState } from "../src/process-state.js";
import { writeJsonAtomically } from "../src/project-store.js";
import type { TandemState } from "../src/types.js";
import { createProcessAdapters, HANDOFF_BODY_LIMIT_BYTES } from "../src/process-adapters.js";

test("delivery uses accepted snapshot content and rejects source or acceptance drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-delivery-"));
    try {
        await writeFile(join(root, "app.ts"), "export const value = 1;");
        const path = join(root, ".tandem", "efforts", "delivery", "stages", "test-r2.json");
        await writeJsonAtomically(path, {
            version: 1, prototypeId: "delivery", stageId: "test", revision: 2, completedAt: new Date().toISOString(),
            result: { goal: "Accepted goal", artifacts: [{
                id: "test-results", title: "Test results", stage: "test", kind: "test-results",
                language: "markdown", content: "Accepted evidence", mermaid: "", path: ".",
            }] },
        });

        const record = await acceptStageSnapshot({
            workspaceRoot: root, sharedRoot: root, effortId: "delivery", stageId: "test",
            snapshotPath: relative(root, path), acceptedBy: { label: "Owner", sessionId: "session" },
            source: { commit: null, fingerprint: await fingerprintWorkspace(root) },
            producer: { version: "1.0.0", configurationHash: "0".repeat(64) }, upstream: [],
        });
        const state = {
            prototypeId: "delivery", goal: "Unaccepted changed text", process: { ...createProcessState(), acceptances: [record] },
            lifecycle: { completedStages: ["test"], outputs: [{ stageId: "test", path: record.snapshotPath }] },
        } as TandemState;
        const prepared = await prepareDeliveryDraft(state, root, root);
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

for (const content of ["\u6f22".repeat(8000), "a".repeat(7999) + "\u{1f600}end"]) {
    test(`Unicode delivery excerpts fit both adapter payloads (${content.startsWith("a") ? "surrogate boundary" : "aggregate bytes"})`, async () => {
        const root = await mkdtemp(join(tmpdir(), "tandem-delivery-unicode-"));
        try {
            const path = join(root, ".tandem", "efforts", "unicode", "stages", "test-r1.json");
            await writeJsonAtomically(path, {
                version: 1, prototypeId: "unicode", stageId: "test", revision: 1, completedAt: new Date().toISOString(),
                result: { goal: "\u6f22".repeat(4000), artifacts:
                    ["requirements-result", "design-spec", "execution-plan", "final-code", "test-results"].map((id) => ({
                        id, title: "\u6f22".repeat(200), stage: "test", kind: id,
                        language: "markdown", content, mermaid: "", path: "",
                    })),
                },
            });
            const record = await acceptStageSnapshot({
                workspaceRoot: root, sharedRoot: root, effortId: "unicode", stageId: "test",
                snapshotPath: relative(root, path), acceptedBy: { label: "Owner", sessionId: "session" },
                source: { commit: null, fingerprint: await fingerprintWorkspace(root) },
                producer: { version: "1.0.0", configurationHash: "0".repeat(64) }, upstream: [],
            });
            const state: Parameters<typeof prepareDeliveryDraft>[0] = {
                prototypeId: "unicode", process: { ...createProcessState(), acceptances: [record] },
                lifecycle: { currentStage: "test", completedStages: ["test"], history: [], skippedStages: [],
                    outputs: [{ stageId: "test", path: record.snapshotPath, completedAt: record.acceptedAt }] },
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

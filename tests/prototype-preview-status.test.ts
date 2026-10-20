import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import { newPrototypeFlow, type PrototypeCheckpoint } from "../src/prototype-flow.js";
import { readyPrototype, reactHarness, response, waitFor } from "./renderer-fixtures.test.js";

test("preview status verifies only the displayed checkpoint and preserves pending history without work", async () => {
    const h = await extensionHarness();
    h.setPreviewFetch(fetch);
    let mode = "valid", redirected = 0;
    const preview = createServer((req, res) => {
        if (req.url === "/redirected") redirected++;
        if (mode === "disconnect") { req.socket.destroy(); return; }
        if (mode === "redirect" && req.url !== "/redirected") {
            res.writeHead(302, { Location: "/redirected" }); res.end(); return;
        }
        res.writeHead(mode === "http-error" ? 503 : 200, { "Content-Type": "text/html" });
        res.end(`<meta name="tandem-prototype-id" content="${mode === "foreign" ? "other" : "preview-probe"}">
            <meta name="tandem-prototype-checkpoint" content="${mode === "wrong-checkpoint" ? "pending" : "current"}">`);
    });
    await new Promise<void>(resolve => preview.listen(0, "127.0.0.1", resolve));
    const address = preview.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/`;
    const state = h.api.createState("preview-probe");
    const checkpoint: PrototypeCheckpoint = {
        id: "current", requestId: "original-request", generation: state.generation, milestone: "structure",
        revisionId: null, baseCheckpointId: null, sourceCheckpointId: null, workspacePath: process.cwd(),
        workspacePrepared: true, status: "ready", previewUrl: url, summary: "Accepted current checkpoint",
        focus: "original", requestedAt: state.updatedAt, completedAt: state.updatedAt, timeoutSeconds: null,
    };
    state.previewUrl = url;
    state.previewStatus = "ready";
    state.prototypeFlow = { ...newPrototypeFlow(), displayedCheckpointId: "current", pendingCheckpointId: "pending",
        checkpoints: [checkpoint, { ...checkpoint, id: "pending", milestone: "interaction", previewUrl: url + "pending" }] };
    await h.api.persistState(state);
    const before = await h.api.loadState(state.prototypeId);
    const server = await h.api.startServer("preview-status", state.prototypeId, "project:tandem", true);
    try {
        for (mode of ["valid", "foreign", "wrong-checkpoint", "redirect", "http-error", "disconnect"]) {
            const result = await (await fetch(new URL("/api/prototype/preview-status", server.url))).json();
            assert.equal(result.generation, state.generation);
            assert.equal(result.checkpointId, "current");
            assert.equal(result.pendingCheckpointId, "pending");
            assert.equal(result.url, url);
            assert.equal(result.available, mode === "valid", JSON.stringify({ mode, result }));
            if (mode !== "valid") assert.ok(result.reason.length > 0);
        }
        assert.equal(redirected, 0);
        assert.deepEqual(await h.api.loadState(state.prototypeId), before);
        assert.equal(h.requests.length, 0);
    } finally {
        clearInterval(server.heartbeat); server.live.close();
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
        await new Promise<void>(resolve => { preview.close(() => resolve()); preview.closeAllConnections(); });
        await h.close();
    }
});

function status(value: ReturnType<typeof readyPrototype>, available = true) {
    const flow = value.prototypeFlow;
    return { generation: value.generation, checkpointId: flow.displayedCheckpointId, pendingCheckpointId: flow.pendingCheckpointId,
        url: flow.checkpoints.find((item: { id: string }) => item.id === flow.displayedCheckpointId).previewUrl,
        available, reason: available ? "" : "Saved preview is stopped." };
}

test("preview verification rejects stale pending, checkpoint and generation responses without changing drafts", async t => {
    const h = await reactHarness(t);
    const replies: Array<(response: Response) => void> = [];
    h.setPreviewFetch(() => new Promise(resolve => replies.push(resolve)));
    const first = readyPrototype(1, true);
    h.render(first); await h.flush();
    await h.input("revision-input", "Keep this feedback draft.");
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").hidden, true);
    const changedPending = readyPrototype(2, false);
    changedPending.prototypeFlow.displayedCheckpointId = "structure";
    changedPending.previewUrl = first.previewUrl;
    h.render(changedPending); await h.flush();
    assert.equal(replies.length, 2);
    replies[0](response(status(first))); await h.flush();
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").hidden, true);
    replies[1](response(status(changedPending))); await h.flush();
    const current = h.get<HTMLIFrameElement>("preview-frame");
    assert.equal(current.hidden, false);
    await h.click("retry-current-preview");
    assert.equal(h.get("preview-frame"), current, "Rechecking a verified identity keeps the frame mounted.");
    const next = readyPrototype(3);
    next.prototypeFlow.checkpoints[1].previewUrl = first.previewUrl; next.previewUrl = first.previewUrl;
    h.render(next); await h.flush();
    replies[2](response(status(changedPending))); await h.flush();
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").hidden, true, "Same URL cannot lend another checkpoint its verification.");
    replies[3](response(status(next))); await h.flush();
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "Keep this feedback draft.");
    const reset = { ...next, revision: 4, generation: "different-generation" };
    h.render(reset); await h.flush();
    replies[4](response(status(next))); await h.flush();
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").hidden, true);
    assert.match(h.get("preview-availability").textContent!, /could not be verified/);
    h.setPreviewFetch(async () => response(status(reset)));
    await h.click("retry-current-preview");
    await waitFor(h, () => !h.get<HTMLIFrameElement>("preview-frame").hidden);
    assert.equal(h.requests.length, 0);
});

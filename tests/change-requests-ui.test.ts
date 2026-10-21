import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reactHarness, rendererFixtureScript, response, state } from "./helpers/react-harness.js";
import type { ChangeRequest } from "../src/change-requests.js";
import { createStageReview, type StageReviewReference } from "../src/stage-review.js";
import { sketchFixture } from "./renderer-fixtures.test.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

function request(): ChangeRequest {
    return { version: 1, id: "change", clientRequestId: "client", originStage: "prototype", message: "Add save and reload.",
        submittedAt: "2026-10-15T12:00:00Z", baseCheckpointId: null, baseSketchRevisionId: null, visualSelection: null,
        sourceResultId: null, sourceRequests: [], baselineDigest: "a".repeat(64), analysisId: "analysis", status: "proposed",
        error: "", clarifications: [], remainingStages: [], workStarted: [], affectedDecisionIds: [], snapshotPath: null,
        completedAt: null, developmentAdmission: null, developmentRequest: null, assessment: {
            version: 1, summary: "Add saving while preserving playback.", reason: "This introduces new behavior.",
            startStage: "requirements", stages: [{ stage: "requirements", reason: "Define saving." }, { stage: "prototype", reason: "Add mock interaction." }],
            preserved: ["Joint controls", "Playback"], affectedScreenIds: [], question: null, requirements: null,
        } };
}

test("change history, stage navigation and drawing controls occupy separate workspace rows", {
    skip: !browserAvailable, timeout: 60000,
}, async t => {
    const drawing = sketchFixture();
    const change: ChangeRequest = {
        ...request(), originStage: "sketch", message: "Move the primary action below the title.", status: "active",
        remainingStages: ["sketch"], workStarted: ["sketch"], assessment: {
            version: 1, summary: "Adjust the primary action.", reason: "The agreed behavior is unchanged.",
            startStage: "sketch", stages: [{ stage: "sketch", reason: "Adjust the layout." }],
            preserved: ["Accepted requirements"], affectedScreenIds: [drawing.document.screens[0].id], question: null, requirements: null,
        },
    };
    const initial = { ...drawing.value, changeRequests: [change] };
    const [script, styles] = await Promise.all([
        rendererFixtureScript(),
        build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
            bundle: true, write: false, logLevel: "silent" }),
    ]);
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${styles.outputFiles[0].text}</style></head><body><div id="root"></div>
        <script>${script.replaceAll("</script", "<\\/script")}
        window.workspaceFixture = TandemTest.mount();
        workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify(initial)}));
        </script></body></html>`;
    const unexpected: string[] = [];
    const server = createServer((req, res) => {
        const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
        req.resume();
        const send = (body: unknown) => {
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify(body));
        };
        if (path === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); }
        else if (path === "/api/project-entry") send({ projectPath: "C:\\fixture-project", startingPath: "preparation" });
        else if (path === "/api/project-entry/open") send({ developmentStarted: false, developmentContext: false });
        else if (path === "/api/sketch") send({ sketch: initial.sketch, document: drawing.document });
        else if (path === "/favicon.ico") { res.writeHead(204); res.end(); }
        else { unexpected.push(`${req.method} ${path}`); res.writeHead(404); res.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await openFixtureBrowser(t);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1686, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
    await browser.waitFor('Boolean(document.querySelector("#sketch-board svg")) && !document.querySelector("#studio-workspace").inert');
    let revision = initial.revision;
    for (const width of [1686, 1024, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        for (const history of ["active", "completed", "expanded", "none"]) {
            const changes = history === "none" ? [] : [{
                ...change, ...(history !== "active" ? { status: "completed", completedAt: initial.updatedAt } : {}),
            }];
            await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify({
                ...initial, revision: ++revision, changeRequests: changes,
            })}))`);
            await browser.evaluate(`(() => {
                const history = document.querySelector(".change-history");
                if (history) history.open = ${history === "expanded"};
                return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            })()`);
            const layout = await browser.evaluate(`(() => {
                const bounds = selector => {
                    const rect = document.querySelector(selector)?.getBoundingClientRect();
                    return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right } : null;
                };
                return { changes: bounds(".change-requests"), tabs: bounds(".previewbar"), panel: bounds("#sketch-panel"),
                    controls: bounds(".sketch-header-actions"), board: bounds(".sketch-board-wrap"), viewport: bounds("#preview-pane"),
                    pageFits: document.documentElement.scrollWidth <= innerWidth + 1 };
            })()`);
            if (process.env.TANDEM_UI_EVIDENCE) {
                await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `change-layout-${width}-${history}.png`), await browser.screenshot());
            }
            const context = `${width}px / ${history}: ${JSON.stringify(layout)}`;
            if (layout.changes) assert.ok(layout.tabs.top >= layout.changes.bottom - 1, context);
            assert.ok(layout.panel.top >= layout.tabs.bottom - 1, context);
            assert.ok(layout.controls.top >= layout.tabs.bottom - 1, context);
            assert.ok(layout.panel.height > layout.controls.height, context);
            assert.ok(layout.board.height > 0, context);
            assert.ok(layout.controls.bottom <= layout.viewport.bottom + 1, context);
            assert.equal(layout.pageFits, true, context);
        }
    }
    await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify({
        ...initial, revision: ++revision,
    })}))`);
    await browser.evaluate('document.querySelector("#content-tab").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))');
    await browser.waitFor('document.querySelector("#content-panel").hidden === false');
    assert.equal(await browser.evaluate('document.querySelector("#stage-workspace-tabs")'), null);
    assert.ok(await browser.evaluate(`document.querySelector("#content-panel").getBoundingClientRect().top
        >= document.querySelector(".change-requests").getBoundingClientRect().bottom - 1`));
    assert.deepEqual(unexpected, []);
    assert.deepEqual(browser.exceptions, []);
    await browser.call("Page.navigate", { url: "about:blank" });
});

test("impact review stays beside the existing prototype and submits the exact displayed proposal identity", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.previewStatus = "ready"; initial.previewUrl = "http://127.0.0.1:4321/";
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    assert.match(h.document.querySelector(".change-impact")!.textContent!, /Joint controls/);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    const reference: StageReviewReference = { version: 1, id: "review-22222222-2222-2222-2222-222222222222",
        stage: "requirements", generation: initial.generation, createdAt: initial.updatedAt, appliedAt: null, discardedAt: null,
        changeRequestId: "change" };
    const draft = { ...createStageReview(initial, reference), revision: 1, provider: initial.provider,
        stageReviewStatus: { conflict: "", blocker: "Review the draft decisions.", changed: true, currentStage: "prototype",
            appliedAt: null, discardedAt: null } };
    h.setFetch(async path => {
        if (path === "/api/reviews/open") return response({ draft });
        if (path.startsWith(`/api/reviews/${reference.id}/`)) return response(draft);
        assert.equal(path, "/api/state");
        return response({ ...initial, revision: 2, stageReviews: [reference],
            changeRequests: [{ ...request(), status: "reviewing", reviewId: reference.id, remainingStages: ["requirements", "prototype"] }] });
    });
    await h.click("approve-change");
    const sent = h.requests.find(item => item.path === "/api/reviews/open")!;
    assert.deepEqual(sent.body, { stageId: "requirements", expectedGeneration: initial.generation,
        changeRequestId: "change", analysisId: "analysis", baselineDigest: "a".repeat(64) });
    assert.equal(h.store.getSnapshot().state.previewUrl, initial.previewUrl);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.match(h.get("design-tree-panel").textContent!, /Pinned draft review/);
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});

test("stale impact errors keep the request and clarification draft visible without navigation", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    h.setFetch(async () => response({ error: "The project changed. Check the impact again." }, 409));
    await h.click("approve-change");
    assert.match(h.get("change-action-status").textContent!, /project changed/);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    const refined = h.document.querySelector(".change-actions button:nth-child(2)")!;
    await h.click(refined);
    await h.input("change-detail", "Keep saving local to this device.");
    await h.fire(h.get("change-detail").closest("form")!, "submit");
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep saving local to this device.");
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});

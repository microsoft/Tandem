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

test("change details open in a bounded dialog without moving stage navigation or drawing controls", {
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
            await browser.evaluate(`(async () => {
                const toggle = document.querySelector("#toggle-change-details");
                if (${history === "expanded"}) toggle?.click();
                else document.querySelector("#close-change-details")?.click();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
            if (history === "expanded") {
                assert.equal(await browser.evaluate('document.querySelector("#change-request-details")?.getAttribute("role")'), "dialog");
                await browser.evaluate('document.querySelector("#close-change-details").click()');
            }
        }
    }
    const longChange: ChangeRequest = {
        ...change, status: "proposed", error: "Retained Development ownership must be opened and explicitly settled or closed before upstream discovery can change.",
        assessment: { ...change.assessment!, summary: "Improve alignment and text layout while preserving the accepted workflows.",
            reason: "This changes the draft screen layout, not product capabilities. ".repeat(8),
            preserved: Array.from({ length: 8 }, (_, index) => `Accepted behavior ${index + 1}: keep saved screens, navigation, explicit saves and validation unchanged.`) },
    };
    for (const [width, height, fontSize] of [
        [1556, 900, "standard"], [1024, 600, "standard"], [760, 700, "standard"], [375, 700, "standard"],
        [1024, 600, "largest"], [375, 700, "largest"],
    ] as const) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`document.documentElement.dataset.projectFontSize = ${JSON.stringify(fontSize)}`);
        await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify({
            ...initial, revision: ++revision, changeRequests: [longChange],
        })}))`);
        await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const compact = await browser.evaluate(`(() => {
            const panel = document.querySelector(".change-requests").getBoundingClientRect();
            const workspace = document.querySelector("#preview-pane").getBoundingClientRect();
            const board = document.querySelector("#sketch-board-wrap").getBoundingClientRect();
            const header = document.querySelector(".sketch-header-actions");
            const bounds = header.getBoundingClientRect();
            return { height: panel.height, workspaceHeight: workspace.height, boardHeight: board.height,
                boardTop: board.top, boardWidth: board.width,
                finishVisible: document.querySelector("#complete-stage").checkVisibility(),
                approveVisible: document.querySelector("#sketch-approve").checkVisibility(),
                controlsFit: [...header.querySelectorAll("button:not([hidden])")].every(button => {
                    const rect = button.getBoundingClientRect();
                    return rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1;
                }) };
        })()`);
        const context = `${width}x${height} / ${fontSize}: ${JSON.stringify(compact)}`;
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `long-impact-${width}-${fontSize}-collapsed.png`), await browser.screenshot());
        }
        assert.ok(compact.height <= 150, `A long impact report must start compact: ${context}`);
        assert.ok(compact.boardHeight >= (width > 600 ? 200 : 80), `Keep usable drawing space: ${context}`);
        assert.equal(compact.finishVisible, false, context);
        assert.equal(compact.approveVisible, true, context);
        assert.equal(compact.controlsFit, true, context);
        await browser.evaluate('document.querySelector("#toggle-change-details").focus()');
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await browser.waitFor('document.querySelector("#toggle-change-details").getAttribute("aria-expanded") === "true"');
        const popup = await browser.evaluate(`(() => {
            const dialog = document.querySelector("#change-request-details"), rect = dialog.getBoundingClientRect();
            const board = document.querySelector("#sketch-board-wrap").getBoundingClientRect();
            return { role: dialog.getAttribute("role"), modal: dialog.getAttribute("aria-modal"),
                inWorkspace: Boolean(dialog.closest("#preview-pane")),
                focusInside: dialog.contains(document.activeElement), initialFocus: document.activeElement.id,
                top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
                boardHeight: board.height, boardTop: board.top, boardWidth: board.width };
        })()`);
        assert.equal(popup.role, "dialog");
        assert.equal(popup.modal, "true");
        assert.equal(popup.inWorkspace, false, "Dialog content must not participate in the workspace grid.");
        assert.equal(popup.focusInside, true);
        assert.equal(popup.initialFocus, "close-change-details", "Opening details cannot focus an approval action.");
        assert.ok(popup.top >= 0 && popup.left >= 0 && popup.right <= width && popup.bottom <= height, JSON.stringify(popup));
        for (const key of ["boardHeight", "boardTop", "boardWidth"] as const) {
            assert.ok(Math.abs(popup[key] - compact[key]) <= 1, `${key} changed when the dialog opened: ${context}`);
        }
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.equal(await browser.evaluate('document.querySelector("#change-request-details").contains(document.activeElement)'), true);
        await browser.evaluate('document.querySelector("#approve-change").scrollIntoView({block:"nearest"})');
        assert.equal(await browser.evaluate(`(() => {
            const button = document.querySelector("#approve-change"), rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return button === hit || button.contains(hit);
        })()`), true, `Explicit review remains reachable at ${width}px`);
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `change-dialog-${width}-${fontSize}.png`), await browser.screenshot());
        }
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.waitFor('!document.querySelector("#change-request-details") && document.activeElement.id === "toggle-change-details"');
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

test("impact dialog preserves clarification drafts and errors across closing, reopening and updates", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    const toggle = h.get("toggle-change-details");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(toggle.getAttribute("aria-haspopup"), "dialog");
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.match(h.get("change-impact-title").textContent!, /Review change impact/);
    await h.click(toggle);
    const details = h.get("change-request-details");
    assert.equal(details.getAttribute("role"), "dialog");
    assert.equal(details.closest("#preview-pane"), null);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    const refine = [...details.querySelectorAll("button")].find(button => button.textContent === "Refine request")!;
    await h.click(refine);
    await h.input("change-detail", "Keep my unsent clarification.");
    const field = h.get<HTMLTextAreaElement>("change-detail");
    h.render({ ...initial, revision: 2, changeRequests: [{ ...request(), error: "Retained Development ownership needs attention." }] });
    await h.flush();
    assert.equal(h.get("change-detail"), field, "A state update must not replace an open editor.");
    assert.match(h.get("change-dialog-error").textContent!, /Retained Development ownership/);
    await h.click("close-change-details");
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.equal(h.document.activeElement, toggle);
    h.render({ ...initial, revision: 3, changeRequests: [{ ...request(), error: "Retained Development ownership needs attention." }] });
    await h.flush();
    const error = h.get("change-action-status");
    assert.equal(error.closest("[hidden]"), null, "Errors remain visible after the dialog closes.");
    assert.match(error.textContent!, /Retained Development ownership/);
    assert.equal(h.document.getElementById("change-request-details"), null, "An update must not reopen the dialog.");
    await h.click(toggle);
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep my unsent clarification.");
    await h.fire(h.get("close-change-details"), "keydown", { key: "Escape" });
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.deepEqual(h.errors, []);
});

test("impact review stays beside the existing prototype and submits the exact displayed proposal identity", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.previewStatus = "ready"; initial.previewUrl = "http://127.0.0.1:4321/";
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    await h.click("toggle-change-details");
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
    assert.equal(h.document.getElementById("change-request-details"), null, "The dialog must close to reveal the opened draft.");
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});

test("same-stage approval and return-to-work actions close the dialog without losing the request", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change: ChangeRequest = { ...request(), assessment: { ...request().assessment!,
        startStage: "prototype", stages: [{ stage: "prototype", reason: "Adjust the current preview only." }] } };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    const active = { ...initial, revision: 2, changeRequests: [{ ...change, status: "active" as const, remainingStages: ["prototype" as const] }] };
    h.setFetch(async () => response(active));
    await h.click("toggle-change-details");
    await h.click("approve-change");
    assert.equal(h.document.getElementById("change-request-details"), null);
    const sent = h.requests.find(item => item.path === "/api/change-requests/decision")!;
    assert.deepEqual(sent.body, { requestId: change.id, analysisId: change.analysisId, baselineDigest: change.baselineDigest,
        decision: "approve", answer: "" });
    await h.click("toggle-change-details");
    const go = [...h.get("change-request-details").querySelectorAll("button")].find(button => button.textContent === "Go to Prototype")!;
    assert.ok(go);
    await h.click(go);
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.equal(h.store.getSnapshot().state.changeRequests![0].id, change.id);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 1);
    assert.deepEqual(h.errors, []);
});

test("stale impact errors keep the request and clarification draft visible without navigation", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    await h.click("toggle-change-details");
    h.setFetch(async () => response({ error: "The project changed. Check the impact again." }, 409));
    await h.click("approve-change");
    assert.match(h.get("change-action-status").textContent!, /project changed/);
    assert.match(h.get("change-dialog-error").textContent!, /project changed/);
    assert.equal(h.get("change-request-details").getAttribute("role"), "dialog");
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    const refined = h.document.querySelector(".change-actions button:nth-child(2)")!;
    await h.click(refined);
    await h.input("change-detail", "Keep saving local to this device.");
    await h.fire(h.get("change-detail").closest("form")!, "submit");
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep saving local to this device.");
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptySketchState } from "../src/sketch.js";
import { SketchStore } from "../src/sketch-store.js";
import { requirementsInputDigest } from "../src/requirements-reconciliation.js";
import { rendererFixtureScript, state, decision } from "./helpers/react-harness.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";
import type { SketchWorkerEvent } from "../src/sketch-stream-worker.js";
import type { ChangeAssessment } from "../src/change-requests.js";
import type { TandemState } from "../src/types.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

test("a no-question Requirements review visibly leads a legacy preview through explicit update and application", {
    skip: !browserAvailable, timeout: 60000,
}, async t => {
    const [script, styles] = await Promise.all([
        rendererFixtureScript(),
        build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
            bundle: true, write: false, logLevel: "silent" }),
    ]);
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${styles.outputFiles[0].text}</style></head><body><div id="root"></div><script>
        window.__renderMermaid = async () => ({svg:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'});
        ${script.replaceAll("</script", "<\\/script")}
        window.workspaceFixture = TandemTest.mount();
        workspaceFixture.store.refresh();
        </script></body></html>`;
    const h = await extensionHarness({}, undefined, html, undefined, false, true);
    const initial = h.api.createLegacyState("sample", "A task app");
    initial.stage = initial.lifecycle.currentStage = "prototype";
    initial.lifecycle.completedStages = ["prepare", "requirements"];
    initial.preparation.status = "ready";
    initial.prototypeApproach = { mode: "build", reason: "Try the task workflow." };
    initial.requirements = { substage: "dag", usageItems: ["I want to complete a task."], suggestions: [] };
    initial.decisionGraph.nodes = [decision("task", "answered")];
    initial.previewStatus = "ready";
    const originalId = `legacy-interaction-${initial.generation}`;
    const previewHtml = (id: string, label: string) => `<!doctype html><html>
        <meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${id}">
        <body><h1>Task preview</h1><button>${label}</button></body></html>`;
    const original = previewHtml(originalId, "Complete task");
    const servePreview = (req: IncomingMessage, res: ServerResponse) => {
        const id = new URL(req.url!, "http://127.0.0.1").pathname.split("/")[2];
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        res.end(id ? previewHtml(id, "Save and reload task") : original);
    };
    const preview = createServer(servePreview), candidatePreview = createServer(servePreview);
    await Promise.all([preview, candidatePreview].map(server => new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))));
    const address = preview.address();
    const candidateAddress = candidatePreview.address();
    assert.ok(address && typeof address !== "string" && candidateAddress && typeof candidateAddress !== "string");
    const previewUrl = `http://127.0.0.1:${address.port}`;
    const candidateUrl = `http://127.0.0.1:${candidateAddress.port}`;
    initial.previewUrl = `${previewUrl}/original`;
    await writeFile(join(h.root, "index.html"), original);
    await h.api.persistState(initial);
    h.setPreviewFetch(fetch);
    const usage = "I want to save and reload a task.";
    const plan: ChangeAssessment = {
        version: 1, startStage: "requirements", summary: "Add saving and reloading while retaining the task workflow.",
        reason: "This adds one unambiguous capability, not a new unanswered product decision.",
        stages: [{ stage: "requirements", reason: "Record the new usage." }, { stage: "prototype", reason: "Wire the saved task interaction." }],
        preserved: ["Existing task completion"], affectedScreenIds: [], question: null,
        requirements: { usages: { add: [usage], remove: [] }, upsert: [], remove: [],
            assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null },
    };
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: {
        run: async (request: { args: { action: string; state: TandemState } }) => {
            h.requests.push(request);
            const runId = `review-browser-${h.requests.length}`;
            if (request.args.action === "assess-change") return { runId, status: "completed", result: plan };
            const checkpoint = request.args.state.prototypeFlow!.checkpoints.at(-1)!;
            await writeFile(join(checkpoint.workspacePath, "index.html"), previewHtml(checkpoint.id, "Save and reload task"));
            return { runId, status: "completed", result: { summary: "Synthetic saved-task interaction prepared.",
                focus: "Inspect the saved-task controls.", previewUrl: `${candidateUrl}/candidate/${checkpoint.id}`,
                question: null, artifactChanges: { upsert: [], remove: [] }, evidence: [] } };
        },
    } } });
    const server = await h.api.startServer("review-roundtrip-browser", "sample", "project:tandem", true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
        await new Promise<void>(resolve => { preview.close(() => resolve()); preview.closeAllConnections(); });
        await new Promise<void>(resolve => { candidatePreview.close(() => resolve()); candidatePreview.closeAllConnections(); });
        await h.close();
    });
    const browser = await openFixtureBrowser(t);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: server.url });
    await browser.waitFor('Boolean(document.querySelector("#revision-input")) && !document.querySelector("#studio-workspace").inert');
    await browser.evaluate('document.querySelector("#revision-input").focus()');
    await browser.call("Input.insertText", { text: usage });
    await browser.evaluate('document.querySelector("#submit-revision").click()');
    await h.waitForRequests(); await h.api.waitForAnswer("sample");
    await browser.evaluate("workspaceFixture.store.refresh()");
    await browser.waitFor('Boolean(document.querySelector("#approve-change"))');
    await browser.evaluate('document.querySelector("#approve-change").click()');
    await browser.waitFor('document.querySelector("#apply-stage-review")?.disabled === false');
    for (const width of [1280, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const layout = await browser.evaluate(`(() => {
            const comparison = document.querySelector(".stage-review-comparison"), rect = comparison.getBoundingClientRect();
            const row = comparison.querySelector("tbody tr").getBoundingClientRect();
            return { width:innerWidth, height:rect.height, bottom:rect.bottom, rowBottom:row.bottom,
                text:comparison.textContent, inDialog:Boolean(comparison.closest("[role=dialog]")),
                visible:comparison.checkVisibility() && rect.height > 0, fits:rect.left >= 0 && rect.right <= innerWidth + 1,
                changesVisible:row.bottom <= rect.bottom,
                pageFits:document.documentElement.scrollWidth <= innerWidth + 1,
                applyEnabled:!document.querySelector("#apply-stage-review").disabled,
                currentStage:workspaceFixture.store.getSnapshot().state.lifecycle.currentStage };
        })()`);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
            join(process.env.TANDEM_UI_EVIDENCE, `requirements-change-review-${width}.png`), await browser.screenshot());
        assert.match(layout.text, /No new questions need answers/);
        assert.match(layout.text, /I want to save and reload a task/);
        assert.equal(layout.inDialog, false);
        assert.equal(layout.visible && layout.fits && layout.changesVisible && layout.pageFits && layout.applyEnabled, true, JSON.stringify(layout));
        assert.equal(layout.currentStage, "prototype");
    }
    await browser.evaluate('document.querySelector("#apply-stage-review").click()');
    await browser.waitFor('Boolean(document.querySelector("[role=alertdialog]"))');
    assert.equal(h.requests.length, 1);
    assert.equal((await h.api.loadState("sample")).requirements.usageItems.includes(usage), false);
    await browser.evaluate('Array.from(document.querySelectorAll("[role=alertdialog] button")).find(button => button.textContent === "Confirm").click()');
    await browser.waitFor('Boolean(document.querySelector("#continue-stage-review"))');
    await browser.evaluate('document.querySelector("#continue-stage-review").click()');
    await browser.waitFor('document.querySelector("#retry-prototype-checkpoint")?.disabled === false');
    await browser.evaluate("window.reviewReloadMarker = true");
    await browser.call("Page.reload");
    await browser.waitFor('window.reviewReloadMarker !== true && Boolean(document.querySelector("#live-preview-tab")) && !document.querySelector("#studio-workspace").inert');
    await browser.evaluate('document.querySelector("#live-preview-tab").dispatchEvent(new MouseEvent("mousedown", { bubbles:true, button:0 }))');
    await browser.waitFor('document.querySelector("#retry-prototype-checkpoint")?.disabled === false && document.querySelector("#retry-prototype-checkpoint").checkVisibility() && Boolean(document.querySelector("#complete-stage"))');
    assert.equal(await browser.evaluate('document.querySelector("#complete-stage").disabled'), true);
    assert.equal(await browser.evaluate('document.querySelector("#retry-prototype-checkpoint").textContent'), "Update for reviewed inputs");
    assert.equal(h.requests.length, 1, "Reload cannot launch the prototype update.");
    if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
        join(process.env.TANDEM_UI_EVIDENCE, "prototype-reviewed-inputs-update.png"), await browser.screenshot());
    await browser.evaluate('document.querySelector("#retry-prototype-checkpoint").click()');
    await h.waitForRequests(2); await h.api.waitForAnswer("sample");
    const prepared = await h.api.loadState("sample");
    assert.ok(prepared.prototypeFlow?.pendingCheckpointId, JSON.stringify({ processing: prepared.processing, logs: h.logs }));
    await browser.evaluate("workspaceFixture.store.refresh()");
    await browser.waitFor('document.querySelector("#apply-prototype-update")?.hidden === false');
    assert.equal(await browser.evaluate('document.querySelector("#complete-stage").disabled'), true);
    assert.equal((await h.api.loadState("sample")).prototypeFlow!.displayedCheckpointId, originalId);
    await browser.evaluate('document.querySelector("#apply-prototype-update").click()');
    await browser.waitFor('document.querySelector("#complete-stage")?.disabled === false');
    const applied = await h.api.loadState("sample");
    assert.notEqual(applied.prototypeFlow!.displayedCheckpointId, originalId);
    assert.equal(applied.prototypeFlow!.checkpoints.at(-1)!.sourceCheckpointId, originalId);
    assert.equal(applied.prototypeReview.revisions[0].status, "applied");
    assert.equal(await readFile(join(h.root, "index.html"), "utf8"), original);
    assert.equal(h.requests.length, 2);
    assert.deepEqual(browser.exceptions, []);
    await browser.call("Page.navigate", { url: "about:blank" });
});

test("pinned draft review keeps lifecycle styling, editor state and controls usable on wide and narrow screens", {
    skip: !browserAvailable, timeout: 60000,
}, async t => {
    const initial = state("prototype");
    initial.prototypeId = "sample";
    initial.sketch = emptySketchState();
    initial.requirements.substage = "dag";
    initial.decisionGraph.nodes = [decision("task", "answered")];
    const [script, styles] = await Promise.all([
        rendererFixtureScript(),
        build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
            bundle: true, write: false, logLevel: "silent" }),
    ]);
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${styles.outputFiles[0].text}</style></head><body><div id="root"></div>
        <script>window.__renderMermaid = async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180" viewBox="0 0 360 180"><text x="20" y="40">Synthetic task decision</text></svg>' });
        ${script.replaceAll("</script", "<\\/script")}
        window.workspaceFixture = TandemTest.mount();
        workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify(initial)}));
        </script></body></html>`;
    const h = await extensionHarness({}, undefined, html, undefined, false, true);
    await h.api.persistState({ ...initial, revision: 0 });
    const server = await h.api.startServer("pinned-browser", "sample", "project:tandem", true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
        await h.close();
    });
    const browser = await openFixtureBrowser(t);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: server.url });
    try {
        await browser.waitFor('Boolean(document.querySelector("#design-tree-workspace-tab")) && !document.querySelector("#studio-workspace").inert');
    } catch (cause) {
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "pinned-review-entry.png"), await browser.screenshot());
        throw new Error(`${cause instanceof Error ? cause.message : cause}\n${await browser.evaluate("document.body.innerText")}\n${JSON.stringify(h.logs)}`);
    }
    await browser.evaluate('document.querySelector("#design-tree-workspace-tab").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))');
    await browser.waitFor('document.querySelector("#review-stage")?.hidden === false');
    await browser.evaluate('document.querySelector("#review-stage").click()');
    await browser.waitFor('Boolean(document.querySelector("[data-review-stage=requirements]"))');
    await browser.evaluate(`(() => {
        document.querySelector(".stage-review-request").open = true;
        window.pinnedEditor = document.querySelector("#review-requirement-request");
        pinnedEditor.focus();
    })()`);
    await browser.call("Input.insertText", { text: "Keep this draft while I work on the current prototype." });
    await browser.waitFor('document.querySelector("#apply-stage-review").disabled');
    for (const width of [1280, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#review-requirement-request").scrollIntoView({block:"end"})');
        const layout = await browser.evaluate(`(() => {
            const header = document.querySelector(".previewbar"), banner = document.querySelector(".stage-review-banner");
            const current = document.querySelector("#live-preview-tab"), reviewed = document.querySelector("#design-tree-tab");
            const bounds = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, height:r.height }; };
            return { header:bounds(header), banner:bounds(banner), fits:header.scrollWidth <= header.clientWidth + 1,
                viewport:innerWidth, current:current.getAttribute("aria-current"), reviewed:reviewed.getAttribute("aria-current"),
                currentColor:getComputedStyle(current).backgroundColor, reviewedColor:getComputedStyle(reviewed).backgroundColor,
                reviewedUnderline:getComputedStyle(reviewed, "::after").display,
                footer:bounds(document.querySelector("#stage-input-review")), input:bounds(document.querySelector("#review-requirement-request")),
                controls:Array.from(document.querySelectorAll(".pinned-review-buttons > button:not([hidden])"), bounds),
                headerHasApproval:Boolean(header.querySelector("#apply-stage-review")),
                currentStage:workspaceFixture.store.getSnapshot().state.lifecycle.currentStage };
        })()`);
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `pinned-review-${width}.png`), await browser.screenshot());
        }
        assert.equal(layout.currentStage, "prototype");
        assert.equal(layout.current, "step");
        assert.equal(layout.reviewed, null);
        assert.notEqual(layout.currentColor, layout.reviewedColor, "Viewing a completed stage cannot move the progress highlight.");
        assert.equal(layout.reviewedUnderline, "none", "Sidebar stages must not acquire the workspace tab underline.");
        assert.equal(layout.fits, true, JSON.stringify(layout));
        assert.ok(layout.header.left >= -1 && layout.header.right <= width + 1, JSON.stringify(layout));
        assert.equal(layout.headerHasApproval, false);
        assert.ok(layout.footer.top >= layout.input.bottom - 1, JSON.stringify(layout));
        assert.ok(layout.controls.length > 0);
        for (const control of layout.controls) {
            assert.ok(control.left >= layout.footer.left - 1 && control.right <= layout.footer.right + 1, JSON.stringify(layout));
            assert.ok(control.top >= layout.input.bottom - 1, JSON.stringify(layout));
            assert.ok(control.height > 0);
        }
    }
    await browser.evaluate('document.querySelector("#return-to-current-stage").click()');
    await browser.waitFor('document.querySelector("#live-preview-panel").hidden === false');
    await browser.evaluate('document.querySelector("#design-tree-workspace-tab").dispatchEvent(new MouseEvent("mousedown", { bubbles:true, button:0 }))');
    await browser.waitFor('document.querySelector("#design-tree-panel").hidden === false');
    assert.equal(await browser.evaluate('document.querySelector("#review-requirement-request") === pinnedEditor'), true);
    assert.equal(await browser.evaluate('pinnedEditor.value'), "Keep this draft while I work on the current prototype.");
    assert.equal(h.requests.length, 0);
    assert.deepEqual(browser.exceptions, []);
    await browser.call("Page.navigate", { url: "about:blank" });
});

test("stale Designs has a visible keyboard-accessible update action at wide and narrow review widths", {
    skip: !browserAvailable, timeout: 60000,
}, async t => {
    const initial = state("prototype");
    initial.prototypeId = "sample";
    initial.requirements.substage = "dag";
    initial.requirements.usageItems = ["I want to complete a task."];
    initial.decisionGraph.nodes = [decision("usage", "answered")];
    const [script, styles] = await Promise.all([
        rendererFixtureScript(),
        build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
            bundle: true, write: false, logLevel: "silent" }),
    ]);
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${styles.outputFiles[0].text}</style></head><body><div id="root"></div>
        <script>window.__renderMermaid = async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
        ${script.replaceAll("</script", "<\\/script")}
        window.workspaceFixture = TandemTest.mount();
        fetch("/api/state").then(response => response.json()).then(state => workspaceFixture.flushSync(() => workspaceFixture.store.accept(state)));
        </script></body></html>`;
    const h = await extensionHarness({}, undefined, html, undefined, false, true);
    let server: Awaited<ReturnType<typeof h.api.startServer>> | undefined;
    let updateId: string | undefined;
    let finish!: (value: string) => void;
    const output = new Promise<string>(resolve => { finish = resolve; });
    const operation = JSON.stringify({ op: "ui", screenId: "main", edit: { op: "setToken", key: "space.1", value: 26 } }) + "\n";
    const listeners = new Set<(event: SketchWorkerEvent) => void>();
    const workerSession = {
        on(handler: (event: SketchWorkerEvent) => void) { listeners.add(handler); return () => { listeners.delete(handler); }; },
        workflow: { getRunDetail: async (runId: string) => ({ runId, agents: [{ runId, toolCallId: "review-design-worker" }] }) },
    };
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: {
        run: async (request: { args: { prototypeId: string; action: string } }) => {
            h.requests.push(request);
            updateId = request.args.prototypeId;
            const runId = "incremental-review-browser";
            const result = await h.api.answerFactory.run({
                args: request.args, runId, signal: new AbortController().signal, session: workerSession,
                phase() {}, log() {}, step: (_key: string, work: () => Promise<unknown>) => work(),
                agent: async (prompt: string) => {
                    assert.equal(request.args.action, "revise-sketch");
                    assert.match(prompt, /INCREMENTAL UPDATE/);
                    const events: SketchWorkerEvent[] = [
                        { type: "subagent.started", agentId: "review-design-worker", data: { workflowRunId: runId, toolCallId: "review-design-worker" } },
                        { type: "assistant.message_start", agentId: "review-design-worker", data: { messageId: "review-update", phase: "final_answer" } },
                        { type: "assistant.message_delta", agentId: "review-design-worker", data: { messageId: "review-update", deltaContent: operation } },
                    ];
                    for (const event of events) for (const listener of listeners) listener(event);
                    return output;
                },
            });
            return { runId, status: "completed", result };
        },
    } } });
    t.after(async () => {
        finish(operation + '{"op":"done"}');
        if (updateId) await h.api.waitForAnswer(updateId);
        if (server) {
            const running = server;
            clearInterval(running.heartbeat);
            await new Promise<void>(resolve => { running.server.close(() => resolve()); running.server.closeAllConnections(); });
        }
        await h.close();
    });
    const document = sketchDocument();
    document.screens.push({ ...structuredClone(document.screens[0]), id: "help", title: "Reviewed help" });
    const revision = await new SketchStore(h.root).save("sample", document, {
        source: "generated", requirementsDigest: requirementsInputDigest(initial), number: 1,
    });
    initial.sketch = { ...emptySketchState(), status: "stale", current: revision, history: [revision] };
    await h.api.persistState({ ...initial, revision: 0 });
    server = await h.api.startServer("stale-design-browser", "sample", "project:tandem", true);
    const browser = await openFixtureBrowser(t);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: server.url });
    await browser.waitFor('Boolean(document.querySelector("#sketch-workspace-tab")) && !document.querySelector("#studio-workspace").inert');
    await browser.evaluate('document.querySelector("#sketch-workspace-tab").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))');
    await browser.waitFor('document.querySelector("#review-stage")?.hidden === false');
    await browser.evaluate('document.querySelector("#review-stage").click()');
    await browser.waitFor('document.querySelector("#sketch-update-requirements")?.disabled === false');
    for (const width of [1280, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#sketch-update-requirements").focus()');
        const layout = await browser.evaluate(`(() => {
            const action = document.querySelector("#sketch-update-requirements"), status = document.querySelector("#sketch-status");
            const bounds = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
            return { action: bounds(action), status: bounds(status), label: action.textContent, focused: document.activeElement === action,
                visible: getComputedStyle(status).display !== "none", currentStage: workspaceFixture.store.getSnapshot().state.lifecycle.currentStage,
                approvalDisabled: document.querySelector("#sketch-approve").disabled, applyDisabled: document.querySelector("#apply-stage-review").disabled };
        })()`);
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `stale-design-review-${width}.png`), await browser.screenshot());
        }
        assert.equal(layout.label, "Update designs from latest requirements");
        assert.equal(layout.visible, true);
        assert.equal(layout.focused, true);
        assert.equal(layout.currentStage, "prototype");
        assert.equal(layout.approvalDisabled, true);
        assert.equal(layout.applyDisabled, true);
        assert.ok(layout.action.height > 0 && layout.action.left >= -1 && layout.action.right <= width + 1, JSON.stringify(layout));
        assert.ok(layout.action.top >= layout.status.top - 1 && layout.action.bottom <= layout.status.bottom + 1, JSON.stringify(layout));
    }
    await browser.call("Page.bringToFront");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.waitFor('Boolean(document.querySelector("[role=alertdialog]"))');
    assert.equal(h.requests.length, 0, "Keyboard activation still requires confirmation before generation.");
    await browser.evaluate('Array.from(document.querySelectorAll("[role=alertdialog] button")).find(button => button.textContent === "Confirm").click()');
    await browser.waitFor('document.querySelector("#sketch-generation-title")?.textContent === "Updating UI design" && document.querySelector("#sketch-generation-progress")?.textContent.includes("live update 1")');
    for (const width of [1280, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        const preview = await browser.evaluate(`(() => ({
            screens: Array.from(document.querySelectorAll("#sketch-screens > button"), button => ({
                title: button.textContent, status: button.dataset.screenStatus,
            })),
            retained: Boolean(document.querySelector("#sketch-board .dsl-view")?.shadowRoot?.querySelector('[data-ui-id="primary-action"]')),
            progress: document.querySelector("#sketch-generation-progress").textContent,
            applyDisabled: document.querySelector("#apply-stage-review").disabled,
        }))()`);
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `incremental-design-review-${width}.png`), await browser.screenshot());
        }
        assert.equal(preview.screens.length, 2);
        assert.equal(preview.screens[0].status, "processing");
        assert.equal(preview.screens[1].status, "ready");
        assert.match(preview.screens[1].title, /Reviewed help/);
        assert.equal(preview.retained, true);
        assert.match(preview.progress, /Updating existing designs/);
        assert.doesNotMatch(preview.progress, /screens received/);
        assert.equal(preview.applyDisabled, true);
    }
    assert.equal(h.requests.length, 1);
    finish(operation + '{"op":"done"}');
    assert.ok(updateId);
    await h.api.waitForAnswer(updateId);
    assert.equal((await h.api.loadState(updateId)).sketch.current!.source, "revised");
    assert.equal((await h.api.loadState("sample")).sketch.current!.id, revision.id);
    assert.equal((await h.api.loadState("sample")).lifecycle.currentStage, "prototype");
    assert.deepEqual(browser.exceptions, []);
    await browser.call("Page.navigate", { url: "about:blank" });
});

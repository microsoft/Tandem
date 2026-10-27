import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptySketchState } from "../src/sketch.js";
import { SketchStore } from "../src/sketch-store.js";
import { requirementsInputDigest } from "../src/requirements-reconciliation.js";
import { rendererFixtureScript, state, decision } from "./helpers/react-harness.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";
import type { SketchWorkerEvent } from "../src/sketch-stream-worker.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

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
        fetch("/api/state").then(response => response.json()).then(state => workspaceFixture.flushSync(() => workspaceFixture.store.accept(state)));
        </script></body></html>`;
    const h = await extensionHarness({}, undefined, html, undefined, false, true);
    await h.api.persistState({ ...initial, revision: 0 });
    const server = await h.api.startServer("pinned-browser", "sample", "project:tandem", true);
    const preparedReview = await fetch(new URL("api/reviews/open", server.url), { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: "requirements", expectedGeneration: initial.generation }) });
    assert.equal(preparedReview.status, 200, "Seed a saved draft for explicit resume through the review pane.");
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
    await browser.waitFor('document.querySelector("#continue-pending-review")?.disabled === false');
    await browser.evaluate('document.querySelector("#continue-pending-review").click()');
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
            const header = document.querySelector(".previewbar"), banner = document.querySelector(".pinned-review-actions");
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
    const preparedReview = await fetch(new URL("api/reviews/open", server.url), { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: "sketch", expectedGeneration: initial.generation }) });
    assert.equal(preparedReview.status, 200);
    const browser = await openFixtureBrowser(t);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: server.url });
    await browser.waitFor('Boolean(document.querySelector("#sketch-workspace-tab")) && !document.querySelector("#studio-workspace").inert');
    await browser.evaluate('document.querySelector("#sketch-workspace-tab").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))');
    await browser.waitFor('document.querySelector("#continue-pending-review")?.disabled === false');
    await browser.evaluate('document.querySelector("#continue-pending-review").click()');
    await browser.waitFor('document.querySelector("#sketch-update-requirements")?.disabled === false');
    for (const width of [1280, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#sketch-update-requirements").focus()');
        const layout = await browser.evaluate(`(() => {
            const action = document.querySelector("#sketch-update-requirements"), status = document.querySelector("#stage-input-review");
            const bounds = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
            return { action: bounds(action), status: bounds(status), label: action.textContent, focused: document.activeElement === action,
                visible: getComputedStyle(status).display !== "none", currentStage: workspaceFixture.store.getSnapshot().state.lifecycle.currentStage,
                separateApproval: Boolean(document.querySelector("#sketch-approve")), applyDisabled: document.querySelector("#apply-stage-review").disabled };
        })()`);
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `stale-design-review-${width}.png`), await browser.screenshot());
        }
        assert.equal(layout.label, "Update designs from latest requirements");
        assert.equal(layout.visible, true);
        assert.equal(layout.focused, true);
        assert.equal(layout.currentStage, "prototype");
        assert.equal(layout.separateApproval, false);
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

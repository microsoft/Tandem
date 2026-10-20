import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptySketchState } from "../src/sketch.js";
import { rendererFixtureScript, state, decision } from "./helpers/react-harness.js";
import { extensionHarness } from "./helpers/extension-harness.js";
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
        workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify(initial)}));
        </script></body></html>`;
    const h = await extensionHarness({}, undefined, html, undefined, false, true);
    await h.api.persistState({ ...initial, revision: 0 });
    const server = await h.api.startServer("pinned-browser", "sample", "project:tandem", true);
    t.after(async () => {
        clearInterval(server.heartbeat); server.live.close();
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
        const layout = await browser.evaluate(`(() => {
            const header = document.querySelector(".previewbar"), banner = document.querySelector(".stage-review-banner");
            const current = document.querySelector("#live-preview-tab"), reviewed = document.querySelector("#design-tree-tab");
            const bounds = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, height:r.height }; };
            return { header:bounds(header), banner:bounds(banner), fits:header.scrollWidth <= header.clientWidth + 1,
                viewport:innerWidth, current:current.getAttribute("aria-current"), reviewed:reviewed.getAttribute("aria-current"),
                currentColor:getComputedStyle(current).backgroundColor, reviewedColor:getComputedStyle(reviewed).backgroundColor,
                reviewedUnderline:getComputedStyle(reviewed, "::after").display,
                controls:Array.from(document.querySelectorAll(".phase-actions > button:not([hidden])"), bounds),
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
        assert.ok(layout.banner.top >= layout.header.bottom - 1, JSON.stringify(layout));
        for (const control of layout.controls) {
            assert.ok(control.left >= layout.header.left - 1 && control.right <= layout.header.right + 1, JSON.stringify(layout));
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

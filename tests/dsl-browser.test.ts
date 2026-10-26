import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";
import { addUi } from "./helpers/ui-dsl-fixture.js";
import { decision, rendererFixtureScript, state } from "./helpers/react-harness.js";
import { SketchOperationStream } from "../src/sketch-stream.js";
import { createSketchUi } from "../src/sketch.js";

test("real browser shows design generation before the first view and keeps live feedback clear of the canvas", {
    skip: !browserAvailable, timeout: 60_000,
}, async t => {
    const initial = state("sketch");
    initial.requirements.substage = "dag";
    initial.decisionGraph.nodes = [decision("usage", "answered")];
    initial.processing = {
        action: "generate-sketch", status: "running", requestId: "design-request", runId: "design-run",
        requestedAt: new Date(Date.now() - 14_000).toISOString(),
        message: "Designing the primary screens from the accepted requirements.",
        sketchRequest: { generation: initial.generation, requirementsDigest: "requirements-1", baseRevisionId: null },
    };
    const [script, styles] = await Promise.all([
        rendererFixtureScript(),
        build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
            bundle: true, write: false, logLevel: "silent" }),
    ]);
    let origin: string;
    const unexpected: string[] = [];
    const server = createServer((request, response) => {
        const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
        const send = (type: string, body: string) => {
            response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
            response.end(body);
        };
        request.resume();
        if (path === "/") send("text/html", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">'
            + '<link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script><script>'
            + `window.designFixture = TandemTest.mount(); designFixture.flushSync(() => designFixture.store.accept(${JSON.stringify(initial)}));`
            + '</script></body></html>');
        else if (path === "/app.js") send("text/javascript", script);
        else if (path === "/styles.css") send("text/css", styles.outputFiles[0].text);
        else if (path === "/api/project-entry") send("application/json", JSON.stringify({ projectPath: "C:\\fixture-project", startingPath: "preparation" }));
        else if (path === "/api/project-entry/open") send("application/json", JSON.stringify({ developmentStarted: false, developmentContext: false }));
        else if (path === "/api/development/view") send("application/json", JSON.stringify({ url: `${origin}/conversation`, channel: "fixture-project" }));
        else if (path === "/api/sketch" && request.method === "GET") send("application/json", JSON.stringify({ sketch: initial.sketch, document: null }));
        else if (path === "/conversation") send("text/html", "<!doctype html><html><body>Fixture conversation</body></html>");
        else if (path === "/favicon.ico") { response.writeHead(204); response.end(); }
        else { unexpected.push(`${request.method} ${path}`); response.writeHead(404); response.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    const browser = await openFixtureBrowser(t);
    await browser.call("Page.navigate", { url: origin });
    await browser.waitFor('Boolean(document.querySelector("#sketch-generation")) && !document.querySelector("#studio-workspace").inert');
    const elapsed = await browser.evaluate('document.querySelector("#sketch-generation-elapsed").textContent');
    await browser.waitFor(`document.querySelector("#sketch-generation-elapsed").textContent !== ${JSON.stringify(elapsed)}`);
    for (const width of [1280, 942, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#sketch-generation-title").scrollIntoView({block:"center"})');
        const layout = await browser.evaluate(`(() => {
            const region = document.querySelector("#sketch-generation"), card = region.querySelector(".processing-state");
            const title = document.querySelector("#sketch-generation-title"), r = title.getBoundingClientRect();
            const bounds = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; };
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { region:bounds(region), card:bounds(card), title:bounds(title), titleVisible:hit === title || title.contains(hit),
                empty:region.dataset.empty, fits:card.scrollWidth <= card.clientWidth + 1,
                emptyPrompt:document.querySelector("#sketch-empty").checkVisibility(),
                approvalDisabled:document.querySelector("#sketch-approve").disabled };
        })()`);
        assert.equal(layout.empty, "true");
        assert.equal(layout.fits, true, JSON.stringify(layout));
        assert.equal(layout.titleVisible, true, `Generation feedback is reachable in the main area at ${width}: ${JSON.stringify(layout)}`);
        assert.ok(layout.card.left >= layout.region.left - 1 && layout.card.right <= layout.region.right + 1);
        assert.equal(layout.emptyPrompt, false);
        assert.equal(layout.approvalDisabled, true);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
            join(process.env.TANDEM_UI_EVIDENCE, `design-generation-${width}.png`), await browser.screenshot());
    }
    const outline = sketchDocument();
    outline.fidelity = "wireframe";
    outline.screens[0].title = "Menu";
    outline.screens[0].ui = createSketchUi("wireframe");
    outline.screens.push({ ...outline.screens[0], id: "details", title: "Drink details", ui: createSketchUi("wireframe") });
    const waiting = { ...initial, revision: 2, sketchPreview: {
        prototypeId: initial.prototypeId, ...initial.processing.sketchRequest,
        requestId: "design-request", runId: "design-run", sequence: 1, document: outline,
        screenStatuses: { main: "waiting", details: "waiting" },
    } };
    await browser.evaluate(`designFixture.flushSync(() => designFixture.store.accept(${JSON.stringify(waiting)}))`);
    await browser.waitFor('document.querySelectorAll("#sketch-screens [data-screen-status=waiting]").length === 2');
    for (const width of [1280, 942, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#sketch-page-status").scrollIntoView({block:"center"})');
        const layout = await browser.evaluate(`(() => {
            const status = document.querySelector("#sketch-page-status"), r = status.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { visible:status === hit || status.contains(hit), fits:status.scrollWidth <= status.clientWidth + 1,
                text:status.textContent, titles:[...document.querySelectorAll("#sketch-screens .sketch-screen-label")].map(el => el.textContent),
                placeholder:document.querySelector(".sketch-page-placeholder").textContent,
                busy:document.querySelector("#sketch-board").getAttribute("aria-busy") };
        })()`);
        assert.equal(layout.visible, true, `Selected page progress remains visible at ${width}: ${JSON.stringify(layout)}`);
        assert.equal(layout.fits, true, JSON.stringify(layout));
        assert.deepEqual(layout.titles, ["MenuWaiting", "Drink detailsWaiting"]);
        assert.match(layout.text, /Menu.*Waiting for design/);
        assert.match(layout.placeholder, /Menu.*Waiting for design/);
        assert.equal(layout.busy, "true");
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
            join(process.env.TANDEM_UI_EVIDENCE, `design-pages-waiting-${width}.png`), await browser.screenshot());
    }
    await browser.evaluate('document.querySelectorAll("#sketch-screens button")[1].click()');
    await browser.waitFor('document.querySelector("#sketch-page-status").textContent.includes("Drink details")');
    await browser.evaluate('document.querySelectorAll("#sketch-screens button")[0].click()');
    await browser.waitFor('document.querySelector("#sketch-page-status").textContent.includes("Menu")');
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
    addUi(outline.screens[0], "primary-action", "Button", { label: "Continue" });
    const live = { ...initial, revision: 2, sketchPreview: {
        prototypeId: initial.prototypeId, ...initial.processing.sketchRequest,
        requestId: "design-request", runId: "design-run", sequence: 2, document: outline,
        screenStatuses: { main: "processing", details: "waiting" },
    } };
    await browser.evaluate(`designFixture.flushSync(() => designFixture.store.accept(${JSON.stringify(live)}))`);
    await browser.waitFor('Boolean(document.querySelector("#sketch-board .dsl-view")?.shadowRoot?.querySelector("button"))');
    const layout = await browser.evaluate(`(() => {
        const status = document.querySelector("#sketch-generation"), workspace = document.querySelector("#sketch-workspace");
        return { empty:status.dataset.empty, message:document.querySelector("#sketch-generation-progress").textContent,
            statusBottom:status.getBoundingClientRect().bottom, workspaceTop:workspace.getBoundingClientRect().top,
            busy:document.querySelector("#sketch-approve").disabled };
    })()`);
    assert.equal(layout.empty, "false");
    assert.match(layout.message, /2 screens received.*live update 2/);
    assert.ok(layout.statusBottom <= layout.workspaceTop + 1, "The indicator must not overlay the arriving UI.");
    assert.equal(layout.busy, true, "Live updates are not saved approval.");
    assert.equal(await browser.evaluate('document.querySelector("#sketch-focus")'), null);
    assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector("button")).backgroundColor'),
        "rgb(51, 51, 51)", "New wireframes use the shared neutral kit, not a generated palette.");
    assert.equal(await browser.evaluate('document.querySelector("#sketch-screens button").dataset.screenStatus'), "processing");
    assert.equal(await browser.evaluate('document.querySelector(".sketch-page-placeholder")'), null);
    await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("#sketch-generation .processing-indicator")).animationName'), "none");
    assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("#sketch-page-status .processing-indicator")).animationName'), "none");
    if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
        join(process.env.TANDEM_UI_EVIDENCE, "design-generation-live.png"), await browser.screenshot());
    await browser.evaluate(`designFixture.flushSync(() => designFixture.store.accept(${JSON.stringify({
        ...live, sketchPreview: { ...live.sketchPreview, sequence: 3, screenStatuses: { main: "ready", details: "waiting" } },
    })}))`);
    await browser.waitFor('document.querySelector("#sketch-page-status").dataset.status === "ready"');
    assert.equal(await browser.evaluate('document.querySelector("#sketch-board").getAttribute("aria-busy")'), "false");
    assert.equal(await browser.evaluate('document.querySelector("#sketch-approve").disabled'), true);
    await browser.evaluate(`designFixture.flushSync(() => designFixture.store.accept(${JSON.stringify({
        ...initial, revision: 3, processing: { ...initial.processing, status: "error", message: "Design generation failed. Retry explicitly.",
            sketchRecovery: { phase: "content", preview: live.sketchPreview } },
    })}))`);
    await browser.waitFor('!document.querySelector("#sketch-generation")');
    assert.equal(await browser.evaluate('document.querySelector("#sketch-history-toggle").dataset.status'), "error");
    assert.equal(await browser.evaluate('document.querySelectorAll("#sketch-screens button").length'), 2);
    assert.equal(await browser.evaluate('document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector("button").textContent'), "Continue");
    assert.equal(await browser.evaluate('document.querySelector("#sketch-approve").disabled'), true);
    for (const width of [1280, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#sketch-retry-generation").scrollIntoView({block:"center"})');
        const recovery = await browser.evaluate(`(() => {
            const button = document.querySelector("#sketch-retry-generation"), r = button.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { visible: button === hit || button.contains(hit), disabled: button.disabled, width: r.width,
                text: document.querySelector("#sketch-status").textContent };
        })()`);
        assert.equal(recovery.visible, true, `Recovery stays reachable at ${width}: ${JSON.stringify(recovery)}`);
        assert.equal(recovery.disabled, false);
        assert.match(recovery.text, /incomplete preview/);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
            join(process.env.TANDEM_UI_EVIDENCE, `design-recovery-${width}.png`), await browser.screenshot());
    }
    assert.deepEqual(unexpected, []);
    assert.deepEqual(browser.exceptions, []);
});

test("real browser renders isolated DSL views, preserves size and zoom, and exports the same UI to PNG", {
    skip: !browserAvailable, timeout: 60_000,
}, async t => {
    const stream = new SketchOperationStream(sketchDocument(), ["usage"]);
    stream.append(JSON.stringify({ op: "ui", screenId: "main",
        edit: { op: "update", id: "primary-action", props: { icon: "trash-2" } } }) + "\n");
    stream.append(JSON.stringify({ op: "ui", screenId: "main",
        edit: { op: "add", parent: "screen", component: {
            id: "delete-icon", type: "Icon", props: { name: "trash-2", label: "Delete" },
        } } }) + '\n{"op":"done"}');
    const document = stream.complete();
    assert.ok(document.version === 2);
    const screen = document.screens[0];
    screen.width = 960; screen.height = 640; screen.title = "Task workspace";
    addUi(screen, "heading", "Heading", { text: "Your workspace" });
    addUi(screen, "description", "Text", { text: "Review the task, then choose Continue." });
    addUi(screen, "name", "Input", { label: "Task name", value: "Plan the release" });
    addUi(screen, "icon", "Icon", { name: "check", label: "Ready" });
    const script = await build({
        stdin: {
            contents: `
                import React, {useState} from "react";
                import {createRoot} from "react-dom/client";
                import {DslView} from "./src/renderer/dsl-view.js";
                import {SketchViewport} from "./src/renderer/sketch-viewport.js";
                import {renderSketchPng, SKETCH_SIZE_PRESETS} from "./src/renderer/sketch-editor.js";
                const original = ${JSON.stringify(screen)};
                function App() {
                    const [screen,setScreen] = useState(original);
                    const [selected,setSelected] = useState(null);
                    window.exportPng = () => renderSketchPng(screen);
                    return <div className="sketch-panel"><div className="sketch-stage"><div className="sketch-main">
                        <SketchViewport context="fixture" width={screen.width} height={screen.height} blocked={false}
                            sizeControl={<select id="sketch-size-preset" aria-label="Canvas size" onChange={e => {
                                const size = SKETCH_SIZE_PRESETS.find(s => s.id === e.target.value);
                                setScreen({...screen,width:size.width,height:size.height});
                            }}>{SKETCH_SIZE_PRESETS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>}
                            help={null}><div id="sketch-board" className="sketch-board"><DslView screen={screen}
                                selection={{nodeId:selected,picking:true,onSelect:setSelected}}/></div>
                        </SketchViewport>
                    </div></div></div>;
                }
                createRoot(document.getElementById("root")).render(<App/>);
            `,
            resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx",
        },
        bundle: true, write: false, platform: "browser", format: "iife",
        define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    });
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const server = createServer((request, response) => {
        response.setHeader("Content-Type", request.url === "/app.js" ? "text/javascript" : "text/html; charset=utf-8");
        response.end(request.url === "/app.js" ? script.outputFiles[0].text
            : `<!doctype html><html><head><style>${css}
                html,body,#root{height:100%;margin:0}.sketch-panel{height:100%}.sketch-main{flex:1}
                button{background:magenta !important}
                </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const browser = await openFixtureBrowser(t);
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
    await browser.waitFor(`document.querySelector(".dsl-view")?.shadowRoot?.querySelector('[data-ui-id="primary-action"]')`);
    await browser.evaluate(`document.getElementById("sketch-zoom-actual").click()`);
    await browser.waitFor(`document.getElementById("sketch-zoom").textContent === "100%"`);
    const observed = await browser.evaluate(`(async () => {
        const host = document.querySelector(".dsl-view");
        const button = host.shadowRoot.querySelector('[data-ui-id="primary-action"]');
        const field = host.shadowRoot.querySelector("input");
        const bg = getComputedStyle(button).backgroundColor;
        const png = await window.exportPng();
        const image = new Image();
        image.src = "data:image/png;base64," + png.data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width=image.width; canvas.height=image.height;
        const context=canvas.getContext("2d"); context.drawImage(image,0,0);
        const pixels=context.getImageData(0,0,image.width,image.height).data;
        let blue=0,ink=0;
        for(let i=0;i<pixels.length;i+=4){
            if(pixels[i]===9&&pixels[i+1]===105&&pixels[i+2]===218&&pixels[i+3]===255)blue++;
            if(pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100&&pixels[i+3]===255)ink++;
        }
        return {bg,value:field.value,width:image.width,height:image.height,blue,ink,
            icon:!!host.shadowRoot.querySelector('[data-icon="check"]'),
            trashIcons:host.shadowRoot.querySelectorAll('[data-icon="trash"]').length,
            saved:png.data,buttons:host.shadowRoot.querySelectorAll("button").length};
    })()`);
    assert.equal(observed.bg, "rgb(9, 105, 218)", "host styles must not recolor the DSL artifact");
    assert.equal(observed.value, "Plan the release");
    assert.equal(observed.icon, true);
    assert.equal(observed.trashIcons, 2, "Legacy icon aliases render their canonical bundled glyphs before PNG export.");
    assert.equal(observed.buttons, 1);
    assert.deepEqual([observed.width, observed.height], [960, 640]);
    assert.ok(observed.blue > 500 && observed.ink > 100, `PNG must contain the rendered controls and text: ${JSON.stringify({ blue: observed.blue, ink: observed.ink })}`);
    await browser.evaluate(`document.querySelector(".dsl-view").shadowRoot.querySelector('[data-ui-id="primary-action"]').click()`);
    await browser.waitFor(`document.querySelector(".dsl-view").shadowRoot.querySelector('[data-ui-id="primary-action"]').dataset.selected === "true"`);
    assert.equal(await browser.evaluate(`window.exportPng().then(result=>result.data)`), observed.saved, "Selection outlines must not enter approved images.");
    await browser.evaluate(`document.getElementById("sketch-zoom-out").click()`);
    await browser.waitFor(`document.getElementById("sketch-zoom").textContent === "80%"`);
    assert.equal(await browser.evaluate(`window.exportPng().then(result=>result.data)`), observed.saved, "view zoom cannot alter the approved raster");
    if (process.env.TANDEM_DSL_SCREENSHOT) await writeFile(
        process.env.TANDEM_DSL_SCREENSHOT.replace(/\.png$/, "-wide.png"), await browser.screenshot());
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 480, height: 760, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate(`document.getElementById("sketch-zoom-fit").click()`);
    await browser.waitFor(`parseFloat(document.getElementById("sketch-zoom").textContent)<100`);
    assert.equal(await browser.evaluate(`document.getElementById("sketch-board-wrap").scrollWidth <= document.getElementById("sketch-board-wrap").clientWidth + 1`), true);
    await browser.evaluate(`const size=document.getElementById("sketch-size-preset");size.value="hd-portrait";size.dispatchEvent(new Event("change",{bubbles:true}))`);
    await browser.waitFor(`document.getElementById("sketch-canvas").firstElementChild.style.height === "1920px"`);
    const portrait = await browser.evaluate(`(async()=>{const png=await window.exportPng();const image=new Image();image.src="data:image/png;base64,"+png.data;await image.decode();return [image.width,image.height]})()`);
    assert.deepEqual(portrait, [1080, 1920]);
    if (process.env.TANDEM_DSL_SCREENSHOT) await writeFile(process.env.TANDEM_DSL_SCREENSHOT, await browser.screenshot());
    assert.deepEqual(browser.exceptions, []);
});

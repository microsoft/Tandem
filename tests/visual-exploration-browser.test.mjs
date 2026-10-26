import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rendererFixtureScript } from "./helpers/react-harness.ts";
import { exploringPrototype } from "./helpers/visual-fixture.ts";
import { promotePrototypeCheckpoint, prototypePreviewCheckpointId, restoreOriginalPrototype, updateVisualSelection } from "../src/prototype-flow.ts";
import { prototypePreviewBridgeSource } from "../src/prototype-bridge.ts";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

const previewHtml = checkpointId => `<!doctype html><html><head>
<meta name="tandem-prototype-id" content="fixture"><meta name="tandem-prototype-checkpoint" content="${checkpointId}">
${["structure", "interaction"].includes(checkpointId) ? "" : '<meta name="tandem-visual-exploration" content="1">'}
<style>
:root{--tandem-text-scale:1;--tandem-spacing-scale:1;--tandem-accent:#1d4ed8;--tandem-accent-contrast:#fff;--tandem-motion-duration:0ms}
*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#182235;font:calc(16px * var(--tandem-text-scale))/1.5 system-ui}
html[data-tandem-color-mode=dark] body{background:#15202b;color:#f3f4f6}
#workspace{display:grid;grid-template-columns:140px minmax(0,1fr) 140px;grid-template-areas:"tools scene inspector";min-height:320px;gap:12px;padding:12px}
#tools{grid-area:tools;display:flex;flex-direction:column;gap:calc(12px * var(--tandem-spacing-scale));padding:calc(16px * var(--tandem-spacing-scale));border:1px solid currentColor}
#scene{grid-area:scene;min-height:200px;display:grid;place-content:center;border:1px solid currentColor;text-align:center}
#inspector{grid-area:inspector;border:1px solid currentColor;padding:12px}
button,input{font:inherit;max-width:100%}button{background:var(--tandem-accent);color:var(--tandem-accent-contrast);border:0;padding:6px;border-radius:4px}
button:focus-visible,input:focus-visible{outline:3px solid var(--tandem-accent);outline-offset:2px}
html[data-tandem-direction=canvas] #workspace{grid-template-columns:minmax(0,1fr) 180px;grid-template-areas:"scene inspector" "tools tools"}
html[data-tandem-direction=canvas] #tools{flex-direction:row;justify-content:center;border-radius:16px}
html[data-tandem-direction=presentation] #workspace{grid-template-columns:minmax(0,1fr);grid-template-areas:"tools" "scene" "inspector"}
html[data-tandem-direction=presentation] #tools{flex-direction:row;justify-content:space-between}
html[data-tandem-direction=presentation] #scene{font-family:Georgia,serif}
html[data-tandem-effects=subtle] #tools{box-shadow:0 4px 14px #0003;transition:box-shadow var(--tandem-motion-duration)}
@media(max-width:550px){#workspace{grid-template-columns:minmax(0,1fr)!important;grid-template-areas:"tools" "scene" "inspector"!important}#tools{flex-direction:row;flex-wrap:wrap}#inspector{min-height:70px}}
</style></head><body><main id="workspace"><nav id="tools" aria-label="Geometry tools"><button id="select-shape">Select shape</button><button id="reset-shape">Reset</button></nav>
<section id="scene"><h1>Geometry viewer</h1><p id="result" role="status">Selected 0</p></section>
<aside id="inspector"><label>Shape name <input id="shape-name" value="Cube"></label></aside></main>
<script>let count=0;document.querySelector("#select-shape").onclick=()=>document.querySelector("#result").textContent="Selected "+(++count);
document.querySelector("#reset-shape").onclick=()=>{count=0;document.querySelector("#result").textContent="Selected 0";};
window.tandemPreviewState={capture:()=>({count}),restore:value=>{count=value.count;document.querySelector("#result").textContent="Selected "+count;}};</script>
<script src="tandem-preview-bridge.js"></script></body></html>`;

test("real browser keeps the original as Default, shares the toolbar and explicitly accepts visual choices", {
  skip: !browserAvailable, timeout: 120000,
}, async t => {
  const script = await rendererFixtureScript();
  const [styles, theme] = await Promise.all([
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../development/tandem/public/project-theme.css", import.meta.url), "utf8"),
  ]);
  let state = exploringPrototype(), origin;
  const actions = [];
  const manifests = new Map([["visual-bundle", state.prototypeFlow.checkpoints.at(-1).visual.manifest]]);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const json = value => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div>
<script src="/renderer.js"></script><script>window.fixture=TandemTest.mount();fetch("/api/state").then(r=>r.json()).then(s=>fixture.flushSync(()=>fixture.store.accept(s)));</script></body></html>`);
      } else if (url.pathname === "/renderer.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(script); }
      else if (url.pathname === "/styles.css") { res.writeHead(200, { "Content-Type": "text/css" }); res.end(theme + "\n" + styles.replace(/^@import[^\n]+\n/, "")); }
      else if (url.pathname === "/api/state") json(state);
      else if (url.pathname === "/api/project-entry") json({ projectPath: "C:\\fixture-project", startingPath: "preparation" });
      else if (url.pathname === "/api/project-entry/open") json({ developmentStarted: false, developmentContext: false });
      else if (url.pathname === "/api/development/view") json({ url: origin + "/history", channel: "fixture" });
      else if (url.pathname === "/history") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<p>Saved discovery evidence</p>"); }
      else if (url.pathname === "/api/prototype/preview-status") {
        const target = url.searchParams.get("target") || "current";
        const id = prototypePreviewCheckpointId(state.prototypeFlow, target);
        const checkpoint = state.prototypeFlow.checkpoints.find(item => item.id === id);
        json({ generation: state.generation, checkpointId: id, pendingCheckpointId: state.prototypeFlow.pendingCheckpointId,
          url: checkpoint?.previewUrl, available: Boolean(checkpoint), reason: "" });
      } else if (url.pathname === "/api/prototype/action") {
        let text = ""; for await (const chunk of req) text += chunk;
        const input = JSON.parse(text); actions.push(input);
        if (input.action === "visual-preview") state.prototypeFlow = updateVisualSelection(state.prototypeFlow, input.checkpointId, input.selection);
        else if (input.action === "choose-visual") {
          const source = state.prototypeFlow.checkpoints.find(item => item.id === input.checkpointId);
          const manifest = structuredClone(source.visual.manifest);
          manifest.defaultSelection = input.selection;
          manifests.set("chosen", manifest);
          state.prototypeFlow.checkpoints.push({ ...source, id: "chosen", requestId: "chosen", sourceCheckpointId: source.id,
            previewUrl: origin + "/chosen/", visual: { operation: "choose", explorationCheckpointId: source.id, selection: input.selection, manifest } });
          state.prototypeFlow.pendingCheckpointId = "chosen";
        } else if (input.action === "apply-update") {
          state.prototypeFlow = promotePrototypeCheckpoint(state.prototypeFlow, input.checkpointId);
          state.previewUrl = state.prototypeFlow.checkpoints.find(item => item.id === input.checkpointId).previewUrl;
        } else if (input.action === "visual-original") {
          assert.equal(input.expectedRevision, state.revision);
          state.prototypeFlow = restoreOriginalPrototype(state.prototypeFlow, input.checkpointId);
          state.previewUrl = state.prototypeFlow.checkpoints.find(item => item.id === input.checkpointId).previewUrl;
        } else throw new Error("Unexpected browser action: " + input.action);
        json({ ...state, revision: ++state.revision });
      } else if (/^\/(?:structure|interaction|visual-bundle|chosen)\//.test(url.pathname)) {
        const id = url.pathname.split("/")[1];
        if (url.pathname.endsWith("tandem-visual-directions.json")) json(manifests.get(id));
        else if (url.pathname.endsWith("tandem-preview-bridge.js")) { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(prototypePreviewBridgeSource); }
        else { res.writeHead(200, { "Content-Type": "text/html" }); res.end(previewHtml(id)); }
      } else { res.writeHead(404); res.end("Unknown fixture route"); }
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  for (const checkpoint of state.prototypeFlow.checkpoints) checkpoint.previewUrl = origin + "/" + checkpoint.id + "/";
  state.previewUrl = origin + "/interaction/";
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await openFixtureBrowser(t);
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 960, deviceScaleFactor: 1, mobile: false });
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await browser.call("Page.navigate", { url: origin });
  await browser.waitFor('document.querySelector("#visual-direction-canvas") && !document.querySelector("#preview-frame").hidden');
  await browser.evaluate('document.querySelector("#toggle-discovery-history")?.click()');
  const click = async selector => {
    const point = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:"center"});
const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:Boolean(e.disabled),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
    assert.equal(point.disabled, false, selector + " is disabled");
    assert.equal(point.hit, true, selector + " is not reachable");
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point.x, y: point.y });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x, y: point.y });
  };
  const frameValue = expression => browser.evaluate(`(() => {const w=document.querySelector("#visual-preview-frame").contentWindow;return (${expression});})()`);
  const choose = async id => {
    await click("#visual-direction-" + id);
    await browser.waitFor(`document.querySelector("#visual-preview-frame").contentDocument?.documentElement?.dataset.tandemDirection===${JSON.stringify(id)}
      && !document.querySelector("#choose-visual-direction").disabled`);
  };
  const setting = async (key, value) => {
    await browser.evaluate(`(() => {const e=document.querySelector("#visual-setting-${key}");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
    await browser.waitFor('!document.querySelector("#choose-visual-direction").disabled');
  };
  await browser.waitFor('document.querySelector("#preview-frame").contentDocument?.querySelector("#select-shape")');
  assert.equal(await browser.evaluate('document.querySelector("#compare-current-prototype").getAttribute("aria-checked")'), "true");
  await browser.evaluate('(() => {const d=document.querySelector("#preview-frame").contentDocument;d.querySelector("#select-shape").click();d.querySelector("#shape-name").value="Original draft";})()');
  await choose("precision");
  await browser.evaluate('window.originalCurrent=document.querySelector("#preview-frame");window.originalVisual=document.querySelector("#visual-preview-frame");void 0;');
  await frameValue('w.document.querySelector("#select-shape").click()');
  const beforeTabs = actions.length;
  await click("#prototype-prototype-tab");
  await browser.waitFor('!document.querySelector("#preview-frame").hidden');
  assert.equal(state.prototypeFlow.displayedCheckpointId, "interaction");
  assert.deepEqual(await browser.evaluate('[...document.querySelectorAll("#prototype-milestones [role=tab]")].map(el=>el.dataset.milestone)'), ["prototype", "visual"]);
  assert.equal(await browser.evaluate('document.querySelector("#preview-frame").contentDocument.querySelector("#shape-name").value'), "Original draft");
  if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "combined-prototype.png"), await browser.screenshot());
  await click("#prototype-visual-tab");
  await browser.waitFor('document.querySelector("#visual-preview-frame").getBoundingClientRect().height>0');
  assert.equal(await frameValue('w.document.querySelector("#result").textContent'), "Selected 1");
  assert.equal(await browser.evaluate('window.originalVisual===document.querySelector("#visual-preview-frame") && window.originalCurrent===document.querySelector("#preview-frame")'), true);
  assert.equal(actions.length, beforeTabs, "Substage browsing never applies a checkpoint or changes the visual selection.");
  const geometry = async () => frameValue(`(() => {const t=w.document.querySelector("#tools").getBoundingClientRect(),s=w.document.querySelector("#scene").getBoundingClientRect();return {toolX:t.x,toolY:t.y,sceneX:s.x,sceneY:s.y};})()`);
  const precision = await geometry();
  await choose("canvas");
  const canvas = await geometry();
  await choose("presentation");
  const presentation = await geometry();
  assert.ok(Math.abs(precision.sceneX - canvas.sceneX) > 40, JSON.stringify({ precision, canvas }));
  assert.ok(Math.abs(canvas.toolY - presentation.toolY) > 80, JSON.stringify({ canvas, presentation }));
  assert.equal(await frameValue('w.document.querySelector("#result").textContent'), "Selected 1", "Direction changes retain the same interaction state.");
  assert.equal(await browser.evaluate('window.originalVisual===document.querySelector("#visual-preview-frame") && window.originalCurrent===document.querySelector("#preview-frame")'), true);
  await choose("canvas");
  await click("#visual-adjustments > summary");
  const before = await frameValue('({font:parseFloat(w.getComputedStyle(w.document.body).fontSize),padding:parseFloat(w.getComputedStyle(w.document.querySelector("#tools")).paddingTop),accent:w.getComputedStyle(w.document.querySelector("#select-shape")).backgroundColor})');
  await setting("textSize", "large"); await setting("density", "compact"); await setting("accent", "violet"); await setting("colorMode", "light");
  const after = await frameValue('({font:parseFloat(w.getComputedStyle(w.document.body).fontSize),padding:parseFloat(w.getComputedStyle(w.document.querySelector("#tools")).paddingTop),accent:w.getComputedStyle(w.document.querySelector("#select-shape")).backgroundColor,background:w.getComputedStyle(w.document.body).backgroundColor})');
  assert.ok(after.font - before.font >= 1.9, JSON.stringify({ before, after }));
  assert.ok(before.padding - after.padding >= 2, JSON.stringify({ before, after }));
  assert.notEqual(after.accent, before.accent);
  assert.equal(after.background, "rgb(248, 250, 252)");
  await setting("effects", "none");
  assert.equal(await frameValue('w.getComputedStyle(w.document.querySelector("#tools")).boxShadow'), "none");
  await setting("effects", "subtle");
  await browser.waitFor('getComputedStyle(document.querySelector("#visual-preview-frame").contentDocument.querySelector("#tools")).boxShadow!=="none"');
  assert.notEqual(await frameValue('w.getComputedStyle(w.document.querySelector("#tools")).boxShadow'), "none");
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await browser.waitFor('document.querySelector("#visual-preview-frame").contentDocument.documentElement.dataset.tandemEffects==="none"');
  assert.equal(await frameValue('w.getComputedStyle(w.document.querySelector("#tools")).transitionDuration'), "0s");
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  for (const [width, height] of [[1360, 960], [920, 620], [430, 850]]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('document.querySelector(".visual-exploration").scrollIntoView({block:"start"})');
    const bounds = await browser.evaluate('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,panel:document.querySelector(".visual-exploration").getBoundingClientRect().width})');
    assert.ok(bounds.scroll <= bounds.width + 1, "Visual controls must not overflow horizontally: " + JSON.stringify(bounds));
    assert.ok(bounds.panel > 240);
    const contrast = await frameValue('({background:w.getComputedStyle(w.document.body).backgroundColor,foreground:w.getComputedStyle(w.document.body).color})');
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255)
      .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
    const [bright, dark] = [luminance(contrast.background), luminance(contrast.foreground)].sort((a, b) => b - a);
    assert.ok((bright + .05) / (dark + .05) >= 4.5);
    if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `visual-exploration-${width}.png`), await browser.screenshot());
    if (width === 430) {
      await browser.evaluate('document.querySelector("#visual-preview-frame").scrollIntoView({block:"center"})');
      const rect = await browser.evaluate('(() => {const f=document.querySelector("#visual-preview-frame"),r=f.getBoundingClientRect();return {height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===f};})()');
      assert.ok(rect.height >= 300 && rect.hit, "Narrow preview must remain reachable: " + JSON.stringify(rect));
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "visual-exploration-430-preview.png"), await browser.screenshot());
    }
    for (const selector of ["#choose-visual-direction", "#retry-visual-preview", "#restart-exploration-preview"]) {
      const control = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:"center"});
const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
      assert.ok(control.left >= 0 && control.right <= control.width && control.height >= 28 && control.hit,
        `${selector} must remain reachable at ${width}px: ${JSON.stringify(control)}`);
    }
    if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `prototype-toolbar-${width}.png`), await browser.screenshot());
  }
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 960, deviceScaleFactor: 1, mobile: false });
  assert.equal(await browser.evaluate('document.querySelectorAll(".prototype-substage-bar .preview-recovery-action").length'), 2);
  assert.equal(await browser.evaluate('document.querySelector(".visual-exploration .preview-recovery-action")'), null);
  await click("#choose-visual-direction");
  await browser.waitFor('document.querySelector("#visual-custom-direction")?.dataset.applied==="true" && document.querySelector("#choose-visual-direction").disabled');
  assert.equal(state.prototypeFlow.displayedCheckpointId, "chosen");
  assert.equal(state.prototypeFlow.pendingCheckpointId, null);
  await browser.evaluate(`(() => {const f=document.createElement("iframe");f.id="standalone-chosen";f.hidden=true;f.src=${JSON.stringify(origin + "/chosen/")};document.body.append(f);})()`);
  await browser.waitFor('document.querySelector("#standalone-chosen").contentDocument?.documentElement?.dataset.tandemDirection==="canvas"');
  const defaults = await browser.evaluate('(() => {const r=document.querySelector("#standalone-chosen").contentDocument.documentElement;return {direction:r.dataset.tandemDirection,text:r.dataset.tandemTextSize,density:r.dataset.tandemDensity};})()');
  assert.deepEqual(defaults, { direction: "canvas", text: "large", density: "compact" });
  await browser.evaluate('document.querySelector("#standalone-chosen").remove()');
  await click("#compare-current-prototype");
  await browser.waitFor('!document.querySelector("#preview-frame").hidden && document.querySelector("#visual-preview-frame").hidden');
  assert.equal(await browser.evaluate('window.originalCurrent===document.querySelector("#preview-frame")'), true);
  assert.equal(await browser.evaluate('document.querySelector("#preview-frame").src'), origin + "/interaction/");
  assert.equal(await browser.evaluate('document.querySelector("#preview-frame").contentDocument.querySelector("#shape-name").value'), "Original draft");
  assert.equal(await browser.evaluate('document.querySelector("#preview-frame").contentDocument.querySelector("#result").textContent'), "Selected 1");
  assert.equal(state.prototypeFlow.displayedCheckpointId, "chosen", "Default previews the original without implicitly accepting it.");
  assert.equal(await browser.evaluate('!!document.querySelector(".prototype-substage-bar #restart-original-preview") && !document.querySelector("#restart-exploration-preview")'), true);
  if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "prototype-default.png"), await browser.screenshot());
  await click("#choose-visual-direction");
  await browser.waitFor('document.querySelector("#compare-current-prototype").dataset.applied==="true" && document.querySelector("#choose-visual-direction").disabled');
  assert.equal(state.prototypeFlow.displayedCheckpointId, "interaction");
  assert.equal(actions.filter(action => action.action === "choose-visual").length, 1);
  assert.equal(actions.filter(action => action.action === "apply-update").length, 1);
  assert.equal(actions.filter(action => action.action === "visual-original").length, 1);
  assert.deepEqual(browser.exceptions, []);
});

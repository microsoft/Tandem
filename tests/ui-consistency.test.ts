import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { isPrototypePreviewTarget, prototypePreviewCheckpointId } from "../src/prototype-flow.js";
import type { UiState } from "../src/renderer/ui-context.js";
import { decision, rendererFixtureScript } from "./helpers/react-harness.js";
import { readyPrototype } from "./renderer-fixtures.test.js";

test("active React surfaces use the shared controls rather than local native controls", async () => {
  for (const directory of ["../src/renderer/", "../src/browser/"]) {
    const root = new URL(directory, import.meta.url);
    for (const file of await readdir(root, { recursive: true })) {
      const relative = file.replaceAll("\\", "/");
      if (!relative.endsWith(".tsx") || relative.startsWith("ui/")) continue;
      const source = await readFile(new URL(relative, root), "utf8");
      assert.doesNotMatch(source, /<(?:button|input|textarea|select|dialog|details)\b/, `${directory}${file} bypasses the UI system`);
      assert.doesNotMatch(source, /<(?:div|nav|ul|ol|a|span)\b[^>]*\brole=["']tab(?:list)?["']/,
        `${directory}${file} must use the shared Tabs family, including its list`);
      for (const trigger of source.matchAll(/<Collapsible\.Trigger\b[^>]*>/g)) {
        assert.match(trigger[0], /\basChild\b/, `${file} must compose its collapsible trigger with a shared Button`);
      }
      assert.doesNotMatch(source, /import\s*\{[^}]*\b(?:Dialog|AlertDialog|Tabs|RadioGroup|ToggleGroup|Tooltip)\b[^}]*\}\s*from\s*["']radix-ui["']/,
        `${directory}${file} bypasses shared Radix styling`);
    }
  }
});

test("React, browser, Storybook and native Development share control styles across themes and sizes", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const [script, upstreamStyles, browserStyles, nativeStyles, catalogueStyles] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: fileURLToPath(new URL("../src/renderer/ui/", import.meta.url)), contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { Button, Input, Select, Textarea, Tabs, ToggleGroup, RadioGroup } from "./index.js";
        import { SubstageStatusIcon } from "../substage-status.js";
        createRoot(document.getElementById("root")).render(<main className="sample">
          <div className="revision-form">
            <Button id="save-appearance" variant="primary" className="plan-button">Save appearance</Button>
            <Button id="secondary" className="plan-button secondary">Cancel</Button>
            <Button id="disabled" disabled>Unavailable</Button>
            <Input id="name" aria-label="Name" value="Sample" readOnly />
            <Select id="choice" aria-label="Appearance"><option>System</option><option>Dark</option></Select>
            <Textarea id="notes" aria-label="Notes" value="Review the saved sample" readOnly />
          </div>
          {["catalogue", "stages", "requirements", "prototype"].map(example => <Tabs.Root key={example} data-example={example} defaultValue="one">
            <Tabs.List aria-label={example + " tabs"} className={example === "catalogue" ? undefined
              : "preview-tabs " + (example === "requirements" ? "requirements-substages" : example === "prototype" ? "prototype-milestones" : "")}>
              {["one", "two", "disabled"].map(value => <Tabs.Trigger key={value} value={value} disabled={value === "disabled"}
                className={example === "catalogue" ? undefined : "preview-tab" + (example === "stages" ? "" : " substage-tab")}>{value}</Tabs.Trigger>)}
            </Tabs.List>
            <Tabs.Content value="one">First panel</Tabs.Content><Tabs.Content value="two">Second panel</Tabs.Content>
          </Tabs.Root>)}
          <Tabs.Root defaultValue="first" data-example="long">
            <Tabs.Bar style={{maxWidth:240}}><Tabs.List aria-label="Long labels">
              <Tabs.Trigger id="long-first" value="first">Review saved requirements and previous decisions before continuing</Tabs.Trigger>
              <Tabs.Trigger id="long-second" value="second">Compare optional visual directions</Tabs.Trigger>
            </Tabs.List></Tabs.Bar>
            <Tabs.Content value="first">Saved requirements</Tabs.Content><Tabs.Content value="second">Optional directions</Tabs.Content>
          </Tabs.Root>
          <div><span id="number-badge" className="substage-index" aria-hidden="true">1</span>
            <SubstageStatusIcon status="running" label="Building" /></div>
          <ToggleGroup.Root type="single" defaultValue="one" aria-label="Example tools">
            <ToggleGroup.Item value="one">One</ToggleGroup.Item><ToggleGroup.Item value="two">Two</ToggleGroup.Item>
          </ToggleGroup.Root>
          <RadioGroup.Root defaultValue="one" aria-label="Example choice">
            <RadioGroup.Item value="one" presentation="choice">First choice</RadioGroup.Item>
            <RadioGroup.Item value="two" presentation="choice">Second choice</RadioGroup.Item>
          </RadioGroup.Root>
        </main>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    }),
    ...["../src/renderer/styles.css", "../src/browser/styles.css", "../development/tandem/public/application.css"].map(path =>
      build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, logLevel: "silent" })),
    build({
      stdin: { loader: "css", resolveDir: fileURLToPath(new URL("../.storybook/", import.meta.url)), contents: `
        @import "../development/tandem/public/project-theme.css";
        @import "../src/renderer/ui/styles.css";
        @import "./preview.css";
      ` },
      bundle: true, write: false, logLevel: "silent",
    }),
  ]);
  const native = `<main class="sample"><div class="settings-fields">
    <button id="save-appearance" type="button">Save appearance</button><button id="secondary" type="button">Cancel</button>
    <button id="disabled" type="button" disabled>Unavailable</button>
    <label>Name<input id="name" aria-label="Name" value="Sample" readonly></label>
    <label>Appearance<select id="choice" aria-label="Appearance"><option>System</option><option>Dark</option></select></label>
    <label>Notes<textarea id="notes" aria-label="Notes" readonly>Review the saved sample</textarea></label>
  </div></main>`;
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1");
    const isNative = url.pathname === "/native";
    const css = (isNative ? nativeStyles : url.pathname === "/browser" ? browserStyles
      : url.pathname === "/catalogue" ? catalogueStyles : upstreamStyles).outputFiles[0].text;
    const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html data-project-theme="${theme}" lang="en"><head><style>${css}</style>
      <style>html,body,#root{height:auto;min-height:100%;margin:0;overflow:auto}body{display:block}
      .sample{padding:16px;box-sizing:border-box}.sample>div{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px}
      .sample :is(input,select,textarea){max-width:100%;width:240px}</style></head>
      <body ${isNative ? `class="human-app" data-project-panel="conversation" data-theme="${theme}"` : ""}>
      ${isNative ? native : `<div id="root" ${url.pathname === "/browser" ? 'class="host-dialog"' : ""}></div><script>${script.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>`}
      </body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await openFixtureBrowser(t);
  const origin = `http://127.0.0.1:${address.port}`;
  for (const width of [1024, 375]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["light", "dark"]) {
      let expected: unknown;
      for (const surface of ["react", "browser", "catalogue", "native"]) {
        await browser.call("Page.navigate", { url: `${origin}/${surface}?theme=${theme}` });
        await browser.waitFor('Boolean(document.getElementById("secondary"))');
        const appearance = await browser.evaluate(`["save-appearance", "secondary", "disabled", "name", "choice", "notes"].map(id => {
          const element = document.getElementById(id), css = getComputedStyle(element);
          return {id, font:css.font, background:css.backgroundColor, color:css.color, border:css.border,
            radius:css.borderRadius, padding:css.padding, opacity:css.opacity, height:css.minHeight};
        })`);
        if (surface === "react") expected = appearance;
        else assert.deepEqual(appearance, expected, `${surface} differs from React at ${width}px / ${theme}`);
        if (surface !== "native") {
          const tabs = await browser.evaluate(`["catalogue", "stages", "requirements", "prototype"].map(example => {
            const root = document.querySelector("[data-example=" + example + "]");
            const style = (element, pseudo) => {
              const css = getComputedStyle(element, pseudo);
              return { font:css.font, color:css.color, background:css.backgroundColor, border:css.border,
                radius:css.borderRadius, padding:css.padding, margin:css.margin, gap:css.gap, height:css.minHeight,
                opacity:css.opacity, content:css.content, position:css.position, bottom:css.bottom };
            };
            return { list:style(root.querySelector("[role=tablist]")),
              tabs:[...root.querySelectorAll("[role=tab]")].map(tab => ({
                control:style(tab), before:style(tab, "::before"), after:style(tab, "::after")
              })) };
          })`);
          for (let index = 1; index < tabs.length; index++) {
            assert.deepEqual(tabs[index], tabs[0], `${surface} ${["catalogue", "stages", "requirements", "prototype"][index]} tabs differ from the catalogue at ${width}px / ${theme}`);
          }
          assert.equal(await browser.evaluate(`(() => {
            const list = document.querySelector("[data-example=long] [role=tablist]");
            return list.scrollWidth > list.clientWidth && list.getBoundingClientRect().width <= 240;
          })()`), true, "Long labels stay in a bounded horizontal scroller");
          assert.deepEqual(await browser.evaluate(`(() => {
            const badge = document.getElementById("number-badge").getBoundingClientRect();
            return {width:badge.width, height:badge.height};
          })()`), { width: 20, height: 20 }, `${surface} number badges must not depend on a global box-sizing reset`);
        }
        assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${surface} overflows at ${width}`);
      }
    }
  }
  await browser.call("Page.navigate", { url: `${origin}/react?theme=light` });
  await browser.waitFor('Boolean(document.querySelector("[role=tab]"))');
  const hoverStyles = [];
  for (const example of ["catalogue", "stages", "requirements", "prototype"]) {
    const point = await browser.evaluate(`(() => {
      const tab = document.querySelector("[data-example=${example}] [role=tab][data-state=inactive]:not(:disabled)");
      tab.scrollIntoView({block:"center", inline:"nearest"});
      const r = tab.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};
    })()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    hoverStyles.push(await browser.evaluate(`(() => {
      const css = getComputedStyle(document.querySelector("[data-example=${example}] [role=tab][data-state=inactive]:not(:disabled)"));
      return {background:css.backgroundColor, color:css.color, border:css.border};
    })()`));
  }
  for (const appearance of hoverStyles.slice(1)) assert.deepEqual(appearance, hoverStyles[0], "Feature hover styles match the catalogue");
  await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await browser.evaluate('document.querySelector("[role=tab]").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.waitFor('document.querySelector("[role=tab][aria-selected=true]").textContent === "two"');
  assert.equal(await browser.evaluate('document.activeElement.getAttribute("role")'), "tab");
  assert.equal(await browser.evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.waitFor('document.activeElement.textContent === "one"');
  assert.equal(await browser.evaluate('document.querySelector("[data-example=catalogue] [role=tab]:disabled").getAttribute("aria-selected")'), "false");
  await browser.evaluate('document.getElementById("long-first").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.waitFor('document.activeElement.id === "long-second"');
  assert.equal(await browser.evaluate(`(() => {
    const tab = document.activeElement.getBoundingClientRect(), list = document.activeElement.closest("[role=tablist]").getBoundingClientRect();
    return tab.left >= list.left - 1 && tab.right <= list.right + 1;
  })()`), true, "Keyboard focus scrolls a long tab into view");
  await browser.evaluate('document.querySelectorAll("[data-ui=toggle]")[1].click();document.querySelectorAll("[data-ui=radio]")[1].click()');
  await browser.waitFor('document.querySelectorAll("[data-ui=toggle]")[1].dataset.state === "on" && document.querySelectorAll("[data-ui=radio]")[1].dataset.state === "checked"');
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  assert.equal(await browser.evaluate('getComputedStyle(document.getElementById("secondary")).borderStyle'), "solid");
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".substage-status .tandem-spin")).animationName'), "none");
  await browser.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await browser.waitFor('matchMedia("(pointer: coarse)").matches');
  assert.equal(await browser.evaluate('[...document.querySelectorAll("[role=tab]")].every(tab => tab.getBoundingClientRect().height >= 44)'), true);
  assert.deepEqual(browser.exceptions, []);
});

test("Requirements and Prototype share sub-tab bars in the real application", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const initial: UiState = readyPrototype();
  initial.requirements = { substage: "dag", usageItems: ["Inspect saved decisions and previews."], suggestions: [] };
  initial.decisionGraph.nodes = [decision("Interface validation approach", "answered")];
  const [script, styles] = await Promise.all([
    rendererFixtureScript(),
    build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
      bundle: true, write: false, logLevel: "silent" }),
  ]);
  let origin: string;
  const unexpected: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1"), path = url.pathname;
    const target = url.searchParams.get("target") || "current";
    const send = (type: string, body: string) => {
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(body);
    };
    request.resume();
    if (path === "/") send("text/html", '<!doctype html><html lang="en" data-project-theme="light"><head>'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>'
      + '<body><div id="root"></div><script src="/app.js"></script><script>'
      + 'window.__renderMermaid = async () => ({svg:\'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="10" y="30">Saved decision</text></svg>\'});'
      + `window.navigationFixture = TandemTest.mount(); navigationFixture.flushSync(() => navigationFixture.store.accept(${JSON.stringify(initial)}));`
      + '</script></body></html>');
    else if (path === "/app.js") send("text/javascript", script);
    else if (path === "/styles.css") send("text/css", styles.outputFiles[0].text);
    else if (path === "/api/project-entry") send("application/json", JSON.stringify({ projectPath: "C:\\fixture-project", startingPath: "preparation" }));
    else if (path === "/api/project-entry/open") send("application/json", JSON.stringify({ developmentStarted: false, developmentContext: false }));
    else if (path === "/api/development/view") send("application/json", JSON.stringify({ url: `${origin}/conversation`, channel: "fixture-project" }));
    else if (path === "/api/development/model-selection") send("application/json", JSON.stringify({ required: false }));
    else if (path === "/api/sketch" && request.method === "GET") send("application/json", JSON.stringify({ sketch: initial.sketch, document: null }));
    else if (path === "/api/prototype/preview-status" && isPrototypePreviewTarget(target)) {
      send("application/json", JSON.stringify({
        generation: initial.generation, checkpointId: prototypePreviewCheckpointId(initial.prototypeFlow, target),
        pendingCheckpointId: null, url: initial.previewUrl, available: true, reason: "",
      }));
    } else if (path === "/conversation" || path === "/preview") send("text/html", "<!doctype html><html><body>Synthetic navigation fixture</body></html>");
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
  initial.previewUrl = `${origin}/preview`;
  for (const checkpoint of initial.prototypeFlow!.checkpoints) checkpoint.previewUrl = initial.previewUrl;
  const browser = await openFixtureBrowser(t);
  await browser.call("Page.navigate", { url: origin });
  await browser.waitFor('Boolean(document.querySelector("#open-preview")) && !document.querySelector("#studio-workspace").inert');
  assert.equal(await browser.evaluate('Boolean(document.querySelector("#design-tree-phase"))'), false,
    "Saved Requirements omits the redundant phase badge without removing its decisions");
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".artifact-library-nav")).marginBottom'), "8px",
    "The shared list preserves the sidebar artifact library's intentional spacing");
  await browser.evaluate('window.navigationPreview = document.querySelector("#preview-frame"); void 0');
  const select = async (id: string) => {
    await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new MouseEvent("mousedown", {bubbles:true, button:0}))`);
    await browser.waitFor(`document.getElementById(${JSON.stringify(id)}).getAttribute("aria-selected") === "true"`);
  };
  for (const width of [1440, 375]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["light", "dark"]) {
      await browser.evaluate(`document.documentElement.dataset.projectTheme = ${JSON.stringify(theme)}`);
      const snapshots = [];
      for (const [stage, tab, selector] of [
        ["requirements", "design-tree-workspace-tab", ".requirements-substages"],
        ["prototype", "live-preview-workspace-tab", "#prototype-milestones"],
      ]) {
        await select(tab);
        const snapshot = await browser.evaluate(`(() => {
          const list = document.querySelector(${JSON.stringify(selector)}), bar = list.closest("[data-ui=tab-bar]");
          if (!bar) throw new Error("Missing shared tab bar for " + ${JSON.stringify(stage)});
          const style = element => {
            const css = getComputedStyle(element);
            return { font:css.font, background:css.backgroundColor, color:css.color, border:css.border,
              borderBottom:css.borderBottom, radius:css.borderRadius, padding:css.padding, margin:css.margin,
              gap:css.gap, minHeight:css.minHeight, shadow:css.boxShadow };
          };
          const bounds = element => {
            const r = element.getBoundingClientRect();
            return {left:r.left, right:r.right, top:r.top, bottom:r.bottom, height:r.height};
          };
          const actions = bar.querySelector(".prototype-preview-actions");
          return { appearance:{bar:style(bar), list:style(list),
              active:style(list.querySelector("[aria-selected=true]")), inactive:style(list.querySelector("[aria-selected=false]"))},
            shared:list.dataset.ui === "tab-list", bar:bounds(bar), list:bounds(list),
            tabs:[...list.querySelectorAll("[role=tab]")].map(bounds),
            actions:actions && bounds(actions), actionsOutsideList:!actions || !list.contains(actions),
            fits:bar.scrollWidth <= bar.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth,
            progress:${JSON.stringify(stage)} === "prototype" ? style(document.querySelector("#prototype-progress")) : null };
        })()`);
        assert.equal(snapshot.shared, true, `${stage} must use the shared tab list`);
        assert.equal(snapshot.fits, true, `${stage} navigation overflows at ${width}px / ${theme}`);
        assert.equal(snapshot.actionsOutsideList, true, "Preview actions stay outside tab keyboard navigation");
        assert.equal(snapshot.bar.height >= snapshot.tabs[0].height, true);
        assert.equal(snapshot.tabs[0].top, snapshot.bar.top, "Sub-tabs do not gain stage-specific top padding");
        if (snapshot.actions?.height) {
          assert.ok(snapshot.actions.right <= snapshot.bar.right + 1 && snapshot.actions.bottom <= snapshot.bar.bottom + 1);
          assert.ok(snapshot.actions.left >= snapshot.list.right - 1 || snapshot.actions.top >= snapshot.list.bottom - 1,
            "Preview controls must not overlap the tab list");
        }
        if (snapshot.progress) {
          assert.equal(snapshot.progress.padding, "0px", "Prototype must not wrap its shared tab bar in another padded card");
          assert.equal(snapshot.progress.radius, "0px");
        }
        snapshots.push(snapshot);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
          join(process.env.TANDEM_UI_EVIDENCE, `subtabs-${stage}-${theme}-${width}.png`), await browser.screenshot());
      }
      assert.deepEqual(snapshots[1].appearance, snapshots[0].appearance, `Sub-tab styles differ at ${width}px / ${theme}`);
      assert.equal(snapshots[1].tabs[0].height, snapshots[0].tabs[0].height, "Equivalent sub-tabs have equal rendered heights");
    }
  }
  await select("design-tree-workspace-tab");
  await browser.evaluate('document.querySelector("#usage-substage").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.waitFor('document.activeElement.id === "dag-substage"');
  assert.equal(await browser.evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid");
  await select("live-preview-workspace-tab");
  assert.equal(await browser.evaluate('document.querySelector("#preview-frame") === navigationPreview'), true);
  assert.equal(await browser.evaluate('navigationFixture.store.getSnapshot().state.lifecycle.currentStage'), "prototype");
  assert.deepEqual(unexpected, [], "Browsing tabs must not submit work or use unhandled fixture endpoints");
  assert.deepEqual(browser.exceptions, []);
});

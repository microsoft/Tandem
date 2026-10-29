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
import { decision, rendererFixtureScript, state } from "./helpers/react-harness.js";
import { readyPrototype, sketchFixture } from "./renderer-fixtures.test.js";
import { addUi, applyOperations } from "./helpers/ui-dsl-fixture.js";
import { exploringPrototype } from "./helpers/visual-fixture.js";
import { requirementsResearchInput } from "../src/requirements-research.js";

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
            <Input id="invalid" aria-label="Invalid name" aria-invalid="true" value="" readOnly />
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
            <ToggleGroup.Item value="one" iconOnly aria-label="First tool">1</ToggleGroup.Item>
            <ToggleGroup.Item value="two" iconOnly aria-label="Second tool">2</ToggleGroup.Item>
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
    <label>Invalid name<input id="invalid" aria-label="Invalid name" aria-invalid="true" value="" readonly></label>
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
        const appearance = await browser.evaluate(`["save-appearance", "secondary", "disabled", "name", "invalid", "choice", "notes"].map(id => {
          const element = document.getElementById(id), css = getComputedStyle(element);
          return {id, font:css.font, background:css.backgroundColor, color:css.color, border:css.border,
            radius:css.borderRadius, padding:css.padding, opacity:css.opacity, height:css.minHeight};
        })`);
        if (surface === "react") expected = appearance;
        else assert.deepEqual(appearance, expected, `${surface} differs from React at ${width}px / ${theme}`);
        const focus = await browser.evaluate(`["name", "choice", "notes"].map(id => {
          const input = document.getElementById(id);
          const size = () => {
            const {width, height} = input.getBoundingClientRect();
            return {width, height, borderWidth:getComputedStyle(input).borderWidth};
          };
          input.blur();
          const unfocused = size(), border = getComputedStyle(input).borderColor;
          input.focus();
          const css = getComputedStyle(input);
          return {id, unfocused, focused:size(), border, focusedBorder:css.borderColor, outline:css.outlineStyle};
        })`);
        for (const input of focus) {
          assert.deepEqual(input.focused, input.unfocused, `${surface} ${input.id} changes geometry on focus`);
          assert.notEqual(input.focusedBorder, input.border, `${surface} ${input.id} must highlight its existing border`);
          assert.equal(input.outline, "none", `${surface} ${input.id} must not gain an extra focus outline`);
        }
        assert.equal(await browser.evaluate(`(() => {
          const input = document.getElementById("invalid"), border = getComputedStyle(input).borderColor;
          input.focus();
          return getComputedStyle(input).borderColor === border;
        })()`), true, `${surface} must retain an invalid field's error border while editing`);
        if (surface !== "native") {
          const tabs = await browser.evaluate(`["catalogue", "stages", "requirements", "prototype"].map(example => {
            const root = document.querySelector("[data-example=" + example + "]");
            const style = (element, pseudo) => {
              const css = getComputedStyle(element, pseudo);
              return { font:css.font, color:css.color, background:css.backgroundColor, border:css.border,
                radius:css.borderRadius, padding:css.padding, margin:css.margin, gap:css.gap, height:css.minHeight,
                opacity:css.opacity, content:css.content, position:css.position, bottom:css.bottom, shadow:css.boxShadow };
            };
            return { list:style(root.querySelector("[role=tablist]")),
              tabs:[...root.querySelectorAll("[role=tab]")].map(tab => ({
                control:style(tab), before:style(tab, "::before"), after:style(tab, "::after")
              })) };
          })`);
          for (let index = 1; index < tabs.length; index++) {
            assert.deepEqual(tabs[index], tabs[0], `${surface} ${["catalogue", "stages", "requirements", "prototype"][index]} tabs differ from the catalogue at ${width}px / ${theme}`);
          }
          assert.match(tabs[0].tabs[0].control.shadow, /0px -3px 0px(?: 0px)? inset$/, "Selected tabs use a bottom-edge accent");
          assert.equal(tabs[0].tabs[0].after.content, "none", "Selected tabs do not retain a bottom underline");
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
  assert.equal(await browser.evaluate('[...document.querySelectorAll("[data-ui=toggle]")].every(toggle => { const r = toggle.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })'), true,
    "Icon toggles keep square touch targets, not narrow 30px columns");
  assert.deepEqual(browser.exceptions, []);
});

test("Design inspector panes share headers and surfaces while retaining readable, accessible editing", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const fixture = sketchFixture(), initial: UiState = fixture.value, screen = fixture.document.screens[0];
  screen.title = "Calculator";
  screen.purpose = "Enter and edit an arithmetic expression, evaluate it, and view the result.";
  screen.notes = "Supports addition, subtraction, multiplication, and division.";
  for (let index = 0; index < 24; index++) addUi(screen, `row-${index}`, "Text", { text: `Saved calculation ${index + 1}` });
  let parent = screen.ui.root;
  for (let index = 0; index < 10; index++) {
    const id = `nested-${index}`;
    screen.ui = applyOperations(screen.ui, [{ op: "add", parent, component: { id, type: "Stack", props: {} } }]);
    parent = id;
  }
  screen.ui = applyOperations(screen.ui, [{ op: "move", id: "primary-action", parent }]);
  fixture.document.transitions.push({ id: "calculate", fromScreenId: screen.id, toScreenId: screen.id,
    trigger: "Calculate", description: "Evaluate the expression and show the result." });
  initial.sketch.history = Array.from({ length: 16 }, (_, index) => ({
    ...initial.sketch.current!, id: `saved-${index}`, number: index + 1,
  }));
  const original = JSON.stringify(fixture.document);
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
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body);
    };
    request.resume();
    if (path === "/") send("text/html", '<!doctype html><html lang="en" data-project-theme="light"><head>'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>'
      + '<body><div id="root"></div><script src="/app.js"></script><script>'
      + `window.paneFixture = TandemTest.mount(); paneFixture.flushSync(() => paneFixture.store.accept(${JSON.stringify(initial)}));`
      + '</script></body></html>');
    else if (path === "/app.js") send("text/javascript", script);
    else if (path === "/styles.css") send("text/css", styles.outputFiles[0].text);
    else if (path === "/api/project-entry") send("application/json", JSON.stringify({ projectPath: "C:\\fixture-project", startingPath: "preparation" }));
    else if (path === "/api/project-entry/open") send("application/json", JSON.stringify({ developmentStarted: false, developmentContext: false }));
    else if (path === "/api/development/view") send("application/json", JSON.stringify({ url: `${origin}/conversation`, channel: "fixture-project" }));
    else if (path === "/api/development/model-selection") send("application/json", JSON.stringify({ required: false }));
    else if (path === "/api/sketch" && request.method === "GET") send("application/json", JSON.stringify({ sketch: initial.sketch, document: fixture.document }));
    else if (path === "/conversation") send("text/html", "<!doctype html><html><body>Synthetic pane fixture</body></html>");
    else if (path === "/favicon.ico") { response.writeHead(204); response.end(); }
    else { unexpected.push(`${request.method} ${path}`); response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  const browser = await openFixtureBrowser(t);
  await browser.call("Page.navigate", { url: origin });
  await browser.waitFor('Boolean(document.querySelector("[data-node-id=nested-9]")) && !document.querySelector("#sketch-title").disabled && !document.querySelector("#studio-workspace").inert');
  for (const [width, height] of [[1440, 850], [1000, 850], [375, 850], [1440, 540]]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["light", "dark"]) {
      await browser.evaluate(`document.documentElement.dataset.projectTheme = ${JSON.stringify(theme)};
        document.querySelector(".sketch-screen-details").open = false;`);
      for (const pane of ["transitions", "history"]) {
        await browser.evaluate(`document.getElementById("sketch-toggle-${pane}").click()`);
        await browser.waitFor(`!document.getElementById(${JSON.stringify(pane === "transitions" ? "sketch-screen-transitions" : "sketch-revision-history")}).hidden`);
        const layout = await browser.evaluate(`(() => {
          const appearance = element => {
            const css = getComputedStyle(element);
            return {background:css.backgroundColor, border:css.border, radius:css.borderRadius};
          };
          const header = element => {
            const css = getComputedStyle(element.querySelector(".sketch-pane-heading"));
            return {font:css.font, color:css.color, padding:css.padding, gap:css.gap, minHeight:css.minHeight};
          };
          const panes = [...document.querySelectorAll(".sketch-pane")].filter(element => !element.hidden);
          const main = document.querySelector(".sketch-main"), board = main.querySelector(".sketch-board-wrap");
          const side = main.querySelector(".sketch-side-pane:not([hidden])"), br = board.getBoundingClientRect(), sr = side.getBoundingClientRect();
          return {panes:panes.map(appearance), headers:panes.map(header),
            bodyPadding:panes.map(element => getComputedStyle(element.querySelector(".sketch-pane-body")).padding),
            fits:document.documentElement.scrollWidth <= innerWidth && document.querySelector("#sketch-workspace").scrollWidth <= document.querySelector("#sketch-workspace").clientWidth + 1,
            boardWidth:br.width, boardHeight:br.height,
            overlaps:br.left < sr.right && br.right > sr.left && br.top < sr.bottom && br.bottom > sr.top,
            sidebarScrollsLocally:getComputedStyle(document.querySelector(".sketch-sidebar")).overflowY === "auto",
            bodyScrollsLocally:getComputedStyle(side.querySelector(".sketch-pane-body")).overflowY === "auto"};
        })()`);
        for (const appearance of layout.panes) assert.deepEqual(appearance, layout.panes[0], `Pane surfaces differ at ${width}x${height} / ${theme}`);
        for (const header of layout.headers) assert.deepEqual(header, layout.headers[0], `Pane headers differ at ${width}x${height} / ${theme}`);
        assert.ok(layout.bodyPadding.every(padding => padding === "8px"), "Pane bodies share the spacing scale");
        assert.equal(layout.fits, true, `Pane layout overflows at ${width}x${height} / ${theme}`);
        assert.equal(layout.overlaps, false, "Opening a side pane never covers the design canvas");
        assert.ok(layout.boardWidth >= 100 && layout.boardHeight >= 60, `Canvas stays usable at ${width}x${height}: ${JSON.stringify(layout)}`);
        assert.equal(layout.sidebarScrollsLocally && layout.bodyScrollsLocally, true);
        await browser.evaluate('document.querySelector(".sketch-board-wrap").scrollIntoView({block:"nearest"})');
        assert.equal(await browser.evaluate(`(() => {
          const board = document.querySelector(".sketch-board-wrap"), r = board.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return board === hit || board.contains(hit);
        })()`), true, "The canvas remains reachable when a narrow workspace needs vertical scrolling");
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
          join(process.env.TANDEM_UI_EVIDENCE, `design-panes-${pane}-${theme}-${width}-${height}.png`), await browser.screenshot());
        await browser.evaluate('document.querySelector(".sketch-side-pane:not([hidden]) button[aria-label^=Close]").click()');
        await browser.waitFor(`document.activeElement.id === "sketch-toggle-${pane}" && document.querySelector(".sketch-main").dataset.sidePaneOpen === "false"`);
      }
    }
  }
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 850, deviceScaleFactor: 1, mobile: false });
  await browser.evaluate('document.querySelector("#sketch-structure-tree button").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35 });
  await browser.waitFor('document.querySelector("[data-node-id=primary-action]").getAttribute("aria-selected") === "true"');
  assert.equal(await browser.evaluate(`(() => {
    const tree = document.querySelector("#sketch-structure-tree"), r = tree.getBoundingClientRect();
    const row = tree.querySelector("[aria-selected=true]"), label = row.querySelector(".sketch-node-label").getBoundingClientRect();
    return tree.scrollLeft > 0 && label.width >= 40 && label.left >= r.left && label.right <= r.right + 1;
  })()`), true, "Deeply nested labels remain readable and keyboard selection reveals them horizontally");
  await browser.evaluate('document.querySelector(".sketch-screen-details").open = true; document.querySelector("#sketch-purpose").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await browser.waitFor('Boolean(document.querySelector("#sketch-purpose-error"))');
  assert.equal(await browser.evaluate(`(() => {
    const field = document.querySelector("#sketch-purpose"), error = document.getElementById(field.getAttribute("aria-describedby"));
    error.scrollIntoView({block:"nearest"});
    return error.checkVisibility() && error.closest(".sketch-screen-details") !== null
      && document.querySelector("#sketch-save").disabled && document.querySelector("#sketch-request-history-pane").hidden;
  })()`), true, "Invalid fields expose their own readable errors without opening history");
  await browser.call("Input.insertText", { text: "Evaluate an arithmetic expression." });
  await browser.waitFor('!document.querySelector("#sketch-purpose-error")');
  if (process.env.TANDEM_UI_EVIDENCE) {
    await browser.evaluate('document.documentElement.dataset.projectTheme = "light"; document.querySelector(".sketch-sidebar").scrollTop = 0;');
    await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "design-inspector-details-light.png"), await browser.screenshot());
  }
  await browser.evaluate('document.querySelector("#sketch-toggle-transitions").click()');
  await browser.waitFor('!document.querySelector("#sketch-screen-transitions").hidden');
  await browser.evaluate('document.querySelector("#sketch-transition-calculate-trigger").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await browser.waitFor('document.querySelector("#sketch-screen-transitions").hidden && document.activeElement.id === "sketch-toggle-transitions"');
  assert.equal(await browser.evaluate('document.querySelector("#sketch-purpose").value'), "Evaluate an arithmetic expression.", "Dismissal retains unsaved edits");
  assert.equal(await browser.evaluate('document.querySelector("#sketch-instruction").getAttribute("aria-describedby").split(" ").every(id => document.getElementById(id))'), true,
    "The feedback editor references existing help rather than a retired selection section");
  await browser.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await browser.waitFor('matchMedia("(pointer: coarse)").matches');
  assert.equal(await browser.evaluate(`[...document.querySelectorAll("#sketch-structure-tree button, #sketch-pane-selector button, .sketch-pane > summary")].every(element => {
    const r = element.getBoundingClientRect(); return r.width >= 44 && r.height >= 44;
  })`), true, "Tree rows, disclosure headers and pane toggles retain usable touch targets");
  assert.equal(JSON.stringify(fixture.document), original, "Inspecting the fixture does not mutate its saved source");
  assert.deepEqual(unexpected, [], "Pane navigation and local editing do not submit work");
  assert.deepEqual(browser.exceptions, []);
});

test("Project settings scrolls to the last control in short windows without hiding the dialog header", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const initial = state("requirements");
  const [script, styles, nativeStyles, nativeHtml] = await Promise.all([
    rendererFixtureScript(),
    build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
      bundle: true, write: false, logLevel: "silent" }),
    build({ entryPoints: [fileURLToPath(new URL("../development/tandem/public/application.css", import.meta.url))],
      bundle: true, write: false, logLevel: "silent" }),
    readFile(new URL("../development/tandem/public/human-loop.html", import.meta.url), "utf8"),
  ]);
  const nativeServer = createServer((request, response) => {
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (path === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(nativeHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
        .replace('<body class="human-app"', '<body data-project-panel="settings" class="human-app"')
        .replace("</body>", '<script>document.querySelector("#canvas-settings").open=true;'
          + 'document.querySelector("#project-effort-settings").hidden=false;</script></body>'));
    } else if (path === "/application.css") {
      response.writeHead(200, { "Content-Type": "text/css" }); response.end(nativeStyles.outputFiles[0].text);
    } else if (path === "/favicon.ico" || path.startsWith("/branding/")) { response.writeHead(204); response.end(); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => nativeServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { nativeServer.closeAllConnections(); nativeServer.close(() => resolve()); }));
  const nativeAddress = nativeServer.address();
  assert.ok(nativeAddress && typeof nativeAddress !== "string");
  const nativeOrigin = `http://127.0.0.1:${nativeAddress.port}/`;
  const server = createServer((request, response) => {
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const send = (type: string, body: string) => {
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(body);
    };
    request.resume();
    if (path === "/") send("text/html", '<!doctype html><html lang="en" data-project-theme="light"><head>'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>'
      + '<body><div id="root"></div><script src="/app.js"></script><script>'
      + `window.settingsFixture = TandemTest.mount(); settingsFixture.flushSync(() => settingsFixture.store.accept(${JSON.stringify(initial)}));`
      + '</script></body></html>');
    else if (path === "/app.js") send("text/javascript", script);
    else if (path === "/styles.css") send("text/css", styles.outputFiles[0].text);
    else if (path === "/api/project-entry") send("application/json", JSON.stringify({ projectPath: "C:\\fixture-project", startingPath: "preparation" }));
    else if (path === "/api/project-entry/open") send("application/json", JSON.stringify({ developmentStarted: false, developmentContext: false }));
    else if (path === "/api/development/view") send("application/json", JSON.stringify({ url: nativeOrigin, channel: "fixture-project" }));
    else if (path === "/api/development/model-selection") send("application/json", JSON.stringify({ required: false }));
    else if (path === "/favicon.ico" || path.startsWith("/branding/")) { response.writeHead(204); response.end(); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await openFixtureBrowser(t);
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 480, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: origin });
  await browser.waitFor('Boolean(document.querySelector("#project-settings")) && !document.querySelector("#studio-workspace").inert');
  await browser.evaluate('document.querySelector("#project-settings").click()');
  await browser.waitFor('document.querySelector("#project-settings-frame")?.contentWindow && document.querySelector("#project-settings-frame").clientHeight>0');
  const inside = async (expression: string) => {
    const tree = await browser.call("Page.getFrameTree");
    const frame = tree.frameTree.childFrames?.find((item: { frame: { url: string } }) => item.frame.url === nativeOrigin + "?panel=settings");
    assert.ok(frame, "The real settings dialog loads its separate-origin native controls.");
    const world = await browser.call("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "settings-scroll-ui" });
    const result = await browser.call("Runtime.evaluate", { contextId: world.executionContextId, expression, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  for (const [width, height] of [[800, 480], [390, 480], [390, 240]]) for (const theme of ["light", "dark"]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate(`document.documentElement.dataset.projectTheme=${JSON.stringify(theme)}`);
    await inside(`document.body.dataset.theme=${JSON.stringify(theme)}`);
    await browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await browser.evaluate('document.querySelector(".project-settings-dialog").scrollTop=0');
    const body = await inside(`(() => {
      const scroller = document.querySelector("#canvas-settings");
      const first = document.querySelector("#setting-theme"), last = document.querySelector("#open-rendering-debugger");
      first.focus(); scroller.scrollTop = 0;
      const start = scroller.scrollTop;
      last.focus();
      const area = scroller.getBoundingClientRect(), control = last.getBoundingClientRect();
      return { overflow:getComputedStyle(scroller).overflowY,
        gutter:scroller.offsetWidth-scroller.clientWidth,
        start, end:scroller.scrollTop, scrollable:scroller.scrollHeight>scroller.clientHeight,
        bodyBounded:area.height<=innerHeight,
        lastVisible:control.top>=area.top&&control.bottom<=area.bottom,
        focused:document.activeElement===last, pageOverflow:document.documentElement.scrollWidth>innerWidth };
    })()`);
    const layout = { ...body, ...await browser.evaluate(`(() => {
      const dialog = document.querySelector(".project-settings-dialog"), close = dialog.querySelector("#close-project-settings");
      const button = close.getBoundingClientRect();
      return {
        headerVisible:document.elementFromPoint(button.x+button.width/2,button.y+button.height/2)===close,
        outerScrollable:dialog.scrollHeight>dialog.clientHeight&&getComputedStyle(dialog).overflowY==="auto",
        frameHeight:dialog.querySelector("iframe").clientHeight };
    })()`) };
    assert.equal(layout.overflow, "auto");
    assert.ok(layout.gutter > 0 && layout.scrollable && layout.bodyBounded && !layout.pageOverflow,
      `The settings body has a visible, bounded vertical scrollbar at ${width}x${height}/${theme}: ${JSON.stringify(layout)}`);
    assert.ok(layout.start === 0 && layout.end > 0 && layout.lastVisible && layout.focused,
      `Keyboard focus reaches the last setting at ${width}x${height}/${theme}: ${JSON.stringify(layout)}`);
    assert.ok(layout.frameHeight >= 44, "Even very short windows retain a usable settings viewport.");
    if (height >= 480) assert.ok(layout.headerVisible, "Scrolling settings leaves the dialog header and Close button visible.");
    else assert.ok(layout.outerScrollable, "The outer dialog also scrolls when the header cannot fit.");
    if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `settings-scroll-${width}x${height}-${theme}.png`), await browser.screenshot());
  }
  assert.deepEqual(browser.exceptions, []);
});

test("pre-development stages preserve shared panes, navigation and feedback in the real application", { skip: !browserAvailable, timeout: 90_000 }, async t => {
  const initial: UiState = readyPrototype();
  const design = sketchFixture();
  initial.sketch = design.value.sketch;
  initial.goal = "A math calculator";
  initial.preparation = {
    ...initial.preparation, status: "ready", summary: "The workspace is ready for requirements.",
    workItems: [{ id: "inspect", title: "Inspect workspace", status: "completed", detail: "Inspect the existing workspace.",
      result: "No project files were found. Existing reviewed choices are preserved." }],
    checks: [
      { label: "Workspace", status: "ready", detail: "Workspace inspection completed." },
      { label: "Implementation tooling", status: "deferred", detail: "Check runtime readiness in Development." },
    ],
    suggestedUsages: ["Evaluate an arithmetic expression."],
    messages: [{ id: "ready", kind: "info", at: initial.updatedAt, text: "Preparation completed. Requirements are ready." }],
  };
  initial.requirements = { substage: "dag", usageItems: ["Inspect saved decisions and previews."], suggestions: [] };
  initial.requirements.research = {
    generation: initial.generation, requestId: "research", runId: "research-run", completedAt: initial.updatedAt,
    input: requirementsResearchInput(initial), summary: "Research retained the accepted calculator scope.",
    checks: initial.preparation.checks, sources: [],
  };
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
    else if (path === "/api/sketch" && request.method === "GET") send("application/json", JSON.stringify({ sketch: initial.sketch, document: design.document }));
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
        assert.match(snapshot.appearance.bar.borderBottom, /^1px solid /, "The tab bar keeps its bottom border");
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
        if (stage === "prototype") {
          const feedback = await browser.evaluate(`(() => {
            const input = document.querySelector("#revision-input");
            const size = () => {
              const {width, height} = input.getBoundingClientRect();
              return {width, height};
            };
            input.blur();
            const unfocused = size();
            const border = getComputedStyle(input).borderColor;
            input.focus();
            const css = getComputedStyle(input);
            return {unfocused, focused:size(), resize:css.resize, outline:css.outlineStyle, border, focusedBorder:css.borderColor};
          })()`);
          assert.ok(feedback.unfocused.width > 0 && feedback.unfocused.height > 0, "Feedback stays visible");
          assert.deepEqual(feedback.focused, feedback.unfocused, `Focusing feedback must not resize it at ${width}px / ${theme}`);
          assert.equal(feedback.resize, "none", "Feedback must not allow manual resizing");
          assert.equal(feedback.outline, "none", "Feedback does not gain an extra focus outline");
          assert.notEqual(feedback.focusedBorder, feedback.border, "Feedback highlights its own border on focus");
          await browser.call("Input.insertText", { text: "First feedback line\nSecond feedback line\nThird feedback line\n" });
          assert.deepEqual(await browser.evaluate(`(() => {
            const input = document.querySelector("#revision-input"), {width, height} = input.getBoundingClientRect();
            return {width, height, scrolls:input.scrollHeight > input.clientHeight};
          })()`), { ...feedback.unfocused, scrolls: true }, "Long feedback scrolls inside the fixed-size input");
          await browser.evaluate('document.querySelector("#revision-input").blur()');
        }
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
  initial.prototypeFlow = exploringPrototype().prototypeFlow;
  initial.revision++;
  for (const checkpoint of initial.prototypeFlow!.checkpoints) checkpoint.previewUrl = initial.previewUrl;
  await browser.evaluate(`navigationFixture.flushSync(() => navigationFixture.store.accept(${JSON.stringify(initial)}))`);
  await browser.waitFor('Boolean(document.querySelector(".visual-exploration")) && Boolean(document.querySelector(".sketch-screens-pane"))');
  await browser.evaluate('document.querySelector(".sketch-screen-details").open = true');
  for (const [width, height] of [[1440, 850], [375, 850], [1440, 540]]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["light", "dark"]) {
      await browser.evaluate(`document.documentElement.dataset.projectTheme = ${JSON.stringify(theme)}`);
      const panes = [];
      const insets = [];
      for (const [stage, tab, subtab, selectors] of [
        ["preparation", "preparation-workspace-tab", null,
          [".preparation-brief", ".preparation-stage-main > section", ".preparation-stage-sidebar > section"]],
        ["requirements-usage", "design-tree-workspace-tab", "usage-substage",
          ["#requirements-substage-section", "#requirements-research"]],
        ["requirements-dag", "design-tree-workspace-tab", "dag-substage", ["#design-tree-card"]],
        ["designs", "sketch-workspace-tab", null, [".sketch-screens-pane", ".sketch-screen-details", ".sketch-structure"]],
        ["prototype-visual", "live-preview-workspace-tab", "prototype-visual-tab", [".visual-exploration"]],
      ] as const) {
        await select(tab);
        if (subtab) await select(subtab);
        const snapshot = await browser.evaluate(`(() => {
          const sample = element => {
            const css = getComputedStyle(element);
            return {background:css.backgroundColor, border:css.border, radius:css.borderRadius};
          };
          const header = element => {
            const css = getComputedStyle(element);
            return {font:css.font, color:css.color, padding:css.padding, minHeight:css.minHeight,
              borderBottom:css.borderBottom, gap:css.gap, direction:css.flexDirection, justify:css.justifyContent};
          };
          const panes = ${JSON.stringify(selectors)}.flatMap(selector => [...document.querySelectorAll(selector)]);
          const panel = document.getElementById(${JSON.stringify(tab.replace("-workspace-tab", "-panel"))});
          return {
            panes:panes.map(pane => ({
              surface:sample(pane), heading:header(pane.querySelector(".tandem-pane-heading, .sketch-pane-heading")),
              inset:pane.querySelector(".tandem-pane-body, .sketch-pane-body, .design-tree-body")
                && getComputedStyle(pane.querySelector(".tandem-pane-body, .sketch-pane-body, .design-tree-body")).padding
            })),
            inset:getComputedStyle(panel).padding,
            fits:document.documentElement.scrollWidth <= innerWidth && panel.scrollWidth <= panel.clientWidth + 1,
          };
        })()`);
        assert.ok(snapshot.panes.length >= selectors.length, `${stage} must render its real panes`);
        assert.equal(snapshot.fits, true, `${stage} overflows at ${width}x${height} / ${theme}`);
        assert.equal(snapshot.inset, "8px", `${stage} must use the shared outer inset`);
        for (const pane of snapshot.panes) {
          assert.equal(pane.inset, "8px", `${stage} must use the shared body inset`);
          panes.push(pane);
        }
        insets.push(snapshot.inset);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
          join(process.env.TANDEM_UI_EVIDENCE, `upstream-${stage}-${theme}-${width}-${height}.png`), await browser.screenshot());
      }
      for (const pane of panes) assert.deepEqual(pane, panes[0],
        `Stage pane treatments differ at ${width}x${height} / ${theme}`);
      assert.equal(new Set(insets).size, 1);
      const badges = await browser.evaluate(`(() => {
        const style = element => {
          const css = getComputedStyle(element);
          return {font:css.font, radius:css.borderRadius, padding:css.padding, border:css.border,
            color:css.color, background:css.backgroundColor};
        };
        return [...document.querySelectorAll(".tandem-badge")].map(badge => ({
          tone:badge.dataset.tone, text:badge.textContent, style:style(badge),
          flex:getComputedStyle(badge).flexGrow
        }));
      })()`);
      assert.ok(badges.some(badge => badge.text === "deferred" && badge.tone === "neutral"));
      for (const badge of badges) {
        const sameTone = badges.find(other => other.tone === badge.tone)!;
        assert.deepEqual(badge.style, sameTone.style, "Equivalent Preparation and research badges share a style");
        assert.equal(badge.style.font.includes("12px"), true);
        assert.equal(badge.style.radius, "6px");
        assert.equal(badge.flex, "0", "Status badges never stretch to fill their pane header");
      }
    }
  }
  await select("design-tree-workspace-tab");
  await select("usage-substage");
  await browser.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector("#requirements-research > summary").focus();
    resolve();
  })))`);
  assert.equal(await browser.evaluate('document.activeElement === document.querySelector("#requirements-research > summary")'), true);
  assert.equal(await browser.evaluate('document.querySelector("#requirements-research").open'), true);
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.waitFor('!document.querySelector("#requirements-research").open');
  assert.equal(await browser.evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid");
  assert.equal(await browser.evaluate('navigationFixture.store.getSnapshot().state.lifecycle.currentStage'), "prototype");
  const intake: UiState = {
    ...initial, revision: initial.revision + 1, stage: "requirements",
    lifecycle: { ...initial.lifecycle, currentStage: "requirements", completedStages: ["prepare"] },
    requirements: { ...initial.requirements, substage: "usage",
      suggestions: ["Edit an expression before evaluating it.", "Read the result of the calculation."] },
  };
  await browser.evaluate(`navigationFixture.flushSync(() => navigationFixture.store.accept(${JSON.stringify(intake)}))`);
  await browser.waitFor('!document.querySelector("#usage-intake").hidden && !document.querySelector("#add-usage").disabled');
  for (const width of [1440, 375]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
    for (const theme of ["light", "dark"]) {
      await browser.evaluate(`document.documentElement.dataset.projectTheme = ${JSON.stringify(theme)}`);
      const layout = await browser.evaluate(`(() => {
        const panel = document.querySelector("#requirements-substage-section");
        const input = document.querySelector("#usage-input");
        return {fits:panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= innerWidth,
          enabled:!input.disabled, width:input.getBoundingClientRect().width,
          inset:getComputedStyle(panel.querySelector(".tandem-pane-body")).padding,
          suggestions:panel.querySelectorAll(".usage-suggestion").length};
      })()`);
      assert.equal(layout.fits && layout.enabled, true, `Active usage intake must fit at ${width}px / ${theme}`);
      assert.ok(layout.width >= 100);
      assert.equal(layout.inset, "8px");
      assert.equal(layout.suggestions, 2);
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
        join(process.env.TANDEM_UI_EVIDENCE, `upstream-usage-intake-${theme}-${width}.png`), await browser.screenshot());
    }
  }
  assert.deepEqual(unexpected, [], "Browsing tabs must not submit work or use unhandled fixture endpoints");
  assert.deepEqual(browser.exceptions, []);
});

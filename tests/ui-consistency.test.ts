import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

test("active React surfaces use the shared controls rather than local native controls", async () => {
  for (const directory of ["../src/renderer/", "../src/browser/"]) {
    const root = new URL(directory, import.meta.url);
    for (const file of await readdir(root, { recursive: true })) {
      const relative = file.replaceAll("\\", "/");
      if (!relative.endsWith(".tsx") || relative.startsWith("ui/")) continue;
      const source = await readFile(new URL(relative, root), "utf8");
      assert.doesNotMatch(source, /<(?:button|input|textarea|select|dialog|details)\b/, `${directory}${file} bypasses the UI system`);
      for (const trigger of source.matchAll(/<Collapsible\.Trigger\b[^>]*>/g)) {
        assert.match(trigger[0], /\basChild\b/, `${file} must compose its collapsible trigger with a shared Button`);
      }
      assert.doesNotMatch(source, /import\s*\{[^}]*\b(?:Dialog|AlertDialog|Tabs|RadioGroup|ToggleGroup|Tooltip)\b[^}]*\}\s*from\s*["']radix-ui["']/,
        `${directory}${file} bypasses shared Radix styling`);
    }
  }
});

test("React, browser and native Development share control styles across themes and sizes", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const [script, upstreamStyles, browserStyles, nativeStyles] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: fileURLToPath(new URL("../src/renderer/ui/", import.meta.url)), contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { Button, Input, Select, Textarea, Tabs, ToggleGroup, RadioGroup } from "./index.js";
        createRoot(document.getElementById("root")).render(<main className="sample">
          <div className="revision-form">
            <Button id="save-appearance" variant="primary" className="plan-button">Save appearance</Button>
            <Button id="secondary" className="plan-button secondary">Cancel</Button>
            <Button id="disabled" disabled>Unavailable</Button>
            <Input id="name" aria-label="Name" value="Sample" readOnly />
            <Select id="choice" aria-label="Appearance"><option>System</option><option>Dark</option></Select>
            <Textarea id="notes" aria-label="Notes" value="Review the saved sample" readOnly />
          </div>
          <Tabs.Root defaultValue="one"><Tabs.List aria-label="Example tabs">
            <Tabs.Trigger value="one">One</Tabs.Trigger><Tabs.Trigger value="two">Two</Tabs.Trigger>
          </Tabs.List><Tabs.Content value="one">First panel</Tabs.Content><Tabs.Content value="two">Second panel</Tabs.Content></Tabs.Root>
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
    const css = (isNative ? nativeStyles : url.pathname === "/browser" ? browserStyles : upstreamStyles).outputFiles[0].text;
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
      for (const surface of ["react", "browser", "native"]) {
        await browser.call("Page.navigate", { url: `${origin}/${surface}?theme=${theme}` });
        await browser.waitFor('Boolean(document.getElementById("secondary"))');
        const appearance = await browser.evaluate(`["save-appearance", "secondary", "disabled", "name", "choice", "notes"].map(id => {
          const element = document.getElementById(id), css = getComputedStyle(element);
          return {id, font:css.font, background:css.backgroundColor, color:css.color, border:css.border,
            radius:css.borderRadius, padding:css.padding, opacity:css.opacity, height:css.minHeight};
        })`);
        if (surface === "react") expected = appearance;
        else assert.deepEqual(appearance, expected, `${surface} differs from React at ${width}px / ${theme}`);
        assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${surface} overflows at ${width}`);
      }
    }
  }
  await browser.call("Page.navigate", { url: `${origin}/react?theme=light` });
  await browser.waitFor('Boolean(document.querySelector("[role=tab]"))');
  await browser.evaluate('document.querySelector("[role=tab]").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await browser.waitFor('document.querySelector("[role=tab][aria-selected=true]").textContent === "Two"');
  assert.equal(await browser.evaluate('document.activeElement.getAttribute("role")'), "tab");
  assert.equal(await browser.evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid");
  await browser.evaluate('document.querySelectorAll("[data-ui=toggle]")[1].click();document.querySelectorAll("[data-ui=radio]")[1].click()');
  await browser.waitFor('document.querySelectorAll("[data-ui=toggle]")[1].dataset.state === "on" && document.querySelectorAll("[data-ui=radio]")[1].dataset.state === "checked"');
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  assert.equal(await browser.evaluate('getComputedStyle(document.getElementById("secondary")).borderStyle'), "solid");
  assert.deepEqual(browser.exceptions, []);
});

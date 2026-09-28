import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packageExtension } from "../scripts/package-extension.mjs";
import { browserAvailable } from "./helpers/browser-fixture.mjs";
import { humanLoopUiFixture } from "./helpers/human-loop-ui-fixture.mjs";

test("CLI browser surface uses safe native tabs without Host navigation, workflow sends or automatic shutdown",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await humanLoopUiFixture(t, { surface: "browser",
      openBrowser: async () => assert.fail("Ordinary browser links must not call the Host canvas API.") });
    assert.equal(await f.evaluate("document.body.dataset.tandemSurface"), "browser");
    assert.equal(await f.evaluate("getComputedStyle(document.querySelector('#browser-session-guidance')).display"), "block");
    const original = (await f.browser.call("Target.getTargets")).targetInfos.filter(item => item.type === "page").map(item => item.targetId);
    await f.evaluate("document.querySelector('#messages a').click()");
    await new Promise(done => setTimeout(done, 50));
    assert.equal(f.destinationRequests(), 0, "Synthetic clicks do not have navigation authority.");
    const activate = [
      () => f.click("#messages a"),
      () => f.click("#messages a", { modifiers: 2 }),
      () => f.click("#messages a", { button: "middle" }),
      async () => {
        await f.evaluate("document.querySelector('#messages a').focus()");
        await f.browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
        await f.browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      },
    ];
    for (let i = 0; i < activate.length; i++) {
      await f.browser.call("Page.bringToFront");
      await activate[i]();
      let tabs = [];
      for (let attempt = 0; attempt < 100; attempt++) {
        tabs = (await f.browser.call("Target.getTargets")).targetInfos.filter(item => item.type === "page" && !original.includes(item.targetId));
        if (tabs.length && f.destinationRequests() === i + 1) break;
        await new Promise(done => setTimeout(done, 20));
      }
      assert.equal(tabs.length, 1);
      assert.equal(tabs[0].url, f.destination);
      assert.equal(tabs[0].canAccessOpener, false);
      assert.equal(f.destinationRequests(), i + 1);
      await f.browser.call("Target.closeTarget", { targetId: tabs[0].targetId });
      assert.equal(await f.evaluate("document.querySelector('#current-state-title').textContent"), "Ready");
    }
    await f.browser.call("Page.bringToFront");
    assert.deepEqual(await f.evaluate("(()=>{const a=document.querySelector('#messages a');return {target:a.target,rel:a.rel}})()"),
      { target: "_blank", rel: "noopener noreferrer" });
    for (const href of ["javascript:document.body.dataset.executed='yes'", "file:///C:/secret", "https://user:secret@example.invalid/"]) {
      await f.evaluate(`(()=>{const a=document.querySelector('#messages a');a.href=${JSON.stringify(href)}})()`);
      await f.click("#messages a");
      await f.until("!document.querySelector('#notice').hidden");
      assert.match(await f.evaluate("document.querySelector('#notice').textContent"), /HTTP\(S\)/);
    }
    assert.equal(await f.evaluate("document.body.dataset.executed??null"), null);
    assert.equal(f.destinationRequests(), 4);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.state.requests, []);
    for (const theme of ["light", "dark"]) {
      await f.evaluate(`document.body.dataset.theme='${theme}'`);
      for (const width of [1280, 390, 320]) {
        await f.browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await f.evaluate("window.scrollTo(0,0);document.querySelector('#notice').hidden=true");
        assert.equal(await f.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
        if (process.env.UI_SURFACE_EVIDENCE) {
          await mkdir(process.env.UI_SURFACE_EVIDENCE, { recursive: true });
          await writeFile(join(process.env.UI_SURFACE_EVIDENCE, `cli-browser-${theme}-${width}.png`), await f.browser.screenshot());
        }
      }
    }
    assert.deepEqual(f.browser.exceptions, []);
  });

test("packaged Rendering debugger opens under the real provider without any Host browser capability",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const root = await mkdtemp(join(import.meta.dirname, ".debugger-package-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const outputDirectory = join(root, "package");
    await packageExtension({ outputDirectory });
    const f = await humanLoopUiFixture(t, { sandbox: true, publicDirectory: join(outputDirectory, "public") });
    await f.click("#canvas-settings summary");
    await f.click("#open-rendering-debugger");
    await f.until("document.querySelector('#rendering-debugger-frame').contentDocument?.querySelector('#validation-status')?.textContent.startsWith('Valid sketch-design/v3')");
    assert.equal(await f.evaluate("document.querySelector('#rendering-debugger-error').hidden"), true);
    await f.evaluate("document.querySelector('#rendering-debugger-frame').contentDocument.querySelector('#json-input').focus()");
    await f.browser.call("Input.insertText", { text: "invalid JSON" });
    await f.evaluate("document.querySelector('#rendering-debugger-frame').contentDocument.querySelector('#validate-input').click()");
    await f.until("!document.querySelector('#rendering-debugger-frame').contentDocument.querySelector('#validation-error').hidden");
    await f.click("#close-rendering-debugger");
    await f.until("document.activeElement.id==='open-rendering-debugger'");
    await f.browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await f.browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await f.until("document.querySelector('#rendering-debugger').open");
    assert.match(await f.evaluate("document.querySelector('#rendering-debugger-frame').contentDocument.querySelector('#json-input').value"), /invalid JSON/);
    await f.evaluate("document.querySelector('#rendering-debugger-frame').src='sketch/missing-debugger.html'");
    await f.until("!document.querySelector('#rendering-debugger-error').hidden");
    assert.match(await f.evaluate("document.querySelector('#rendering-debugger-error').textContent"), /could not load/);
    assert.deepEqual(f.requests, []);
    assert.equal(f.state.requests.length, 0);
    assert.deepEqual(f.browser.exceptions, []);
  });

test("validated navigation endpoint opens Host UI only, without a runtime request or permissive cross-origin route",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const opened = [];
    const f = await humanLoopUiFixture(t, { openBrowser: async (...args) => { opened.push(args); return { instanceId: "browser" }; } });
    const response = await f.post({ url: f.destination, focus: false });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { opened: true, instanceId: "browser" });
    assert.deepEqual(opened, [[f.destination, { focus: false }]]);
    for (const data of [
      { url: "javascript:alert(1)", focus: true }, { url: "file:///C:/secret", focus: true },
      { url: "https://user:pass@example.invalid/", focus: true }, { url: "/relative", focus: true },
      { url: f.destination, focus: "true" }, { url: f.destination, focus: true, hiddenRequest: "run code" },
    ]) assert.equal((await f.post(data)).status, 409);
    assert.equal((await f.post({ url: f.destination, focus: true }, { origin: "https://example.invalid" })).status, 409);
    assert.equal((await f.post({ url: f.destination, focus: true }, { "sec-fetch-site": "cross-site" })).status, 409);
    assert.equal(opened.length, 1);
    assert.deepEqual(f.requests, []);
    assert.equal(f.state.requests.length, 0);
  });

test("sandboxed Review and owned-preview links use trusted click/keyboard/modifier navigation exactly once",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const calls = [], entered = Promise.withResolvers(), release = Promise.withResolvers();
    let hold = true, fail = false;
    t.after(() => release.resolve());
    const f = await humanLoopUiFixture(t, { sandbox: true, openBrowser: async (url, options) => {
      calls.push({ url, ...options });
      if (hold) { entered.resolve(); await release.promise; }
      if (fail) throw new Error("Host refused navigation");
      return { instanceId: "same-browser-panel" };
    } });
    const before = await f.browser.call("Target.getTargets");
    const linkBefore = await f.evaluate("(()=>{const a=document.querySelector('#messages a');return{href:a.href,target:a.target,rel:a.rel}})()");
    assert.equal(linkBefore.href, f.destination);
    assert.equal(linkBefore.target, "_blank");
    await f.evaluate("document.querySelector('#messages a').click()");
    await new Promise(done => setTimeout(done, 60));
    assert.equal(calls.length, 0, "Scripted clicks are not user navigation authority.");
    try {
      await f.click("#messages a"); await entered.promise;
      await f.until("document.querySelector('#messages a').getAttribute('aria-busy')==='true'");
      await f.click("#messages a");
      assert.equal(calls.length, 1, "Repeated clicks while an opening is pending must not double-open.");
    } finally { hold = false; release.resolve(); }
    await f.until("!document.querySelector('#messages a').hasAttribute('aria-busy')");
    assert.deepEqual(calls[0], { url: f.destination, focus: true });
    await f.click("#canvas-settings summary");
    await f.click("#open-diagnostics");
    await f.click("#apps a", { modifiers: 2 });
    await f.until("!document.querySelector('#apps a').hasAttribute('aria-busy')");
    assert.deepEqual(calls.at(-1), { url: f.destination, focus: false }, "Ctrl/Cmd-style activation requests background placement.");
    await f.click("#apps a", { button: "middle" });
    await f.until("!document.querySelector('#apps a').hasAttribute('aria-busy')");
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1).focus, false);
    await f.evaluate("document.querySelector('#messages a').focus()");
    await f.browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await f.browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await f.until("!document.querySelector('#messages a').hasAttribute('aria-busy')");
    assert.equal(calls.length, 4);
    assert.equal(calls.at(-1).focus, true);
    fail = true;
    await f.click("#messages a");
    await f.until("!document.querySelector('#notice').hidden && document.querySelector('#notice').textContent.includes('Host refused navigation')");
    assert.equal(calls.length, 5);
    assert.equal(await f.evaluate("document.querySelector('#messages a').href"), f.destination, "Address remains available to copy after failure.");
    fail = false;
    await f.click("#messages a");
    await f.until("!document.querySelector('#messages a').hasAttribute('aria-busy')");
    assert.equal(await f.evaluate("document.querySelector('#notice').hidden"), true, "A successful retry removes only the prior link notice.");
    for (const address of ["javascript:document.body.dataset.executed='yes'", "https://user:secret@example.invalid/", "file:///C:/secret"]) {
      await f.evaluate(`(()=>{document.querySelector('#bad-link')?.remove();const a=document.createElement('a');a.id='bad-link';a.href=${JSON.stringify(address)};a.textContent='Unsupported link';document.querySelector('#messages').append(a)})()`);
      await f.click("#bad-link");
      await f.until("document.querySelector('#notice').textContent.includes('HTTP(S)')");
    }
    assert.equal(calls.length, 6, "Invalid schemes/credentials never reach the provider opener.");
    assert.equal(await f.evaluate("document.body.dataset.executed??null"), null);
    const after = await f.browser.call("Target.getTargets");
    assert.deepEqual(after.targetInfos.filter(target => target.type === "page").map(target => target.targetId).sort(),
      before.targetInfos.filter(target => target.type === "page").map(target => target.targetId).sort(),
      `No native iframe popup or replacement navigation is used: ${JSON.stringify({
        before: before.targetInfos, after: after.targetInfos, destinationRequests: f.destinationRequests(),
      })}`);
    assert.equal(f.destinationRequests(), 0);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.browser.exceptions, []);
  });

test("missing Host navigation capability produces a visible error rather than pretending to open",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await humanLoopUiFixture(t, { sandbox: true });
    await f.click("#messages a");
    await f.until("document.querySelector('#notice').textContent.includes('Host browser navigation is unavailable')");
    assert.equal(await f.evaluate("document.querySelector('#notice').hidden"), false);
    assert.deepEqual(f.requests, []);
    assert.equal(f.destinationRequests(), 0);
  });

test("scripted link clicks cannot fall through to native popup navigation outside a sandbox",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const calls = [];
    const f = await humanLoopUiFixture(t, { openBrowser: async (...args) => { calls.push(args); return { instanceId: "browser" }; } });
    await f.click("#canvas-settings summary");
    await f.click("#open-diagnostics");
    await f.evaluate("document.querySelector('#messages a').click()");
    await new Promise(done => setTimeout(done, 200));
    assert.equal(calls.length, 0);
    assert.equal(f.destinationRequests(), 0, "An untrusted activation must be denied, not delegated to target=_blank.");
    assert.equal(await f.evaluate("document.querySelector('#current-state-title').textContent"), "Ready");
  });

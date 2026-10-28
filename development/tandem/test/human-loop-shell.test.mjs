import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import test from "node:test";
import { browserAvailable, openFixtureBrowser } from "./helpers/browser-fixture.mjs";
import { sharedDesignExample, sharedDesignExampleV2 } from "./helpers/shared-design-fixture.mjs";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { exerciseRoleHintDraft } from "./helpers/role-hint-browser.mjs";

const publicRoot = resolve(import.meta.dirname, "../public");
const source = { role: "designer", resultId: "result", requestId: "request", requestIds: ["request"],
  cycleId: null, design: { revisionId: "design", digest: policyHash(sharedDesignExample()) }, planDigest: null };
function snapshot() {
  const content = sharedDesignExample();
  return {
    schemaVersion: "human-loop-snapshot-view/v1", streamId: "shell-fixture",
    conversationStatus: "verified",
    installation: { status: "ready", canStart: false, canReopen: false },
    design: { binding: source.design, content },
    workflow: { schemaVersion: "human-loop-view/v1", status: "waiting-answer", reason: null,
      activeRequestId: null, activeRole: null, workspacePath: "fixture", currentCycle: null,
      lastHandoff: { id: "handoff", role: "designer", kind: "designer-changed", summary: "The Design is ready.",
        findings: [], verificationLimits: [] }, queue: [], canStop: true, canSend: true,
      questionInteraction: { resultId: "result", source, canAnswer: true, questions: [{
        id: "scope", context: "Choose the product scope.", question: "Which scope should we keep?",
        whyItMatters: "This affects the experience.", importance: "blocking", source, state: "open", answerRequestId: null,
        options: [{ id: "small", label: "Small", implication: "Keep the core." }, { id: "large", label: "Large", implication: "Discuss additions." }],
        allowFreeform: true,
      }] },
    },
    messages: [{ id: "original", kind: "user", requestId: "request", text: "Design the experience; ask before changing scope.",
      timestamp: "2026-09-15T00:00:00Z", queueState: "completed" }],
    events: Array.from({ length: 25 }, (_, i) => ({ sequence: i + 1, type: "human.role", source: "system",
      summary: `Earlier state ${i + 1}`, timestamp: "2026-09-15T00:00:01Z", data: { requestId: "request", role: "designer" } })),
    accessRequests: [{ id: "permit", title: "Run the scoped check?", description: 'Requested arguments: {"command":"node","args":["--check","app.mjs"]}\nProject working copy: fixture\nRequested cwd: .',
      scopes: ["custom tool"], canApproveForSession: false, canApproveAll: false }],
    processes: { apps: [], commands: [] },
  };
}
async function fixture(t, { onPost, onSnapshot, onAsset, requestStatus = 202,
  rendererRoot = process.env.QUESTIONS_PACKAGE_PUBLIC ? resolve(process.env.QUESTIONS_PACKAGE_PUBLIC) : publicRoot, sandbox = false,
  modelSettings = { models: [{ id: "fixture", name: "Fixture private model" }], actual: "fixture", canChange: true } } = {}) {
  const current = snapshot(), streams = new Set(), posts = [], requests = [];
  const preferences = { theme: "system", fontSize: "normal" };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      requests.push(path);
      if (path === "/api/settings" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ preferences, model: modelSettings })); return;
      }
      if (path === "/api/snapshot") {
        await onSnapshot?.();
        const { questionInteraction, ...workflow } = current.workflow;
        const groups = workflow.questionInteractions ?? (questionInteraction ? [questionInteraction] : []);
        const questionInteractions = groups.map(group => ({ ...group, questions: group.questions.map(q => ({
          ...q, blockingActive: q.blockingActive ?? q.importance === "blocking",
        })) }));
        const questions = questionInteractions.flatMap(group => group.questions);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ...current, workflow: { ...workflow, questionInteractions, questionCounts: {
          unanswered: questions.filter(q => q.state === "open").length,
          blockers: questions.filter(q => q.state === "open" && q.blockingActive).length, processing: 0,
        } } })); return;
      }
      if (path === "/api/events") {
        response.writeHead(200, { "content-type": "text/event-stream" }); response.write("event: update\ndata: {}\n\n");
        streams.add(response); request.on("close", () => streams.delete(response)); return;
      }
      if (request.method === "POST") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const data = JSON.parse(Buffer.concat(chunks)); posts.push({ path, data });
        let result = await onPost?.({ path, data, current });
        if (path === "/api/settings") {
          Object.assign(preferences, data);
          result ??= { preferences, model: modelSettings };
        }
        if (path === "/api/settings/model") result ??= { preferences, model: modelSettings };
        if (path.startsWith("/api/access/")) current.accessRequests = current.accessRequests.filter(({ id }) => id !== decodeURIComponent(path.split("/").at(-1)));
        if (path === "/api/permissions/once") {
          result ??= { results: data.requestIds.map(requestId => ({ requestId, status: "approved" })) };
          current.accessRequests = current.accessRequests.filter(({ id }) => !data.requestIds.includes(id));
        }
        response.writeHead(path === "/api/requests" ? requestStatus : 200, { "content-type": "application/json" });
        response.end(JSON.stringify(result ?? { requestId: data.id })); return;
      }
      const file = resolve(rendererRoot, path === "/" ? "human-loop.html" : path.slice(1));
      if (!file.startsWith(rendererRoot + sep)) throw new Error("Outside fixture assets.");
      await onAsset?.(path);
      if (sandbox) response.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-same-origin");
      response.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" }[extname(file)] });
      response.end(await readFile(file));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  const browser = await openFixtureBrowser({ after: (cleanup) => cleanups.push(cleanup) });
  const url = `http://127.0.0.1:${server.address().port}/`;
  return { browser, current, posts, requests, preferences, url, update() { for (const stream of streams) stream.write("event: update\ndata: {}\n\n"); } };
}
test("frozen Rendering debugger unnecessarily depends on Host browser navigation for packaged local content",
  { skip: !browserAvailable || !process.env.DEBUGGER_FROZEN_PUBLIC, timeout: 60_000 }, async (t) => {
    const f = await fixture(t, { rendererRoot: resolve(process.env.DEBUGGER_FROZEN_PUBLIC), sandbox: true });
    await f.browser.call("Page.navigate", { url: f.url });
    await f.browser.waitFor("document.querySelector('#send').disabled === false");
    const before = await f.browser.call("Target.getTargets");
    await click(f.browser, 'a[href="sketch/example.html"]');
    await f.browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const after = await f.browser.call("Target.getTargets");
    assert.deepEqual(after.targetInfos.map(n => n.targetId).sort(), before.targetInfos.map(n => n.targetId).sort());
    assert.ok(!f.requests.includes("/sketch/example.html"));
    const asset = await fetch(new URL("sketch/example.html", f.url));
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /data-sketch-debugger/);
    assert.deepEqual(f.posts, [{ path: "/api/navigation/open", data: { url: new URL("sketch/example.html", f.url).href, focus: true } }]);
    await f.browser.waitFor("document.querySelector('#notice').textContent.includes('Host did not confirm browser opening')");
  });

test("Rendering debugger opens inside Settings without popup navigation and preserves workflow drafts",
  { skip: !browserAvailable, timeout: 90_000 }, async (t) => {
    const f = await fixture(t, { rendererRoot: process.env.DEBUGGER_PACKAGE_PUBLIC ? resolve(process.env.DEBUGGER_PACKAGE_PUBLIC) : publicRoot, sandbox: true });
    const { browser } = f;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('#send')?.disabled === false");
    await browser.evaluate("document.querySelector('#message').value='Keep my unsent request'");
    for (const width of [1280, 320]) for (const theme of ["light", "dark"]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: 1, mobile: false });
      f.preferences.theme = theme;
      await click(browser, "#canvas-settings summary");
      await browser.waitFor(`document.body.dataset.theme==='${theme}'`);
      assert.equal(await browser.evaluate("document.querySelector('#open-rendering-debugger').closest('details').id"), "canvas-settings");
      await click(browser, "#open-rendering-debugger");
      await browser.waitFor("document.querySelector('#rendering-debugger-frame').contentDocument?.querySelector('#validation-status')?.textContent.startsWith('Valid sketch-design/v3')");
      const state = await browser.evaluate(`(()=>{
        const dialog=document.querySelector('#rendering-debugger'),r=dialog.getBoundingClientRect();
        return {open:dialog.open,focus:document.activeElement.id,error:document.querySelector('#rendering-debugger-error').hidden,
          fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
          links:document.querySelectorAll('a[href="sketch/example.html"]').length};
      })()`);
      assert.deepEqual(state, { open: true, focus: "close-rendering-debugger", error: true, fits: true, links: 0 });
      await capture(browser, `rendering-debugger-${width}-${theme}`, state);
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.waitFor("!document.querySelector('#rendering-debugger').open");
      await browser.waitFor("document.activeElement.id === 'open-rendering-debugger'");
      assert.equal(await browser.evaluate("document.activeElement.id"), "open-rendering-debugger");
      assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Keep my unsent request");
      await click(browser, "#canvas-settings summary");
    }
    assert.ok(f.requests.includes("/sketch/debugger.js"));
    assert.ok(f.requests.includes("/prompts/human-loop.json"));
    assert.deepEqual(f.posts, []);
    assert.deepEqual(browser.exceptions, []);
  });
test("chat Enter uses the existing submit envelope and modified Enter preserves multiline text", { skip: !browserAvailable }, async (t) => {
  const f = await fixture(t), { browser } = f;
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#send').disabled === false");
  for (const modifiers of [2, 4, 8]) {
    const sent = f.posts.length;
    await browser.evaluate("document.querySelector('#message').focus()");
    await browser.call("Input.insertText", { text: "First line" });
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers, text: "\r", unmodifiedText: "\r" });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.call("Input.insertText", { text: "Second line" });
    assert.equal(await browser.evaluate("document.querySelector('#message').value"), "First line\nSecond line");
    assert.equal(f.posts.length, sent);
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.waitFor("document.querySelector('#message').value === ''");
    assert.equal(f.posts.length, sent + 1); assert.equal(f.posts.at(-1).path, "/api/requests");
    assert.equal(f.posts.at(-1).data.message, "First line\nSecond line");
  }
  await browser.evaluate("document.querySelector('#message').value='   ';document.querySelector('#message').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true}))");
  assert.equal(f.posts.length, 3);
  assert.deepEqual(browser.exceptions, []);
});

test("inline Send supports pointer, keyboard and touch without bypassing disabled, empty or IME guards",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    f.current.accessRequests = [];
    f.current.workflow.questionInteraction = null;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor('!document.querySelector("#send").disabled');
    const key = async (key, code, windowsVirtualKeyCode, text) => {
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(text ? { text } : {}) });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
    };
    await click(browser, "#send");
    assert.equal(f.posts.length, 0, "An empty draft is never submitted.");
    for (const [index, method] of ["pointer", "Enter", "Space", "touch"].entries()) {
      const message = `Exact ${method} draft.\nSecond line.`;
      await browser.evaluate(`document.querySelector("#message").value=${JSON.stringify(message)};
        document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}));
        document.querySelector("#message").focus()`);
      await key("Tab", "Tab", 9);
      assert.equal(await browser.evaluate('document.activeElement.id'), "send");
      assert.notEqual(await browser.evaluate('getComputedStyle(document.querySelector("#send")).outlineStyle'), "none");
      if (method === "pointer") await click(browser, "#send");
      else if (method === "touch") {
        await browser.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 700, deviceScaleFactor: 1, mobile: true });
        await browser.evaluate('document.querySelector("#composer").scrollIntoView({block:"end"})');
        const point = await browser.evaluate(`(() => {
          const r=document.querySelector("#send").getBoundingClientRect();
          return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};
        })()`);
        assert.ok(point.width >= 44 && point.height >= 44, "Coarse pointers get a touch-sized target.");
        await browser.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
        await browser.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await browser.call("Emulation.setTouchEmulationEnabled", { enabled: false });
      } else await key(method === "Space" ? " " : "Enter", method, method === "Space" ? 32 : 13, method === "Space" ? " " : "\r");
      await browser.waitFor('document.querySelector("#message").value === "" && !document.querySelector("#send").disabled');
      assert.equal(f.posts.length, index + 1, method + " submits once");
      assert.equal(f.posts[index].path, "/api/requests");
      assert.equal(f.posts[index].data.message, message);
      assert.ok(f.posts[index].data.id);
    }
    assert.equal(new Set(f.posts.map(post => post.data.id)).size, 4);
    await browser.evaluate('document.querySelector("#message").value="Retained draft"; document.querySelector("#message").focus()');
    f.current.workflow.canSend = false; f.update();
    await browser.waitFor('document.querySelector("#send").disabled');
    await key("Enter", "Enter", 13, "\r");
    await browser.evaluate('document.querySelector("#send").click()');
    assert.equal(f.posts.length, 4);
    f.current.workflow.canSend = true; f.update();
    await browser.waitFor('!document.querySelector("#send").disabled');
    await browser.call("Input.imeSetComposition", { text: "composing", selectionStart: 9, selectionEnd: 9 });
    await key("Enter", "Enter", 13, "\r");
    assert.equal(f.posts.length, 4, "IME confirmation is not Send.");
    await browser.call("Input.insertText", { text: "composed" });
    assert.deepEqual(browser.exceptions, []);
  });

test("retained query Continue uses its exact endpoint alongside inline Send and empty Design guidance",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const held = Promise.withResolvers();
    const f = await fixture(t, { onPost: async ({ path, data, current }) => {
      assert.equal(path, "/api/runtime/continue-query");
      assert.deepEqual(data, { taskId: "retained-task", errorId: "query-error" });
      await held.promise;
      current.workflow.queryFailure = null;
      current.workflow.status = "working";
      current.workflow.reason = null;
    } }), { browser } = f;
    t.after(() => held.resolve());
    f.current.design = null;
    f.current.accessRequests = [];
    Object.assign(f.current.workflow, { status: "waiting-query", reason: "Synthetic model-query failure.",
      activeRequestId: "request", activeRole: "reviewer", questionInteraction: null,
      queryFailure: { id: "query-error", taskId: "retained-task", processing: false, canContinue: true, blocker: null } });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor('document.querySelector("[data-human-loop-action=continueQuery]")?.disabled === false');
    await browser.evaluate('document.querySelector("#message").value="Keep this separate unsent draft"');
    assert.equal(await browser.evaluate('document.querySelector("#send").closest(".composer-input-wrap") !== null'), true);
    assert.equal(await browser.evaluate('document.querySelector("#send").textContent'), "\u21b5");
    assert.equal(await browser.evaluate('document.querySelector("#backbone-state").hidden'), true);
    assert.match(await browser.evaluate('document.querySelector("#assessment-card").textContent'), /No Design has been published/);
    await click(browser, "[data-human-loop-action=continueQuery]");
    await browser.waitFor('document.querySelector("[data-human-loop-action=continueQuery]").disabled');
    await browser.evaluate('document.querySelector("[data-human-loop-action=continueQuery]").click()');
    assert.equal(f.posts.length, 1);
    held.resolve();
    await browser.waitFor('document.querySelector("[data-human-loop-action=continueQuery]").hidden');
    assert.equal(await browser.evaluate('document.querySelector("#message").value'), "Keep this separate unsent draft");
    assert.deepEqual(f.posts, [{ path: "/api/runtime/continue-query", data: { taskId: "retained-task", errorId: "query-error" } }]);
    assert.deepEqual(browser.exceptions, []);
  });

async function capture(browser, name, geometry) {
  if (!process.env.HUMAN_SHELL_EVIDENCE) return;
  await mkdir(process.env.HUMAN_SHELL_EVIDENCE, { recursive: true });
  const image = await browser.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(process.env.HUMAN_SHELL_EVIDENCE, `${name}.png`), Buffer.from(image.data, "base64"));
  await writeFile(join(process.env.HUMAN_SHELL_EVIDENCE, `${name}.json`), JSON.stringify(geometry, null, 2));
}

test("empty Design keeps one guidance message without a header strip while retaining diagnostics and section naming",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const firstSnapshot = Promise.withResolvers();
    const f = await fixture(t, { onSnapshot: () => firstSnapshot.promise }), { browser } = f;
    t.after(() => firstSnapshot.resolve());
    const design = f.current.design;
    f.current.design = null;
    f.current.workflow.questionInteraction.questions[0].designRefs = ["interaction#deliver"];
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor('document.querySelector("#assessment-card") && getComputedStyle(document.querySelector("#design-pane-title")).position === "absolute"');
    const emptyHeader = async phase => {
      for (const panel of ["standalone", "workspace"]) {
        await browser.evaluate(panel === "workspace" ? 'document.body.dataset.projectPanel="workspace"; document.body.dataset.projectDesign="true"; document.body.dataset.projectStacked="false"'
          : 'delete document.body.dataset.projectPanel');
        const view = await browser.evaluate(`(() => {
          const badge=document.querySelector("#backbone-state"), header=badge.closest(".panel-heading");
          return {hidden:badge.hidden,text:badge.textContent,height:header.getBoundingClientRect().height,
            guidance:document.querySelector("#assessment-card").textContent,
            guidanceVisible:document.querySelector("#assessment-card").checkVisibility()};
        })()`);
        await capture(browser, `empty-design-${phase}-${panel}`, view);
        assert.equal(view.hidden, true, `${phase} ${panel}: no duplicate badge`);
        assert.equal(view.text, "");
        assert.equal(view.height, 0, `${phase} ${panel}: no empty toolbar strip`);
        assert.equal(view.guidanceVisible, true);
        assert.match(view.guidance, /No Design has been published.*Discuss your idea/);
        const { root } = await browser.call("DOM.getDocument");
        const { nodeId } = await browser.call("DOM.querySelector", { nodeId: root.nodeId, selector: "#design-panel" });
        const { nodes } = await browser.call("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
        assert.ok(nodes.some(node => node.role?.value === "region" && node.name?.value === "Canvas" && !node.ignored),
          "The collapsed header still names the Design section.");
      }
    };
    await emptyHeader("initial");
    firstSnapshot.resolve();
    await browser.waitFor('document.querySelector("#show-questions").textContent.includes("1 blockers")');
    await emptyHeader("verified");
    for (const [startup, installation, expected] of [
      ["starting", "attaching", "Loading Design..."], ["verifying", "ready", "Loading Design..."],
      [null, "unknown", "Design unverified"], [null, "failed", "Design unverified"],
    ]) {
      f.current.startup = startup;
      f.current.installation.status = installation;
      f.update();
      await browser.waitFor(`document.querySelector("#backbone-state").textContent === ${JSON.stringify(expected)}`);
      assert.equal(await browser.evaluate('document.querySelector("#backbone-state").checkVisibility()'), true);
      assert.ok(await browser.evaluate('document.querySelector("#design-panel > .panel-heading").getBoundingClientRect().height') > 0);
    }
    f.current.installation.status = "ready"; f.current.design = design; f.update();
    await browser.waitFor('document.querySelector("#backbone-state").textContent === "Current Design"');
    assert.equal(await browser.evaluate('document.querySelector("#backbone-state").checkVisibility()'), true);
    assert.equal(await browser.evaluate('document.querySelector("#assessment-card").hidden'), true);
    assert.equal(await browser.evaluate('document.querySelector("#design-summary").textContent'), design.content.summary);
    f.current.conversationStatus = "unverified"; f.update();
    await browser.waitFor('document.querySelector("#backbone-state").textContent === "Design unverified"');
    assert.equal(await browser.evaluate('document.querySelector("#backbone-proposal").hidden'), false,
      "Unverified readback retains the last verified Design with its warning.");
    assert.equal(await browser.evaluate('document.querySelector("#backbone-state").checkVisibility()'), true);
    f.current.conversationStatus = "verified"; f.update();
    await browser.waitFor('document.querySelector("#backbone-state").textContent === "Current Design"');
    await click(browser, "#show-questions");
    await browser.evaluate("document.querySelector('fieldset:not([hidden]) .design-reference').closest('details').open=true");
    await click(browser, "fieldset:not([hidden]) .design-reference");
    f.current.design = null; f.update();
    await browser.waitFor('!document.querySelector("#assessment-card").hidden');
    assert.equal(await browser.evaluate('document.querySelector("#backbone-state").hidden'), true);
    assert.equal(await browser.evaluate('document.querySelector("#return-to-questions").checkVisibility()'), true,
      "An empty Design must not hide contextual Back to Questions navigation.");
    await click(browser, "#return-to-questions");
    assert.equal(await browser.evaluate('document.querySelector("#question-panel").hidden'), false);
    await click(browser, "#questions-back");
    await emptyHeader("cleared");
    assert.deepEqual(f.posts, []);
    assert.deepEqual(browser.exceptions, []);
  });

test("composer hides generic tutorials without losing contextual hints, errors or accessible editing",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("!document.querySelector('#send').disabled");
    for (const [width, height] of [[1360, 900], [390, 620], [1360, 480]]) for (const theme of ["light", "dark"]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)};
        document.querySelector("#message").value="Keep this ordinary draft";
        document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}));
        document.querySelector("#message").focus();document.querySelector("#message").setSelectionRange(2,7);
        document.querySelector("#composer").scrollIntoView({block:"end"})`);
      const quiet = await browser.evaluate(`(() => {
        const input=document.querySelector("#message"),help=document.querySelector("#role-hint-help");
        return {helpHeight:help.getBoundingClientRect().height,description:input.getAttribute("aria-describedby"),
          label:document.querySelector('label[for="message"]').textContent,placeholder:input.placeholder,
          overflow:document.documentElement.scrollWidth>innerWidth+1,caret:[input.selectionStart,input.selectionEnd],
          sendDisabled:document.querySelector("#send").disabled};
      })()`);
      assert.equal(quiet.helpHeight, 0); assert.equal(quiet.description, null);
      assert.ok(quiet.label && quiet.placeholder); assert.equal(quiet.overflow, false);
      assert.deepEqual(quiet.caret, [2, 7]); assert.equal(quiet.sendDisabled, false);
      await capture(browser, `quiet-private-composer-${width}x${height}-${theme}`, quiet);
      await browser.evaluate(`document.querySelector("#message").value="@agent Explain.";
        document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))`);
      assert.equal(await browser.evaluate('document.querySelector("#role-hint-help").checkVisibility()'), true);
      assert.equal(await browser.evaluate('document.querySelector("#message").getAttribute("aria-describedby")'), "role-hint-help");
    }
    await browser.evaluate('document.querySelector("#message").value="";document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))');
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
    await exerciseRoleHintDraft({ browser, evaluate: browser.evaluate, click: selector => click(browser, selector) });
    await browser.evaluate(`document.querySelector("#message").value="@agent Explain.";
      document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))`);
    f.current.workflow.canSend = false;
    f.current.workflow.status = "execution-unknown";
    f.current.workflow.reason = "Execution could not be verified. Check the saved runtime.";
    f.update();
    await browser.waitFor("document.querySelector('#send').disabled");
    assert.equal(await browser.evaluate('document.querySelector("#role-hint-help").checkVisibility()'), true);
    assert.match(await browser.evaluate('document.querySelector("#human-workflow").textContent'), /Execution could not be verified/);
    assert.equal(await browser.evaluate('document.querySelector("#message").value'), "@agent Explain.");
    assert.deepEqual(f.posts, []); assert.deepEqual(browser.exceptions, []);
  });

test("Questions workspace keeps one readable question, explicit navigation and source-bound batches",
  { skip: !browserAvailable, timeout: 120_000 }, async t => {
    let answerMode = "hold", release;
    const f = await fixture(t, { onPost: async ({ path, data, current }) => {
      if (path !== "/api/answers") return;
      if (answerMode === "hold") await new Promise(resolve => { release = resolve; });
      if (answerMode !== "accept") throw new Error("Synthetic uncertain answer receipt");
      for (const answer of data.answers.answers) {
        const question = current.workflow.questionInteractions.find(group => group.resultId === answer.sourceResultId)
          .questions.find(question => question.id === answer.questionId);
        question.state = "answered"; question.answerRequestId = data.id; question.blockingActive = false;
      }
      current.messages.push({ id: "acknowledged-answer", requestId: data.id, kind: "user", text: "Question form submission.",
        timestamp: "2026-09-15T00:00:02Z", answerDetails: data.answers.answers.map(answer => ({
          questionId: answer.questionId, sourceResultId: answer.sourceResultId, answer: answer.value,
        })) });
    } });
    t.after(() => release?.());
    const { browser } = f;
    const original = f.current.workflow.questionInteraction;
    const first = original.questions[0];
    first.question = "Which scope should we keep when opening a long document and preserving its original navigation? "
      + "The title must remain readable even for an identifier such as " + "unbroken".repeat(12);
    first.context = "A reader opens a long local document and follows its links. ".repeat(12);
    first.options = Array.from({ length: 12 }, (_, index) => ({ id: `choice-${index}`, label: `Choice ${index + 1}`,
      implication: `Consequence ${index + 1}: preserve readable source and make the intended navigation explicit.` }));
    first.designRefs = ["interaction#deliver"];
    const advisory = { ...structuredClone(first), id: "optional", question: "Should optional navigation change?",
      importance: "advisory", blockingActive: false,
      unanswered: { action: "keep-current-design", explanation: "Keep the existing link behavior." } };
    original.questions.push(advisory, { ...structuredClone(first), id: "past", question: "Previously answered question",
      state: "answered", blockingActive: false, answerRequestId: "old-answer" });
    const secondSource = { ...source, role: "planner", resultId: "second-source", requestId: "second-request", requestIds: ["second-request"] };
    const other = { resultId: secondSource.resultId, source: secondSource, canAnswer: true,
      questions: [{ ...structuredClone(advisory), id: "other", source: secondSource }] };
    f.current.workflow.questionInteractions = [original, other];
    f.current.messages.push({ id: "second-message", kind: "user", requestId: "second-request",
      text: "An independent original request.", timestamp: "2026-09-15T00:00:01Z" });
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('.question-open-list button')");
    assert.equal(await browser.evaluate("document.querySelector('#question-panel').hidden"), true);
    await browser.evaluate(`document.querySelector('#message').value='Keep composer draft';
      document.querySelector('#message').focus();document.querySelector('#message').setSelectionRange(2,6);
      globalThis.retainedComposer=document.querySelector('#message');
      globalThis.retainedArtifact=document.querySelector('#design-artifacts').firstElementChild;
      document.querySelector('#canvas-scroll').scrollTop=120;
      globalThis.designTop=document.querySelector('#canvas-scroll').scrollTop`);
    f.update();
    await browser.waitFor("document.querySelector('#show-questions').textContent === 'Questions (3, 1 blockers)'");
    assert.deepEqual(await browser.evaluate(`({closed:document.querySelector('#question-panel').hidden,
      focus:document.activeElement.id,caret:retainedComposer.selectionStart})`), { closed: true, focus: "message", caret: 2 });
    await click(browser, "#show-questions");
    const choose = async (result, id, history = false) => {
      if (history) {
        await browser.evaluate("document.querySelector('.question-history').open=true");
        await click(browser, `[data-question-history-key='${JSON.stringify([result, id])}']`);
        return;
      }
      await click(browser, `[data-question-open-key='${JSON.stringify([result, id])}']`);
    };
    const draft = async text => browser.evaluate(`(() => {const input=document.querySelector('fieldset:not([hidden]) textarea');
      input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await browser.evaluate("document.querySelector('.question-history').open"), false);
    assert.equal(await browser.evaluate("document.querySelectorAll('.question-navigation select').length"), 0);
    const openItems = await browser.evaluate(`Array.from(document.querySelectorAll('.question-open-list button'), b=>({
      title:b.querySelector('strong').textContent,text:b.textContent,name:b.getAttribute('aria-label'),
      selected:b.getAttribute('aria-current'),visible:b.checkVisibility()}))`);
    assert.equal(openItems.length, 3);
    assert.ok(openItems.every(item => item.visible));
    assert.equal(openItems[0].selected, "true");
    assert.match(openItems[0].text, /Blocking \/ answer required/);
    assert.match(openItems[1].text, /Advisory \/ optional/);
    assert.match(openItems[0].name, /Blocking \/ answer required/);
    assert.match(openItems[1].name, /Advisory \/ optional/);
    assert.equal(openItems[1].title, openItems[2].title);
    assert.notEqual(openItems[1].name, openItems[2].name, "Duplicate titles still identify their exact sources.");
    assert.equal(await browser.evaluate("document.activeElement===document.querySelector('.question-open-list button')"), true);
    await browser.evaluate("document.querySelectorAll('.question-open-list button')[1].focus()");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden])').dataset.questionId"), "optional");
    assert.equal(await browser.evaluate("document.querySelectorAll('.question-open-list button[aria-current=true]').length"), 1);
    assert.equal(await browser.evaluate("document.querySelector('.question-open-list button[aria-current=true]').dataset.questionOpenKey"), JSON.stringify(["result", "optional"]));
    assert.deepEqual(f.posts, [], "Keyboard question selection only navigates.");
    await choose("result", "scope");
    await browser.evaluate("globalThis.openButton=document.querySelector('.question-open-list button');openButton.focus()");
    first.blockingActive = false; f.update();
    await browser.waitFor("openButton.textContent.includes('Originally blocking - not blocking now')");
    assert.equal(await browser.evaluate("document.activeElement===openButton"), true);
    first.blockingActive = true; f.update();
    await browser.waitFor("openButton.textContent.includes('Blocking / answer required')");
    assert.equal(await browser.evaluate("document.querySelectorAll('fieldset:not([hidden])').length"), 1);
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) select').value"), "");
    await draft("First exact draft");
    assert.match(await browser.evaluate("document.querySelector('.question-open-list button').textContent"), /Draft answer selected/);
    assert.match(await browser.evaluate("document.querySelector('.question-open-list button').getAttribute('aria-label')"), /Draft answer selected/);
    await choose("result", "optional"); await draft("Second selected draft");
    assert.match(await browser.evaluate("document.querySelector('fieldset:not([hidden])').textContent"), /Advisory \/ optional.*If unanswered:.*not a user answer or approval/s);
    assert.match(await browser.evaluate("document.querySelector('.human-loop-question-group:not([hidden]) .question-batch').textContent"), /source \(2\).*First exact draft.*Second selected draft/s);
    await choose("second-source", "other"); await draft("Separate source draft");
    await choose("result", "past", true);
    assert.match(await browser.evaluate("document.querySelector('fieldset:not([hidden])').textContent"), /Answered. The submitted answer is retained/);
    f.update();
    await browser.evaluate("new Promise(resolve=>setTimeout(resolve,100))");
    assert.equal(await browser.evaluate("document.querySelector('.question-history').open"), true);
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden])').dataset.questionId"), "past");
    await choose("result", "scope");
    await browser.evaluate(`document.querySelector('.question-history').open=false;
      globalThis.retainedAnswer=document.querySelector('fieldset:not([hidden]) textarea');
      retainedAnswer.focus();retainedAnswer.setSelectionRange(2,7)`);
    await click(browser, "#questions-back");
    assert.deepEqual(await browser.evaluate(`({same:document.querySelector('#design-artifacts').firstElementChild===retainedArtifact,
      scroll:document.querySelector('#canvas-scroll').scrollTop===designTop, composer:retainedComposer.value,caret:retainedComposer.selectionStart})`),
    { same: true, scroll: true, composer: "Keep composer draft", caret: 2 });
    await click(browser, "#show-questions");
    assert.deepEqual(await browser.evaluate("({focus:document.activeElement===retainedAnswer,start:retainedAnswer.selectionStart,end:retainedAnswer.selectionEnd})"),
      { focus: true, start: 2, end: 7 });
    await browser.evaluate("document.querySelector('fieldset:not([hidden]) .design-reference').closest('details').open=true");
    await click(browser, "fieldset:not([hidden]) .design-reference");
    assert.equal(await browser.evaluate("document.querySelector('#question-panel').hidden"), true);
    assert.equal(await browser.evaluate("document.querySelector('#return-to-questions').checkVisibility()"), true);
    await click(browser, "#return-to-questions");
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) textarea').value"), "First exact draft");
    await choose("second-source", "other");
    await click(browser, '.human-loop-question-group:not([hidden]) button:not([data-human-loop-action])');
    await browser.waitFor("document.querySelector('[data-entry-id=second-message]').classList.contains('state-focused')");
    assert.equal(await browser.evaluate("document.querySelector('#question-panel').hidden"), false);
    await choose("result", "scope");
    for (const [width, height] of [[1893, 1000], [1360, 900], [980, 620], [920, 620], [390, 620], [1360, 480], [390, 480]]) {
      for (const theme of ["light", "dark"]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)};
          document.querySelector('#questions-content').scrollTop=0;window.scrollTo(0,0)`);
        await browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const geometry = await browser.evaluate(`(() => {
          const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
          return {question:rect('#question-panel'),conversation:rect('#conversation-panel'),content:rect('#questions-content'),
            questionOverflow:document.querySelector('#questions-content').scrollWidth>document.querySelector('#questions-content').clientWidth+1,
            pageOverflow:document.documentElement.scrollWidth>innerWidth+1,rows:document.querySelectorAll('fieldset:not([hidden])').length,
            contextOverflow:getComputedStyle(document.querySelector('.human-loop-question-context')).overflowY,
            openTitles:[...document.querySelectorAll('.question-open-title')].map(node=>({
              clipped:node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1,
              clamp:getComputedStyle(node).webkitLineClamp})),
            questionScroll:getComputedStyle(document.querySelector('#questions-content')).overflowY,
            permission:document.querySelector('#access-approval').checkVisibility(),body:document.body.innerText.includes('1 blockers')};
        })()`);
        assert.equal(geometry.pageOverflow || geometry.questionOverflow, false, JSON.stringify(geometry));
        assert.equal(geometry.rows, 1);
        assert.equal(geometry.contextOverflow, "visible");
        assert.ok(geometry.openTitles.every(title=>!title.clipped && title.clamp==="none"), JSON.stringify(geometry));
        assert.equal(geometry.permission && geometry.body, true);
        if (width > 660) {
          assert.ok(geometry.question.right <= geometry.conversation.left + 1);
          assert.ok(geometry.question.height > height * .7, JSON.stringify(geometry));
        } else {
          assert.equal(geometry.questionScroll, "visible");
          assert.ok(geometry.question.bottom <= geometry.conversation.top + 1);
        }
        await capture(browser, `questions-workspace-${width}x${height}-${theme}`, geometry);
      }
    }
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
    await click(browser, "#questions-conversation");
    assert.equal(await browser.evaluate("document.activeElement.id"), "message");
    await click(browser, ".human-loop-question-group:not([hidden]) button[type=submit]");
    await browser.waitFor("document.querySelector('.human-loop-question-group:not([hidden]) button[type=submit]').disabled");
    assert.match(await browser.evaluate("document.querySelector('.question-open-list button').textContent"), /Sending answer/);
    await browser.evaluate("document.querySelector('.human-loop-question-group:not([hidden]) form').requestSubmit()");
    assert.equal(f.posts.filter(post => post.path === "/api/answers").length, 1);
    assert.equal(first.state, "open");
    release();
    await browser.waitFor("document.querySelector('.human-loop-question-group:not([hidden]) form').textContent.includes('Synthetic uncertain answer receipt')");
    assert.match(await browser.evaluate("document.querySelector('.question-open-list button').textContent"), /Draft answer selected/);
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) textarea').value"), "First exact draft");
    answerMode = "accept";
    await click(browser, ".human-loop-question-group:not([hidden]) button[type=submit]");
    await browser.waitFor("document.querySelector('fieldset:not([hidden])').dataset.questionState==='answered'");
    const posts = f.posts.filter(post => post.path === "/api/answers");
    assert.equal(posts.length, 2); assert.deepEqual(posts[0].data, posts[1].data);
    assert.deepEqual(posts[0].data.answers.answers.map(answer => [answer.sourceResultId, answer.questionId, answer.value]),
      [["result", "scope", "First exact draft"], ["result", "optional", "Second selected draft"]]);
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden])').dataset.questionId"), "scope");
    assert.equal(await browser.evaluate("document.querySelector('.question-history').open"), false);
    await choose("second-source", "other");
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) textarea').value"), "Separate source draft");
    other.questions[0].source = { ...secondSource, resultId: "stale-source" };
    f.update();
    await browser.waitFor("!document.querySelector('.human-loop-question-group:not([hidden]) .human-loop-error').hidden");
    await browser.evaluate("document.querySelector('.human-loop-question-group:not([hidden]) form').requestSubmit()");
    assert.equal(f.posts.filter(post => post.path === "/api/answers").length, 2);
    await browser.evaluate("document.querySelector('#questions-back').focus()");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    assert.equal(await browser.evaluate("document.querySelector('#question-panel').hidden"), true);
    assert.equal(await browser.evaluate("document.activeElement.id"), "show-questions");
    other.questions[0].source = secondSource; other.questions[0].state = "answered";
    await browser.call("Page.reload");
    await browser.waitFor("document.querySelector('#show-questions')?.textContent==='Questions (0, 0 blockers)'");
    await click(browser, "#show-questions");
    assert.equal(await browser.evaluate("document.activeElement===document.querySelector('.question-history > summary')"), true);
    assert.equal(await browser.evaluate("document.querySelector('.question-history').open"), false);
    await choose("result", "scope", true);
    assert.match(await browser.evaluate("document.querySelector('fieldset:not([hidden]) .human-loop-submitted-answer').textContent"), /First exact draft/);
    assert.deepEqual(browser.exceptions, []);
  });

test("Questions saved history is readable without an empty open section, preserves exact sources and fits compact viewports",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    const first = f.current.workflow.questionInteraction;
    const question = first.questions[0];
    question.state = "answered"; question.blockingActive = false; question.answerRequestId = "answer-one";
    question.question = "A long identical question about keeping the original document and navigation. ".repeat(8);
    question.designRefs = ["interaction#deliver"];
    const second = structuredClone(first);
    second.resultId = "second-result";
    second.source = { ...source, resultId: second.resultId, requestId: "second-request", requestIds: ["second-request"] };
    second.questions[0].source = second.source;
    second.questions[0].answerRequestId = "answer-two";
    f.current.workflow.questionInteractions = [first, second];
    const answer = "Retain the full answer, with its exact source and intent. ".repeat(20) + "UNBROKEN".repeat(30);
    f.current.messages.push(
      { id: "answer-one", kind: "user", requestId: "answer-one", text: "Question form submission.",
        timestamp: "2026-09-15T00:00:02Z", answerDetails: [{ questionId: question.id, sourceResultId: first.resultId, answer }] },
      { id: "answer-two", kind: "user", requestId: "answer-two", text: "Question form submission.",
        timestamp: "2026-09-15T00:00:03Z", answerDetails: [{ questionId: question.id, sourceResultId: second.resultId, answer: "Second source answer." }] },
      { id: "second-message", kind: "user", requestId: "second-request", text: "The other original request.",
        timestamp: "2026-09-15T00:00:01Z" });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('#show-questions')?.textContent==='Questions (0, 0 blockers)'");
    await click(browser, "#show-questions");
    assert.deepEqual(await browser.evaluate(`({
      openList:document.querySelector('.question-open').checkVisibility(),
      dropdowns:document.querySelectorAll('.question-navigation select').length,
      summary:document.querySelector('.question-history > summary').textContent,
      expanded:document.querySelector('.question-history').open,
      details:document.querySelectorAll('fieldset:not([hidden])').length,
      focus:document.activeElement===document.querySelector('.question-history > summary')
    })`), { openList: false, dropdowns: 0, summary: "Answered history (2)", expanded: false, details: 0, focus: true });
    await click(browser, ".question-history > summary");
    const items = await browser.evaluate(`Array.from(document.querySelectorAll('.question-history-list button'), b => ({
      text:b.textContent,name:b.getAttribute('aria-label'),key:b.dataset.questionHistoryKey,visible:b.checkVisibility()
    }))`);
    assert.equal(items.length, 2);
    assert.ok(items.every(item => item.visible && item.text.includes(question.question) && item.text.includes("Inspect full context")));
    assert.match(items[0].text, /source 1.*answered.*Submitted answer: Retain/s);
    assert.match(items[1].text, /source 2.*answered.*Submitted answer: Second source answer/s);
    assert.notEqual(items[0].name, items[1].name);
    assert.deepEqual(items.map(item => JSON.parse(item.key)), [[first.resultId, question.id], [second.resultId, question.id]]);
    assert.equal(await browser.evaluate("document.querySelector('.question-navigation > p').checkVisibility()"), false);
    assert.doesNotMatch(await browser.evaluate("document.querySelector('.question-navigation').textContent"), /Expand Answered history|Choose a saved question/);
    for (const [width, height] of [[1360, 900], [920, 620], [390, 620], [320, 480], [1360, 480]]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate("document.querySelector('#questions-content').scrollTop=0;window.scrollTo(0,0)");
      const geometry = await browser.evaluate(`(() => {
        const content=document.querySelector('#questions-content'),list=document.querySelector('.question-history-list');
        return {pageOverflow:document.documentElement.scrollWidth>innerWidth+1,
          questionOverflow:content.scrollWidth>content.clientWidth+1,
          rows:[...list.children].map(li=>li.getBoundingClientRect().height),
          titleClamp:getComputedStyle(list.querySelector('.question-history-title')).webkitLineClamp,
          answerClamp:getComputedStyle(list.querySelector('.question-history-answer')).webkitLineClamp,
          openHeight:document.querySelector('.question-open').getBoundingClientRect().height};
      })()`);
      assert.equal(geometry.pageOverflow || geometry.questionOverflow, false, JSON.stringify(geometry));
      assert.equal(geometry.openHeight, 0);
      assert.equal(geometry.titleClamp, "2"); assert.equal(geometry.answerClamp, "2");
      assert.ok(geometry.rows.every(height => height < 210), JSON.stringify(geometry));
      await capture(browser, `questions-saved-list-${width}x${height}`, geometry);
      await click(browser, ".question-history-list button");
      assert.equal(await browser.evaluate("document.querySelectorAll('fieldset:not([hidden])').length"), 1);
      assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) h4').textContent"), question.question);
      assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) .human-loop-submitted-answer').textContent"), `Submitted answer: ${answer}`);
      assert.equal(await browser.evaluate("document.activeElement===document.querySelector('fieldset:not([hidden]) h4')"), true);
      assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) h4').getBoundingClientRect().top >= 0"), true);
    }
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
    await click(browser, ".question-history-list li:nth-child(2) button");
    assert.equal(await browser.evaluate("document.querySelector('.human-loop-question-group:not([hidden]) form').dataset.sourceResultId"), "second-result");
    assert.match(await browser.evaluate("document.querySelector('fieldset:not([hidden]) .human-loop-submitted-answer').textContent"), /Second source answer/);
    await click(browser, '.human-loop-question-group:not([hidden]) button:not([data-human-loop-action])');
    await browser.waitFor("document.querySelector('[data-entry-id=second-message]').classList.contains('state-focused')");
    await browser.evaluate(`globalThis.historyButton=document.querySelector('.question-history-list button');
      historyButton.focus();document.querySelector('#message').value='Unsent conversation draft'`);
    second.questions[0].processingState = "retired";
    f.update();
    await browser.waitFor("document.querySelector('.question-history-list li:nth-child(2)').textContent.includes('Not resumed')");
    assert.equal(await browser.evaluate("document.activeElement===historyButton"), true);
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden])').closest('form').dataset.sourceResultId"), "second-result");
    assert.equal(await browser.evaluate("document.querySelector('.question-history').open"), true);
    assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Unsent conversation draft");
    first.questions.push({ ...structuredClone(question), id: "later-saved" });
    f.update();
    await browser.waitFor("document.querySelectorAll('.question-history-list button').length===3");
    assert.equal(await browser.evaluate("document.activeElement===historyButton"), true, "Adding history retains an existing focused list action.");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden])').closest('form').dataset.sourceResultId"), first.resultId);
    assert.equal(await browser.evaluate("document.activeElement===document.querySelector('fieldset:not([hidden]) h4')"), true);
    assert.deepEqual(f.posts, []); assert.deepEqual(browser.exceptions, []);
  });

test("Questions history uses truthful statuses and retains selection and drafts through lifecycle updates and empty states",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    const group = f.current.workflow.questionInteraction, question = group.questions[0];
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('.question-open-list button')");
    await click(browser, "#show-questions");
    assert.equal(await browser.evaluate("document.querySelector('.question-history').checkVisibility()"), false);
    await browser.evaluate(`globalThis.draft=document.querySelector('fieldset:not([hidden]) textarea');
      draft.value='Keep exact unsent answer';draft.dispatchEvent(new Event('input',{bubbles:true}));
      draft.focus();draft.setSelectionRange(3,8)`);
    const saved = { ...structuredClone(question), id: "saved", state: "answered", blockingActive: false, answerRequestId: "saved-answer" };
    group.questions.push(saved);
    f.update();
    await browser.waitFor("document.querySelector('.question-history-list button')");
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) textarea').value"), "Keep exact unsent answer");
    await click(browser, ".question-history > summary");
    await click(browser, ".question-history-list button");
    assert.match(await browser.evaluate("document.querySelector('.question-history-list').textContent"), /Answered. The submitted answer is retained in Conversation/);
    saved.processingState = "rejected";
    f.current.messages.push({ id: "wrong-answer", kind: "user", requestId: "wrong-request", text: "Unrelated answer.",
      timestamp: "2026-09-15T00:00:02Z", answerDetails: [
        { questionId: "saved", sourceResultId: group.resultId, answer: "Wrong request answer" },
        { questionId: "saved", sourceResultId: "other-source", answer: "Wrong source answer" },
        { questionId: "other-question", sourceResultId: group.resultId, answer: "Wrong question answer" }] });
    f.update();
    await browser.waitFor("document.querySelector('.question-history-list').textContent.includes('Rejected')");
    assert.doesNotMatch(await browser.evaluate("document.querySelector('.question-history-list').textContent"), /Wrong .* answer/);
    saved.state = "invalidated"; saved.invalidation = { reason: "Superseded by an explicit Design change." };
    f.update();
    await browser.waitFor("document.querySelector('.question-history > summary').textContent==='Question history (1)'");
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden])').dataset.questionId"), "saved");
    assert.match(await browser.evaluate("document.querySelector('.question-history-list').textContent"), /invalidated.*Rejected.*Superseded/s);
    assert.doesNotMatch(await browser.evaluate("document.querySelector('.question-history-list').textContent"), /Submitted answer:|Completed/);
    f.current.messages.push({ id: "saved-answer", kind: "user", requestId: "saved-answer", text: "Question form submission.",
      timestamp: "2026-09-15T00:00:03Z", answerDetails: [
        { questionId: "saved", sourceResultId: group.resultId, answer: "An exact answer retained before invalidation." }] });
    f.update();
    await browser.waitFor("document.querySelector('.question-history-list').textContent.includes('Submitted answer: An exact answer retained before invalidation.')");
    assert.match(await browser.evaluate("document.querySelector('.question-history-list').textContent"), /invalidated.*Rejected/s);
    assert.match(await browser.evaluate("document.querySelector('fieldset:not([hidden]) .human-loop-submitted-answer').textContent"), /An exact answer retained before invalidation/);
    assert.match(await browser.evaluate("document.querySelector('fieldset:not([hidden]) .human-loop-submitted-answer').textContent"), /Superseded by an explicit Design change/);
    await click(browser, `[data-question-open-key='${JSON.stringify([group.resultId, question.id])}']`);
    await browser.evaluate(`
      globalThis.retainedDraft=document.querySelector('fieldset:not([hidden]) textarea');
      retainedDraft.focus();retainedDraft.setSelectionRange(3,8)`);
    assert.equal(await browser.evaluate("retainedDraft.value"), "Keep exact unsent answer");
    saved.processingState = "retired";
    f.update();
    await browser.waitFor("document.querySelector('.question-history-list').textContent.includes('Not resumed')");
    assert.deepEqual(await browser.evaluate("({same:document.activeElement===retainedDraft,start:retainedDraft.selectionStart,end:retainedDraft.selectionEnd})"),
      { same: true, start: 3, end: 8 });
    question.state = "answered"; question.answerRequestId = "pending"; question.processingState = "waiting"; question.blockingActive = false;
    f.update();
    await browser.waitFor("document.querySelector('fieldset:not([hidden])').dataset.questionState==='answered'");
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden])').dataset.questionId"), question.id);
    assert.match(await browser.evaluate("document.querySelector('.question-history-list').textContent"), /answered.*Queued/s);
    assert.equal(await browser.evaluate("document.querySelector('.question-open').checkVisibility()"), false);
    question.state = "open"; question.answerRequestId = null; delete question.processingState;
    f.update();
    await browser.waitFor("document.querySelector('fieldset:not([hidden])').dataset.questionState==='open'");
    assert.equal(await browser.evaluate("document.querySelector('fieldset:not([hidden]) textarea').value"), "Keep exact unsent answer");
    group.questions = [];
    f.update();
    await browser.waitFor("document.querySelector('.question-navigation > p').textContent==='No saved questions are available in this view.'");
    assert.deepEqual(await browser.evaluate(`({
      open:document.querySelector('.question-open').checkVisibility(),
      history:document.querySelector('.question-history').checkVisibility(),
      message:document.querySelector('.question-navigation > p').checkVisibility(),
      details:document.querySelectorAll('fieldset:not([hidden])').length})`),
    { open: false, history: false, message: true, details: 0 });
    group.questions = [{ ...structuredClone(question), id: "replacement" }];
    f.update();
    await browser.waitFor("document.querySelector('.question-navigation > p').textContent.includes('no longer available')");
    assert.equal(await browser.evaluate("document.querySelectorAll('fieldset:not([hidden])').length"), 0, "New snapshots must not silently select a replacement.");
    assert.deepEqual(f.posts, []); assert.deepEqual(browser.exceptions, []);
  });

test("implementation confirmation keeps focus and drafts, retries exact uncertain decisions, and collapses durable history",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    let attempts = 0;
    const f = await fixture(t, { onPost: ({ path, data, current }) => {
      if (!path.startsWith("/api/implementation-confirmations/")) return;
      if (++attempts === 1) throw new Error("Lost response before a confirmed decision.");
      const confirmation = current.workflow.implementationConfirmations[0];
      confirmation.status = data.decision; confirmation.canDecide = false;
      confirmation.message = "Implementation declined. No planning or code changes started.";
      current.workflow.status = "ready";
      return { confirmationId: confirmation.id, decision: data.decision };
    } });
    const { browser } = f;
    f.current.workflow.status = "waiting-confirmation";
    f.current.workflow.questionInteraction = null;
    f.current.accessRequests = [];
    f.current.workflow.implementationConfirmations = [{
      id: "confirm:request", requestId: "request", requestIds: ["request"], routeResultId: "router-result",
      design: source.design, afterDesignResultId: null, status: "pending", canDecide: true,
      summary: "Implement the agreed changes.", message: "Waiting for your decision.", requests: [{ id: "request", message: "Implement it." }],
    }];
    await browser.call("Page.navigate", { url: f.url });
    const selector = '[data-implementation-decision="cancelled"]';
    await browser.waitFor(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`);
    await browser.evaluate(`globalThis.originalConfirmation = document.querySelector('.implementation-confirmation');
      document.querySelector('#message').value = 'Preserve my next request';
      document.querySelector(${JSON.stringify(selector)}).focus()`);
    f.update();
    await browser.waitFor("document.querySelector('.implementation-confirmation') === globalThis.originalConfirmation");
    assert.equal(await browser.evaluate("document.activeElement.dataset.implementationDecision"), "cancelled");
    for (const width of [1280, 320]) for (const theme of ["light", "dark"]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate(`document.body.dataset.theme = ${JSON.stringify(theme)}`);
      const fits = await browser.evaluate(`(() => {
        const card = document.querySelector('.implementation-confirmation');
        return card.scrollWidth <= card.clientWidth + 1 && [...card.querySelectorAll('button')].every(button =>
          button.getBoundingClientRect().width <= card.getBoundingClientRect().width);
      })()`);
      assert.equal(fits, true, `${width} ${theme}`);
      await browser.evaluate("document.querySelector('.implementation-confirmation').scrollIntoView({ block:'center' })");
      await capture(browser, `implementation-confirmation-${width}-${theme}`, { width, theme, fits });
    }
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); document.querySelector(${JSON.stringify(selector)}).click()`);
    await browser.waitFor("document.querySelector('.implementation-confirmation [role=alert]').textContent.includes('Lost response')");
    assert.equal(attempts, 1);
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('[data-implementation-decision]')].map(b => b.disabled)"), [true, true, false]);
    await click(browser, selector);
    await browser.waitFor("document.querySelector('.implementation-confirmation').open === false");
    assert.deepEqual(f.posts.filter(p => p.path.includes("implementation-confirmations")).map(p => p.data), [
      { decision: "cancelled" }, { decision: "cancelled" },
    ]);
    assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Preserve my next request");
    assert.equal(await browser.evaluate("document.activeElement.tagName"), "SUMMARY");
    assert.equal(f.posts.some(p => ["/api/requests", "/api/answers"].includes(p.path)), false);
    await browser.call("Page.reload");
    await browser.waitFor("document.querySelector('.implementation-confirmation summary')?.textContent === 'Implementation declined'");
    assert.equal(await browser.evaluate("document.querySelector('.implementation-confirmation').open"), false);
  });

test("Conversation Markdown renders formatted responses, stays inert and fits narrow themed panels",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const f = await fixture(t, { onPost: ({ path }) => path === "/api/navigation/open"
      ? { opened: true, instanceId: "markdown-link" } : undefined });
    const { browser } = f;
    const source = "# Data sources\n\nUse **AKShare** for *prototypes*, not ~~production~~. Keep `observed_at`.\nNext line.\n\n" +
      "| Need | Source | Notes |\n|---|:---:|---:|\n| Prototype | AKShare | Delayed |\n| Production | Licensed vendor | Contract |\n\n" +
      "3. Read the terms\n4. Choose a source\n\n- [x] Inspect\n- [ ] Decide\n\n> Keep this decision separate from implementation.\n\n" +
      "```js\nconst value = '<script>doNotRun()</script>'; // " + "x".repeat(180) + "\n```\n\n" +
      "[Documentation](https://example.com/docs?a=1&amp;b=2) and https://example.com/plain.\n\n" +
      "[Bad](javascript:alert(1)) [Encoded](jav&#x61;script:alert(1)) [Data](data:text/html,evil) " +
      "[Credentials](https://user:secret@example.com/) [Local](/api/runtime/close)\n\n" +
      "![Remote image](https://invalid.example/markdown-image)\n\n" +
      "<script>globalThis.markdownExecuted=true</script>\n\n<img src='/markdown-image' onerror='globalThis.markdownExecuted=true'>\n\n" +
      "&lt;img src='/encoded-image' onerror='globalThis.markdownExecuted=true'&gt; &amp; &#169;\n\nUnclosed **emphasis";
    f.current.workflow.status = "ready";
    f.current.workflow.questionInteraction = null;
    f.current.accessRequests = [];
    f.current.messages.push({ id: "markdown-response", kind: "assistant", role: "agent", requestId: "request",
      text: source, timestamp: "2026-09-15T00:00:02Z" });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('[data-entry-id=\"markdown-response\"] table')");
    const rendered = await browser.evaluate(`(() => {
      const root = document.querySelector('[data-entry-id="markdown-response"] .conversation-text');
      globalThis.retainedMarkdown = root;
      return {
        heading: root.querySelector('h1').textContent, bold: root.querySelector('strong').textContent,
        italic: root.querySelector('em').textContent, deleted: root.querySelector('s').textContent,
        columns: [...root.querySelectorAll('th')].map(n => n.textContent), rows: root.querySelectorAll('tbody tr').length,
        orderedStart: root.querySelector('ol').start, tasks: [...root.querySelectorAll('input')].map(n => [n.disabled,n.checked]),
        lineBreak: !!root.querySelector('br'), code: root.querySelector('pre code').textContent,
        links: [...root.querySelectorAll('a')].map(n => ({href:n.href,target:n.target,rel:n.rel})),
        active: root.querySelectorAll('script,img,iframe,object,embed,style,form').length,
        entities: root.textContent.includes("&lt;") === false && root.textContent.includes("& ©"),
        literalHtml: root.textContent.includes("<img src='/encoded-image'"),
        executed: !!globalThis.markdownExecuted, incomplete: root.textContent.includes('Unclosed **emphasis')
      };
    })()`);
    assert.equal(rendered.heading, "Data sources");
    assert.equal(rendered.bold, "AKShare"); assert.equal(rendered.italic, "prototypes"); assert.equal(rendered.deleted, "production");
    assert.deepEqual(rendered.columns, ["Need", "Source", "Notes"]); assert.equal(rendered.rows, 2);
    assert.equal(rendered.orderedStart, 3); assert.deepEqual(rendered.tasks, [[true, true], [true, false]]);
    assert.equal(rendered.lineBreak, true); assert.match(rendered.code, /<script>doNotRun\(\)<\/script>/);
    assert.deepEqual(rendered.links.map(link => link.href), ["https://example.com/docs?a=1&b=2", "https://example.com/plain"]);
    assert.ok(rendered.links.every(link => link.target === "_blank" && link.rel === "noreferrer noopener"));
    assert.equal(rendered.active, 0); assert.equal(rendered.executed, false);
    assert.equal(rendered.entities, true); assert.equal(rendered.literalHtml, true); assert.equal(rendered.incomplete, true);
    assert.equal(f.current.messages.at(-1).text, source);
    for (const width of [1280, 390, 320]) for (const theme of ["light", "dark"]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)};
        document.querySelector('[data-entry-id="markdown-response"]').scrollIntoView({block:'start'});
        document.querySelector('#messages').scrollTop=0;`);
      const geometry = await browser.evaluate(`(() => {
        const root = document.querySelector('[data-entry-id="markdown-response"] .conversation-text');
        const r = root.getBoundingClientRect();
        return { width:r.width, scrollWidth:root.scrollWidth, pageWidth:document.documentElement.scrollWidth,
          viewport:innerWidth, color:getComputedStyle(root).color,
          overflows:[...root.querySelectorAll('[data-document-overflow]')].map(n=>({client:n.clientWidth,scroll:n.scrollWidth})),
          bodyWhitespace:getComputedStyle(root).whiteSpace, codeWhitespace:getComputedStyle(root.querySelector('pre')).whiteSpace };
      })()`);
      assert.ok(geometry.width > 0);
      assert.ok(geometry.scrollWidth <= Math.ceil(geometry.width), JSON.stringify(geometry));
      assert.ok(geometry.pageWidth <= geometry.viewport, JSON.stringify(geometry));
      assert.equal(geometry.bodyWhitespace, "normal"); assert.equal(geometry.codeWhitespace, "pre");
      assert.ok(geometry.overflows[1].scroll > geometry.overflows[1].client, "Long code scrolls inside its own container.");
      if (width === 320) assert.ok(geometry.overflows[0].scroll > geometry.overflows[0].client, "Narrow tables scroll locally.");
      await capture(browser, `conversation-markdown-${width}-${theme}`, geometry);
    }
    f.current.messages.push({ id: "later-response", kind: "assistant", role: "agent", requestId: "request",
      text: "A **later** response.", timestamp: "2026-09-15T00:00:03Z" });
    f.update();
    await browser.waitFor("document.querySelector('[data-entry-id=\"later-response\"] strong')");
    assert.equal(await browser.evaluate("retainedMarkdown === document.querySelector('[data-entry-id=\"markdown-response\"] .conversation-text')"), true);
    assert.deepEqual(f.posts, []);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await click(browser, '[data-entry-id="markdown-response"] a');
    await browser.waitFor("!document.querySelector('[data-entry-id=\"markdown-response\"] a').hasAttribute('aria-busy')");
    assert.deepEqual(f.posts, [{ path: "/api/navigation/open", data: { url: "https://example.com/docs?a=1&b=2", focus: true } }]);
    assert.ok(!f.requests.some(path => /markdown-image|encoded-image/.test(path)));
    assert.deepEqual(browser.exceptions, []);
  });

test("Quick requests append editable text and only explicit Send uses the ordinary request envelope",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('#send').disabled === false");
    const presets = await browser.evaluate("Array.from(document.querySelectorAll('[data-quick-request]'), button => ({label:button.textContent,text:button.value,type:button.type}))");
    assert.deepEqual(presets.map(preset => preset.label), ["Understand existing project", "Design something new",
      "Revise the design", "Implement agreed design", "Explain current design"]);
    assert.ok(presets.every(preset => preset.type === "button" && preset.text.length > 0));
    assert.match(presets[0].text, /existing code.*questions.*Don't change the code/);
    assert.match(presets[3].text, /current agreed Design.*review/);
    let draft = "  My existing draft\nKeep these constraints.  ";
    await browser.evaluate(`document.querySelector('#message').value=${JSON.stringify(draft)};
      document.querySelector('#message').setSelectionRange(0, ${draft.length});`);
    for (let index = 0; index < presets.length; index++) {
      await click(browser, "#quick-requests summary");
      await click(browser, `[data-quick-request]:nth-of-type(${index + 1})`);
      draft += `\n\n${presets[index].text}`;
      assert.equal(await browser.evaluate("document.querySelector('#message').value"), draft);
      assert.equal(await browser.evaluate("document.querySelector('#quick-requests').open"), false);
      assert.equal(await browser.evaluate("document.activeElement.id"), "message");
      assert.equal(await browser.evaluate("document.querySelector('#message').selectionStart"), draft.length);
      assert.equal(await browser.evaluate("document.querySelector('#current-state-title').textContent"), "Permission response needed",
        "Adding a preset must not mask the fixture's unresolved permission.");
      assert.deepEqual(f.posts, [], "Choosing a preset must not submit work, answers or permission decisions.");
    }
    f.update();
    await browser.evaluate("new Promise(resolve=>setTimeout(resolve,100))");
    assert.equal(await browser.evaluate("document.querySelector('#message').value"), draft);
    await browser.call("Input.insertText", { text: "\nOnly work on the local files." });
    draft += "\nOnly work on the local files.";
    await click(browser, "#send");
    await browser.waitFor("document.querySelector('#message').value === ''");
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].path, "/api/requests");
    assert.equal(f.posts[0].data.message, draft);
    assert.deepEqual(Object.keys(f.posts[0].data).sort(), ["id", "message", "receivedAt"],
      "No preset identifier, structured action, role override or hidden approval is sent.");
    assert.deepEqual(browser.exceptions, []);
  });

test("Quick requests support keyboard selection and dismissal without submitting a draft",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('#send').disabled === false");
    const key = async (key, windowsVirtualKeyCode) => {
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode,
        ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode });
    };
    await browser.evaluate("document.querySelector('#quick-requests summary').focus()");
    await key("Enter", 13);
    await browser.waitFor("document.querySelector('#quick-requests').open");
    await key("Tab", 9);
    assert.equal(await browser.evaluate("document.activeElement.textContent"), "Understand existing project");
    await key("Enter", 13);
    assert.equal(await browser.evaluate("document.querySelector('#message').value"),
      await browser.evaluate("document.querySelector('[data-quick-request]').value"));
    assert.equal(await browser.evaluate("document.activeElement.id"), "message");
    assert.deepEqual(f.posts, []);
    await click(browser, "#quick-requests summary");
    await key("Escape", 27);
    assert.equal(await browser.evaluate("document.querySelector('#quick-requests').open"), false);
    assert.equal(await browser.evaluate("document.activeElement === document.querySelector('#quick-requests summary')"), true);
    await click(browser, "#quick-requests summary");
    await click(browser, "#project-name");
    assert.equal(await browser.evaluate("document.querySelector('#quick-requests').open"), false);
    assert.deepEqual(f.posts, []);
    assert.deepEqual(browser.exceptions, []);
  });

test("Quick requests remain reachable in narrow and desktop themes without changing workflow state",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    Object.assign(f.current.workflow, { status: "ready", questionInteraction: null, lastHandoff: null, canStop: false });
    f.current.accessRequests = [];
    f.current.design = { binding: { revisionId: null, digest: null }, content: null };
    const before = JSON.stringify(f.current);
    for (const width of [1280, 390, 320]) for (const theme of ["light", "dark"]) {
      f.preferences.theme = theme;
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor(`!document.querySelector('#send').disabled && document.body.dataset.theme==='${theme}'`);
      await click(browser, "#quick-requests summary");
      const geometry = await browser.evaluate(`(() => {
        const menu=document.querySelector('#quick-request-options'), r=menu.getBoundingClientRect();
        return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
          overflow:menu.scrollWidth-menu.clientWidth,
          visible:Array.from(menu.querySelectorAll('button'), button=>{
            const b=button.getBoundingClientRect();
            return button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));
          })};
      })()`);
      assert.equal(geometry.fits, true);
      assert.equal(geometry.overflow, 0);
      assert.deepEqual(geometry.visible, [true, true, true, true, true]);
      await capture(browser, `quick-requests-${width}-${theme}`, geometry);
      await click(browser, "[data-quick-request]:last-child");
      assert.deepEqual(f.posts, []);
      assert.equal(JSON.stringify(f.current), before);
    }
    assert.deepEqual(browser.exceptions, []);
  });

for (const responseKind of ["accepted", "wrong-identity", "wrong-status"]) test(
  `composer handles ${responseKind} acknowledgement before a delayed status refresh`, { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const acknowledgement = Promise.withResolvers(), refreshGate = Promise.withResolvers();
    const postStarted = Promise.withResolvers(), snapshotStarted = Promise.withResolvers();
    let holdRefresh = false, delayedRefreshes = 0;
    const f = await fixture(t, {
      requestStatus: responseKind === "wrong-status" ? 200 : 202,
      onPost: async ({ path, data }) => {
        assert.equal(path, "/api/requests");
        holdRefresh = true;
        postStarted.resolve();
        await acknowledgement.promise;
        return { requestId: responseKind === "wrong-identity" ? "different-request" : data.id };
      },
      onSnapshot: async () => { if (holdRefresh) { delayedRefreshes++; snapshotStarted.resolve(); await refreshGate.promise; } },
    }), { browser } = f;
    f.current.accessRequests = [];
    f.current.workflow.questionInteraction = null;
    f.current.workflow.status = "ready";
    try {
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 700, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor("document.querySelector('#send') && !document.querySelector('#send').disabled");
      await browser.evaluate("document.querySelector('#message').value='Exact delayed request.'");
      await click(browser, "#send");
      await postStarted.promise; f.update(); await snapshotStarted.promise;
      await browser.waitFor("document.querySelector('#send').disabled");
      await browser.evaluate('document.querySelector("#send").click()');
      assert.equal(f.posts.length, 1, "Busy Send cannot duplicate the request.");
      assert.equal(await browser.evaluate("document.querySelector('#quick-requests summary').getAttribute('aria-disabled')"), "true");
      assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('[data-quick-request]')).every(button=>button.disabled)"), true);
      await browser.evaluate("document.querySelector('[data-quick-request]').dispatchEvent(new MouseEvent('click', {bubbles:true}))");
      assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Exact delayed request.");
      assert.notEqual(await browser.evaluate("document.querySelector('#notice').textContent"), "Request received.");
      acknowledgement.resolve();
      await browser.waitFor("!document.querySelector('#send').disabled");
      if (responseKind === "accepted") {
        assert.equal(await browser.evaluate("document.querySelector('#message').value"), "");
        assert.equal(await browser.evaluate("document.querySelector('#message').disabled"), false);
        assert.equal(await browser.evaluate("document.querySelector('#quick-requests summary').getAttribute('aria-disabled')"), "false");
        assert.equal(await browser.evaluate("document.querySelector('#current-state-title').textContent"), "Request received; awaiting workflow activity.");
        await browser.evaluate("document.querySelector('#message').value='Next draft remains editable.'");
      } else {
        assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Exact delayed request.");
        assert.equal(await browser.evaluate("document.querySelector('#send').textContent"), "Retry exact request");
        const retry = await browser.evaluate(`(() => {
          const input=document.querySelector("#message"),button=document.querySelector("#send"),
            r=input.getBoundingClientRect(),b=button.getBoundingClientRect(),style=getComputedStyle(input);
          return {left:b.left,right:b.right,bottom:b.bottom,inputRight:r.right,inputBottom:r.bottom,
            textRight:r.left+input.clientLeft+input.clientWidth-parseFloat(style.paddingRight),
            label:button.getAttribute("aria-label"),clipped:button.scrollWidth>button.clientWidth};
        })()`);
        assert.ok(retry.textRight < retry.left && retry.right < retry.inputRight && retry.bottom < retry.inputBottom);
        assert.equal(retry.label, "Retry exact request");
        assert.equal(retry.clipped, false, "The inline retry label remains readable.");
        assert.equal(await browser.evaluate("document.querySelector('#quick-requests summary').getAttribute('aria-disabled')"), "true");
        await browser.evaluate("document.querySelector('[data-quick-request]').dispatchEvent(new MouseEvent('click', {bubbles:true}))");
        assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Exact delayed request.");
        assert.notEqual(await browser.evaluate("document.querySelector('#notice').textContent"), "Request received.");
        await click(browser, "#send");
        await browser.waitFor("!document.querySelector('#send').disabled");
        assert.deepEqual(f.posts[1], f.posts[0]);
      }
      assert.ok(delayedRefreshes > 0, "The status response is still withheld when composer state settles.");
      assert.equal(f.posts[0].data.message, "Exact delayed request.");
      assert.deepEqual(browser.exceptions, []);
    } finally { acknowledgement.resolve(); holdRefresh = false; refreshGate.resolve(); }
  });

test("history glyph palette is distinct across screenshot-equivalent types in narrow and desktop themes",
  { skip: !browserAvailable, timeout: 120_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    Object.assign(f.current.workflow, { status: "ready", questionInteraction: null, lastHandoff: null,
      canStop: false, canSend: true });
    f.current.accessRequests = [];
    f.current.design = { binding: { revisionId: null, digest: null }, content: null };
    f.current.messages = [{ id: "request:fixture", kind: "user", requestId: "fixture",
      text: "Read the synthetic package. Renderer-only color fixture.", timestamp: "2026-09-22T00:00:00Z", queueState: "completed" }];
    f.current.historyRequests = [{ id: "fixture", receivedAt: "2026-09-22T00:00:00Z" }];
    f.current.recoveries = [{ id: "fixture-recovery", recoveredAt: "2026-09-22T00:00:08Z" }];
    f.current.events = [
      ["human.role", { role: "router" }], ["human.role", { role: "agent" }],
      ["permission.requested", {}], ["permission.granted", {}], ["human.native-tool", {}],
      ["human.handoff", { kind: "answer" }], ["human.ready", {}],
      ["human.handoff", { kind: "execution-failure" }], ["permission.denied", {}], ["human.stopped", {}],
    ].map(([type, data], i) => ({ sequence: i + 1, type, source: "system", data,
      summary: "Renderer fixture only; no native workflow or permissions.",
      timestamp: `2026-09-22T00:00:${String(i < 6 ? i + 1 : i + 3).padStart(2, "0")}Z` }));
    const expected = ["conversation", "structure", "execution", "design", "design", "conversation",
      "conversation", "execution", "execution", "neutral", "neutral", "neutral"];
    const colorFor = (theme, tone) => ({
      light: { conversation: "rgb(29, 95, 167)", structure: "rgb(123, 66, 178)", design: "rgb(138, 89, 0)", execution: "rgb(8, 111, 98)" },
      dark: { conversation: "rgb(121, 184, 255)", structure: "rgb(200, 164, 244)", design: "rgb(230, 184, 92)", execution: "rgb(99, 199, 182)" },
    }[theme][tone]);
    for (const width of [1280, 390, 320]) for (const theme of ["light", "dark"]) {
      f.preferences.theme = theme;
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor(`document.querySelectorAll('#state-history svg').length === ${expected.length} && document.body.dataset.theme === '${theme}'`);
      await browser.evaluate(`document.querySelector('.conversation-current').scrollIntoView({block:'nearest'});
        document.querySelector('#state-history').scrollTop=0; document.querySelector('#message').value='Unsent fixture draft';`);
      const appearance = await browser.evaluate(`(() => {
        const items=[...document.querySelectorAll('#state-history li')];
        return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,
          nodes:items.map(n=>{const dot=n.querySelector('.state-history-dot'),svg=dot.querySelector('svg'),r=dot.getBoundingClientRect();
            return {label:n.querySelector('.state-history-label').textContent,tone:svg.dataset.historyTone,
              color:getComputedStyle(svg).color,stroke:getComputedStyle(svg).stroke,
              circle:getComputedStyle(dot).borderTopColor,background:getComputedStyle(dot).backgroundColor,
              spine:getComputedStyle(n,'::after').backgroundColor,width:r.width,height:r.height,
              svgWidth:svg.getBoundingClientRect().width};})};
      })()`);
      assert.deepEqual(appearance.nodes.map(n => n.tone), expected);
      assert.ok(appearance.pageWidth <= width, "History fixture must not overflow horizontally.");
      for (const node of appearance.nodes) {
        if (node.tone !== "neutral") assert.equal(node.color, colorFor(theme, node.tone), `${theme}/${node.label}`);
        assert.equal(node.stroke, node.color);
        assert.equal(node.circle, appearance.nodes[0].circle);
        assert.equal(node.spine, appearance.nodes[0].spine);
        assert.equal(node.background, appearance.nodes[0].background);
        assert.equal(node.svgWidth, 18);
      }
      assert.equal(new Set(appearance.nodes.filter(n => n.tone !== "neutral").map(n => n.color)).size, 4);
      assert.equal(new Set(appearance.nodes.filter(n => n.tone === "neutral").map(n => n.color)).size, 1);
      await capture(browser, `history-tints-${width}-${theme}`, appearance);
      const selector = '#state-history li:nth-child(4) button';
      await click(browser, selector);
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      const interaction = await browser.evaluate(`(() => {
        const selected=document.querySelector('#state-history li:nth-child(4)'), focused=document.activeElement;
        const r=focused.getBoundingClientRect();
        return {selected:selected.dataset.selected,selectedGlyph:getComputedStyle(selected.querySelector('svg')).color,
          focusedLabel:focused.getAttribute('aria-label'),outline:getComputedStyle(focused).outlineStyle,
          outlineWidth:getComputedStyle(focused).outlineWidth,focusVisible:focused.matches(':focus-visible'),
          withinWidth:r.left>=0&&r.right<=innerWidth,
          draft:document.querySelector('#message').value};})()`);
      assert.equal(interaction.selected, "true");
      assert.equal(interaction.selectedGlyph, colorFor(theme, "design"));
      assert.match(interaction.focusedLabel, /^Permission granted/);
      assert.equal(interaction.focusVisible, true); assert.equal(interaction.outline, "solid");
      assert.equal(interaction.outlineWidth, "2px"); assert.equal(interaction.withinWidth, true);
      assert.equal(interaction.draft, "Unsent fixture draft");
      await capture(browser, `history-tints-${width}-${theme}-selected-focus`, interaction);
    }
    assert.deepEqual(f.posts, []);
    assert.deepEqual(browser.exceptions, []);
  });

test("Design divider, Tandem badge and body-sized summary preserve renderer layout and interaction",
  { skip: !browserAvailable, timeout: 120_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    Object.assign(f.current.workflow, { status: "ready", questionInteraction: null, lastHandoff: null, canStop: false });
    f.current.accessRequests = [];
    f.current.design.content.summary = "The complete booking-sheet UX remains unchanged: selected item label and code, member, start and end date and time, availability, maintenance exclusions and conflicting bookings are visible before confirmation. " +
      "Returning equipment updates its availability without losing the original booking. This representative renderer-only summary also wraps a long reference: " + "equipment-reference-".repeat(8);
    f.current.design.binding.digest = policyHash(f.current.design.content);
    f.current.messages = Array.from({ length: 24 }, (_, i) => ({
      id: `fixture-${i}`, kind: i % 2 ? "assistant" : "user", role: i % 2 ? "agent" : undefined,
      text: `Fixture exchange ${i + 1}.`, timestamp: `2026-09-22T00:00:${String(i).padStart(2, "0")}Z`,
    }));
    const settle = () => browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
    const state = () => browser.evaluate(`(() => {
      const layout=document.querySelector('.human-layout'),d=document.querySelector('#design-panel'),
        c=document.querySelector('#conversation-panel'),s=document.querySelector('#workspace-divider'),
        summary=document.querySelector('#design-summary'),m=document.querySelector('#messages'),badge=document.querySelector('.conversation-assistant .conversation-avatar'),
        user=document.querySelector('.conversation-user .conversation-avatar'),style=getComputedStyle(summary),r=s.getBoundingClientRect(),
        diagram=document.querySelector('#design-artifacts svg[viewBox]');
      const swatch=document.createElement('canvas').getContext('2d'),rgb=color=>{
        swatch.fillStyle=color;swatch.fillRect(0,0,1,1);return [...swatch.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255);
      },lum=rgb=>rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      const badgeFill=rgb(getComputedStyle(badge).backgroundColor),badgeInk=rgb(getComputedStyle(badge).color),
        background=lum(badgeFill),foreground=lum(badgeInk);
      return {width:layout.getBoundingClientRect().width,design:d.getBoundingClientRect().width,conversation:c.getBoundingClientRect().width,
        hidden:s.hidden,dragging:layout.dataset.resizing==='true',cursor:getComputedStyle(s).cursor,touchAction:getComputedStyle(s).touchAction,
        min:Number(s.getAttribute('aria-valuemin')),max:Number(s.getAttribute('aria-valuemax')),value:Number(s.getAttribute('aria-valuenow')),
        point:{x:r.x+r.width/2,y:r.y+90},summarySize:style.fontSize,summaryLine:style.lineHeight,bodySize:getComputedStyle(document.body).fontSize,
        summaryFits:summary.scrollWidth<=summary.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,
        badge:{text:badge.textContent,color:getComputedStyle(badge).color,fill:getComputedStyle(badge).backgroundColor,
          fillRGB:badgeFill,contrast:(Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05),
          width:badge.getBoundingClientRect().width,height:badge.getBoundingClientRect().height,radius:getComputedStyle(badge).borderRadius},
        user:{text:user.textContent,color:getComputedStyle(user).color,fill:getComputedStyle(user).backgroundColor},
        scroll:m.scrollTop,scrollMax:m.scrollHeight-m.clientHeight,draft:document.querySelector('#message').value,
        viewBox:diagram?.getAttribute('viewBox'),focused:document.activeElement===s,
        focusVisible:s.matches(':focus-visible'),outline:getComputedStyle(s).outlineWidth};
    })()`);
    const mouse = (type, point, extra = {}) => browser.call("Input.dispatchMouseEvent", { type, ...point, ...extra });
    const begin = async () => {
      const before = await state();
      await mouse("mouseMoved", before.point);
      await mouse("mousePressed", before.point, { button: "left", buttons: 1, clickCount: 1 });
      await browser.waitFor("document.querySelector('.human-layout').dataset.resizing==='true'");
      return before;
    };
    const drag = async delta => {
      const before = await begin(), point = { x: before.point.x + delta, y: before.point.y };
      await mouse("mouseMoved", point, { button: "left", buttons: 1 });
      await mouse("mouseReleased", point, { button: "left", clickCount: 1 });
      await settle();
      assert.equal((await state()).dragging, false);
      return state();
    };
    const key = async (name, code, modifiers = 0) => {
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
      await settle();
    };
    const check = value => {
      assert.equal(value.overflow, false); assert.equal(value.summaryFits, true);
      assert.equal(value.summarySize, value.bodySize);
      assert.ok(Math.abs(parseFloat(value.summaryLine) - parseFloat(value.bodySize) * 1.55) < .01);
      assert.equal(value.badge.text, "T"); assert.equal(value.user.text, "Y");
      assert.equal(value.badge.width, 21); assert.equal(value.badge.height, 21); assert.equal(value.badge.radius, "6px");
      assert.notEqual(value.badge.fill, value.user.fill); assert.notEqual(value.badge.color, value.user.color);
      assert.ok(value.badge.contrast >= 4.5);
      assert.ok(value.badge.fillRGB[2] > value.badge.fillRGB[0] + .1 && value.badge.fillRGB[2] > value.badge.fillRGB[1],
        "The small badge has a visibly blue fill, not a neutral gray or a solid saturated-blue block.");
      assert.ok(Math.max(...value.badge.fillRGB) - Math.min(...value.badge.fillRGB) < .25);
      assert.equal(value.draft, "Unsent draft survives resizing");
      assert.ok(value.viewBox);
      if (!value.hidden) {
        assert.ok(value.design >= 279.99); assert.ok(value.conversation >= 339.99);
        assert.ok(Math.abs(value.design + value.conversation - value.width) < 1);
        assert.ok(Math.abs(value.value - value.design / value.width * 100) < .01);
        assert.ok(value.value >= value.min - .01 && value.value <= value.max + .01);
      }
    };
    for (const theme of ["light", "dark"]) {
      f.preferences.theme = theme;
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor(`document.querySelector('.conversation-assistant') && document.querySelector('#design-artifacts svg[viewBox]') && document.body.dataset.theme==='${theme}'`);
      await browser.evaluate(`document.querySelector('#message').value='Unsent draft survives resizing';
        document.querySelector('#messages').scrollTop=120;window.fixtureMessage=document.querySelector('.conversation-assistant');`);
      await settle();
      const initial = await state(); check(initial);
      assert.ok(Math.abs(initial.design / initial.width - .55) < .001);
      assert.equal(initial.cursor, "col-resize"); assert.equal(initial.touchAction, "none");
      await capture(browser, `panels-${theme}-default`, initial);
      const right = await drag(120); check(right); assert.ok(right.design > initial.design + 119);
      const left = await drag(-200); check(left); assert.ok(left.design < right.design - 199);
      assert.equal(left.viewBox, initial.viewBox);
      assert.ok(left.scroll > 0 && left.scroll < left.scrollMax - 20, "Resizing must not jump a reader to the latest message.");
      assert.equal(await browser.evaluate("window.fixtureMessage===document.querySelector('.conversation-assistant')"), true);
      const minimum = await drag(-1000); check(minimum); assert.ok(Math.abs(minimum.design - 280) < 1);
      await capture(browser, `panels-${theme}-design-minimum`, minimum);
      const maximum = await drag(2000); check(maximum); assert.ok(Math.abs(maximum.conversation - 340) < 1);
      await capture(browser, `panels-${theme}-conversation-minimum`, maximum);
      await key("Home", 36); assert.ok(Math.abs((await state()).design - 280) < 1);
      await key("ArrowRight", 39); assert.ok(Math.abs((await state()).design - 290) < 1);
      await key("ArrowRight", 39, 8); assert.ok(Math.abs((await state()).design - 330) < 1);
      await key("ArrowLeft", 37); assert.ok(Math.abs((await state()).design - 320) < 1);
      const keyboard = await state(); check(keyboard);
      assert.equal(keyboard.focused, true); assert.equal(keyboard.focusVisible, true); assert.equal(keyboard.outline, "2px");
      await capture(browser, `panels-${theme}-keyboard-focus`, keyboard);
      await key("End", 35); assert.ok(Math.abs((await state()).conversation - 340) < 1);
      await key("Home", 36);
      const beforeCancel = await begin();
      await mouse("mouseMoved", { x: beforeCancel.point.x + 100, y: beforeCancel.point.y }, { button: "left", buttons: 1 });
      await key("Escape", 27);
      await mouse("mouseReleased", beforeCancel.point, { button: "left", clickCount: 1 });
      assert.ok(Math.abs((await state()).design - beforeCancel.design) < 1);
      assert.equal((await state()).dragging, false);
      const touchBefore = await state();
      await browser.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchBefore.point, id: 3 }] });
      await browser.call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchBefore.point.x + 100, y: touchBefore.point.y, id: 3 }] });
      assert.ok((await state()).design > touchBefore.design + 90);
      await browser.call("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await settle();
      assert.equal((await state()).dragging, false);
      assert.ok(Math.abs((await state()).design - touchBefore.design) < 1);
      await browser.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchBefore.point, id: 4 }] });
      await browser.call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchBefore.point.x + 100, y: touchBefore.point.y, id: 4 }] });
      await browser.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await settle(); assert.equal((await state()).dragging, false);
      assert.ok((await state()).design > touchBefore.design + 90);
      const captureBefore = await begin();
      await mouse("mouseMoved", { x: captureBefore.point.x + 80, y: captureBefore.point.y }, { button: "left", buttons: 1 });
      await browser.evaluate("document.querySelector('#workspace-divider').releasePointerCapture(1)");
      await mouse("mouseMoved", { x: captureBefore.point.x + 81, y: captureBefore.point.y }, { button: "left", buttons: 1 });
      await mouse("mouseReleased", captureBefore.point, { button: "left", clickCount: 1 });
      await settle();
      assert.equal((await state()).dragging, false);
      assert.ok(Math.abs((await state()).design - captureBefore.design) < 1);
      // Resize while dragging must release capture and keep the stacked layout usable.
      await begin();
      for (const width of [390, 320, 1280, 800, 661]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await settle();
        const resized = await state(); check(resized);
        assert.equal(resized.hidden, width <= 660); assert.equal(resized.dragging, false);
        await browser.evaluate("document.querySelector('#canvas-scroll').scrollTop=0;window.scrollTo(0,0)");
        await capture(browser, `panels-${theme}-resize-${width}`, resized);
      }
      await mouse("mouseReleased", { x: 100, y: 100 }, { button: "left", clickCount: 1 });
      // A fresh page still uses the original medium-width default rather than saving a preference.
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor("document.querySelector('#design-artifacts svg[viewBox]')");
      await settle(); assert.ok(Math.abs((await state()).design / 800 - .47) < .001);
      for (const font of ["larger", "largest"]) {
        await browser.evaluate(`document.body.dataset.fontSize='${font}';document.querySelector('#message').value='Unsent draft survives resizing'`);
        await settle(); check(await state());
      }
    }
    assert.deepEqual(f.posts, []); assert.deepEqual(browser.exceptions, []);
  });

test("compaction approval uses real clicks and visible native status across themes and short panels",
  { skip: !browserAvailable, timeout: 90_000 }, async (t) => {
    let sequence = 0, gate;
    const f = await fixture(t, { onPost: async ({ path, data, current }) => {
      if (path === "/api/context/compaction/request") return { requestId: `approval-${++sequence}` };
      if (path === "/api/context/compaction/decision" && data.approve) {
        current.workflow.compaction = { active: true, requested: true, canRequest: false, error: null };
        current.workflow.canSend = false; f.update();
        await gate.promise;
        current.workflow.compaction = { active: false, requested: false, canRequest: true, error: null };
        current.workflow.canSend = true; f.update();
        return { compacted: true };
      }
      return { compacted: false };
    } });
    f.current.workflow.status = "ready"; f.current.workflow.canStop = false; f.current.workflow.questionInteraction = null;
    f.current.accessRequests = [];
    f.current.workflow.compaction = { active: false, requested: false, canRequest: true, error: null };
    const { browser } = f;
    for (const width of [320, 1000]) for (const theme of ["light", "dark"]) {
      f.preferences.theme = theme;
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 420, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor("document.querySelector('#request-compaction').disabled === false");
      await click(browser, '#canvas-settings > summary');
      await click(browser, '#request-compaction');
      await browser.waitFor("document.querySelector('#compaction-approval').open");
      const measurement = await browser.evaluate(`(() => {
        const node=document.querySelector('#compaction-approval'), r=node.getBoundingClientRect(), style=getComputedStyle(node);
        const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
        const rgb=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3);};
        const luminance=rgb=>rgb.map(value=>value/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0);
        const a=luminance(rgb(style.color)),b=luminance(rgb(style.backgroundColor));
        return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),focus:document.activeElement.id};
      })()`);
      assert.ok(measurement.x >= 0 && measurement.right <= width && measurement.y >= 0 && measurement.bottom <= 420, JSON.stringify(measurement));
      assert.ok(measurement.contrast >= 4.5, JSON.stringify(measurement));
      assert.equal(measurement.focus, "cancel-compaction");
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      const focus = await browser.evaluate(`({id:document.activeElement.id,width:getComputedStyle(document.activeElement).outlineWidth,style:getComputedStyle(document.activeElement).outlineStyle})`);
      assert.equal(focus.id, "approve-compaction");
      assert.ok(parseFloat(focus.width) > 0 && focus.style !== "none", JSON.stringify(focus));
      await capture(browser, `compaction-approval-${theme}-${width}`, { ...measurement, focus });
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.waitFor("!document.querySelector('#compaction-approval').open");
    }
    assert.equal(f.posts.filter(({ data }) => data.approve === true).length, 0);
    gate = Promise.withResolvers();
    await click(browser, '#request-compaction');
    await browser.waitFor("document.querySelector('#compaction-approval').open");
    await click(browser, '#approve-compaction');
    await browser.waitFor("document.querySelector('#current-state').textContent.includes('Compacting')");
    assert.equal(await browser.evaluate("document.querySelector('#send').disabled"), true);
    await capture(browser, "compaction-explicit-active", await geometry(browser));
    gate.resolve();
    await browser.waitFor("document.querySelector('#send').disabled === false && document.querySelector('#compaction-status').hidden");
    assert.equal(f.posts.filter(({ data }) => data.approve === true).length, 1);
    f.current.workflow.status = "working"; f.current.workflow.activeRole = "implementer";
    f.current.workflow.compaction = { active: true, requested: false, canRequest: false, error: null }; f.update();
    await browser.waitFor("document.querySelector('#current-state').textContent.includes('Compacting')");
    assert.equal(await browser.evaluate("document.querySelector('#compaction-status').hidden"), true,
      "Routine compaction progress belongs in current status, not the error field.");
    await capture(browser, "compaction-native-background-active", await geometry(browser));
    f.current.workflow.compaction = { active: false, requested: false, canRequest: false, error: "Native failure is visible." }; f.update();
    await browser.waitFor("document.querySelector('#compaction-status').textContent.includes('Native failure is visible')");
    assert.doesNotMatch(await browser.evaluate("document.querySelector('#current-state').textContent"), /Ready|Compacting/);
    assert.deepEqual(browser.exceptions, []);
  });

test("question answer records share the message content column on desktop and narrow layouts",
  { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
    const answer = "Keep the exact source-bound answer.\nWrap this long reference: " + "reference".repeat(28);
    const prepare = async (rendererRoot = publicRoot) => {
      const f = await fixture(t, { rendererRoot });
      f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null;
      f.current.accessRequests = [];
      f.current.messages.push({ id: "answer-record", kind: "user", requestId: "answer-request",
        text: "Question form submission.", timestamp: "2026-09-15T00:01:00Z", queueState: "completed",
        answerDetails: [{ questionId: "scope", sourceResultId: "saved-question-result", role: "designer",
          question: "Which scope should we keep?", answer }] });
      return f;
    };
    const measure = async (f, width) => {
      await f.browser.call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 1, mobile: false });
      await f.browser.call("Page.navigate", { url: f.url });
      await f.browser.waitFor("document.querySelector('[data-entry-id=\"answer-record\"] .question-answer-record')");
      return f.browser.evaluate(`(() => {
        const article=document.querySelector('[data-entry-id="answer-record"]');
        article.scrollIntoView({block:'start'});
        const body=article.querySelector('.conversation-text'), record=article.querySelector('.question-answer-record');
        const row=record.querySelector('[data-question-result-id]');
        return {bodyX:body.getBoundingClientRect().x,recordX:record.getBoundingClientRect().x,
          avatarX:article.querySelector('.conversation-avatar').getBoundingClientRect().x,
          recordWidth:record.clientWidth,recordScrollWidth:record.scrollWidth,
          questionResultId:row.dataset.questionResultId,answer:row.querySelectorAll('p')[1].textContent};
      })()`);
    };
    if (process.env.ANSWER_INDENT_FROZEN_PUBLIC) {
      const old = await prepare(resolve(process.env.ANSWER_INDENT_FROZEN_PUBLIC));
      const broken = await measure(old, 1280);
      assert.ok(broken.bodyX - broken.recordX >= 27, JSON.stringify(broken));
      await capture(old.browser, "question-answer-indent-before", broken);
    }
    const f = await prepare();
    for (const width of [1280, 320]) {
      const result = await measure(f, width);
      assert.ok(Math.abs(result.recordX - result.bodyX) < 1, JSON.stringify(result));
      assert.ok(result.recordScrollWidth <= result.recordWidth + 1, JSON.stringify(result));
      assert.equal(result.questionResultId, "saved-question-result");
      assert.equal(result.answer, answer);
      await capture(f.browser, `question-answer-indent-${width}`, result);
    }
    assert.deepEqual(f.browser.exceptions, []);
  });

test("Recovery keeps earlier question text read-only without replacing original response content",
  { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
    const f = await fixture(t);
    const question = f.current.workflow.questionInteraction.questions[0];
    f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null;
    const message = { id: "earlier-question", kind: "assistant", role: "designer", requestId: "request",
      text: "Exact original Design response.", timestamp: "2026-09-15T00:00:02Z" };
    f.current.messages.push(message);
    const { browser } = f;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('[data-entry-id=\"earlier-question\"] .conversation-text')");
    await browser.evaluate("window.retainedResponse=document.querySelector('[data-entry-id=\"earlier-question\"] .conversation-text')");
    message.questionHistory = [{ ...question, resultId: source.resultId, role: source.role }];
    f.current.recoveries = [{ id: "recovery", recoveredAt: "2026-09-15T00:00:03Z" }];
    f.current.events.push({ sequence: 26, type: "human.ready", source: "system", summary: "Ready for new instructions.",
      timestamp: "2026-09-15T00:00:04Z", data: {} });
    f.update();
    await browser.waitFor("document.querySelector('[data-entry-id=\"earlier-question\"] [data-question-history]')");
    const value = await browser.evaluate(`(() => {
      const row=document.querySelector('[data-entry-id="earlier-question"]'), history=row.querySelector('[data-question-history]');
      return {same:window.retainedResponse===row.querySelector('.conversation-text'),text:row.querySelector('.conversation-text').textContent,
        questions:history.textContent,controls:history.querySelectorAll('input,textarea,select,button').length,
        source:history.querySelector('[data-question-result-id]').dataset.questionResultId,
        states:[...document.querySelectorAll('#state-history .state-history-step')].slice(-2).map(node=>node.textContent)};
    })()`);
    assert.equal(value.same, true);
    assert.match(value.text, /Exact original Design response/);
    assert.match(value.questions, /Which scope should we keep/);
    assert.match(value.questions, /Keep the core/);
    assert.equal(value.controls, 0); assert.equal(value.source, source.resultId);
    assert.match(value.states[0], /Recovery/); assert.match(value.states[1], /Ready/);
    assert.deepEqual(browser.exceptions, []);
  });
async function geometry(browser) {
  return browser.evaluate(`(() => {
    const rect = selector => { const n=document.querySelector(selector); if(!n)return null; const r=n.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
    return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,
      columns:getComputedStyle(document.querySelector('main')).gridTemplateColumns,
      design:rect('#design-panel'), conversation:rect('.human-conversation'),
      messages:rect('#messages'), rail:rect('#state-history'), composer:rect('#composer'), permissions:rect('#access-approval'), permissionContent:rect('#access-requests'),
      thirdColumn:!!document.querySelector('.human-controls'),
      canvasOverflow:document.querySelector('#canvas-scroll')?document.querySelector('#canvas-scroll').scrollWidth-document.querySelector('#canvas-scroll').clientWidth:null};
  })()`);
}
async function click(browser, selector) {
  const measure = () => browser.evaluate(`(async () => {
    const node=document.querySelector(${JSON.stringify(selector)}); node.scrollIntoView({block:'center'});
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    const r=node.getBoundingClientRect(), point={x:r.x+r.width/2,y:r.y+r.height/2};
    if(node.disabled || !node.contains(document.elementFromPoint(point.x,point.y))) throw new Error('Unreachable control: '+${JSON.stringify(selector)}
      +' '+JSON.stringify({disabled:node.disabled,rect:r.toJSON(),hit:document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,240),
        groupOpen:node.closest('.human-loop-question-group')?.open,panel:document.querySelector('#question-panel')?.getBoundingClientRect().toJSON()}));
    return point;
  })()`);
  let point = await measure();
  await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  point = await measure();
  await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

function expansionDesign(format = "svg") {
  const source = format === "svg"
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 1800"><rect id="area" x="0" y="0" width="1800" height="1800" fill="#ddeeff"/><rect x="1300" y="1300" width="500" height="500" fill="#176b58"/></svg>'
    : format === "html"
      ? '<main data-ref="area" style="width:1800px;height:1800px;background:#ddeeff;position:relative"><div style="position:absolute;left:1300px;top:1300px;width:500px;height:500px;background:#176b58">Last section</div></main>'
      : 'flowchart TB\n' + Array.from({ length: 18 }, (_, i) => `step${i}[Step ${i}] --> step${i + 1}[Step ${i + 1}]`).join('\n');
  const content = {
    schemaVersion: "sketch-design/v3", goal: "Read a large artifact without leaving Tandem.",
    summary: "A large source-bound artifact and its supporting notes.", outcomes: [
      { id: "overview", description: "See the whole artifact.", references: ["large"] },
    ],
    artifacts: [
      { schemaVersion: "artifact/v1", format, id: "large", title: `Large ${format} artifact`,
        description: "The final source region remains visible in Fit.", width: 1800, height: 1800, source },
      { schemaVersion: "artifact/v2", format: "markdown", id: "note", title: "Supporting note", noteForArtifactId: "large",
        source: "# Details\n\n" + "Retained selectable content.\n\n".repeat(60) },
    ],
  };
  return { binding: { revisionId: "expanded-revision", digest: policyHash(content) }, content };
}
const settleExpansion = browser => browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
const expansionMetrics = `(() => {
  const section=document.querySelector('.shared-artifact-view'),figure=section.querySelector('figure');
  const box=node=>node.getBoundingClientRect().toJSON();
  return {panel:box(section),image:figure.captureElement?box(figure.captureElement):null,
    view:figure.getViewState?.(),outer:document.querySelector('#canvas-scroll').scrollTop,pageX:scrollX,pageY:scrollY,
    conversation:document.querySelector('#messages').scrollTop,draft:document.querySelector('#message').value};
})()`;
async function escapeExpansion(browser) {
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await settleExpansion(browser);
}

for (const format of ["svg", "html", "mermaid"]) test(`artifact expansion keeps ${format} mounted and restores physical Close/Escape views`,
  { skip: !browserAvailable, timeout: 180_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    f.current.design = expansionDesign(format);
    f.current.messages.push(...Array.from({ length: 35 }, (_, i) => ({
      id: `retained-${i}`, kind: "assistant", role: "agent", requestId: "request",
      text: `Retained conversation ${i}. ` + "This existing message must remain mounted. ".repeat(8),
      timestamp: "2026-09-15T00:00:02Z",
    })));
    for (const [width, height] of [[1280, 900], [390, 700], [390, 400]]) await t.test(`${width}x${height}`, async () => {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor("document.querySelector('[data-artifact-expand]')?.disabled===false");
      await browser.evaluate(`(() => {
        globalThis.retainedFigure=document.querySelector('.source-artifact');
        globalThis.retainedFrame=retainedFigure.captureElement.contentDocument;
        globalThis.frameLoads=0;retainedFigure.captureElement.addEventListener('load',()=>frameLoads++);
        globalThis.expansionKeys=[document,retainedFrame].map(doc=>{
          const keys=new Set(),add=doc.addEventListener.bind(doc),remove=doc.removeEventListener.bind(doc);
          doc.addEventListener=(type,handler,...args)=>{if(type==='keydown')keys.add(handler);return add(type,handler,...args)};
          doc.removeEventListener=(type,handler,...args)=>{if(type==='keydown')keys.delete(handler);return remove(type,handler,...args)};
          return keys;
        });
        document.querySelector('#message').value='Keep my unsent request';
        document.querySelector('#messages').scrollTop=125;
        document.querySelector('[data-artifact-expand]').addEventListener('click',()=>{
          if(!document.querySelector('[data-artifact-expanded]')) globalThis.normalBeforeExpand=${expansionMetrics};
        },true);
      })()`);
      await click(browser, '[data-artifact-zoom="actual"]');
      await browser.evaluate("const viewport=document.querySelector('[data-artifact-viewport]');viewport.scrollLeft=235;viewport.scrollTop=187");
      await click(browser, '[data-artifact-expand]');
      await settleExpansion(browser);
      let expanded = await browser.evaluate(expansionMetrics);
      assert.equal(expanded.panel.x, 0); assert.equal(expanded.panel.y, 0);
      assert.equal(expanded.panel.width, width); assert.equal(expanded.panel.height, height);
      assert.equal(expanded.view.fit, true);
      assert.ok(expanded.image.left >= 0 && expanded.image.right <= width);
      assert.ok(expanded.image.top >= 0 && expanded.image.bottom <= height);
      if (width === 1280) assert.ok(expanded.image.height > 480, JSON.stringify(expanded));
      assert.equal(await browser.evaluate("document.querySelector('#conversation-panel').inert"), true);
      await capture(browser, `expanded-${format}-${width}-${height}`, expanded);
      await browser.evaluate("document.querySelector('[data-annotate-artifact]').focus()");
      for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent",
        { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
      assert.equal(await browser.evaluate("document.activeElement===retainedFigure.captureElement"), true);
      for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent",
        { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      assert.equal(await browser.evaluate("document.activeElement.matches('[data-annotate-artifact]')"), true);
      for (const action of ["actual", "out", "in", "fit"]) {
        await click(browser, `[data-artifact-zoom="${action}"]`);
        await settleExpansion(browser);
      }
      await click(browser, '[data-artifact-zoom="actual"]');
      await browser.evaluate("document.querySelector('[data-artifact-viewport]').scrollTop=800");
      await click(browser, '[data-artifact-expand]');
      await settleExpansion(browser);
      let restored = await browser.evaluate(expansionMetrics);
      const before = await browser.evaluate("normalBeforeExpand");
      assert.ok(before.conversation > 0, "Exercise a genuinely scrolled Conversation.");
      for (const key of ["view", "outer", "pageX", "pageY", "conversation", "draft"]) assert.deepEqual(restored[key], before[key], key);
      assert.equal(await browser.evaluate("document.activeElement.matches('[data-artifact-expand]')"), true);
      assert.ok(await browser.evaluate("parseFloat(document.querySelector('[data-artifact-viewport]').style.maxHeight)<=480"));
      assert.equal(await browser.evaluate("document.querySelector('#conversation-panel').inert"), false);
      await click(browser, '[data-artifact-expand]');
      const retained = await browser.evaluate("normalBeforeExpand");
      await click(browser, '[data-artifact-zoom="actual"]');
      // Escape must work after a physical click into the sandbox.
      const framePoint = await browser.evaluate("(()=>{const r=retainedFigure.captureElement.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()");
      await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...framePoint });
      await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...framePoint });
      await escapeExpansion(browser);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), false);
      restored = await browser.evaluate(expansionMetrics);
      for (const key of ["view", "outer", "pageX", "pageY", "conversation", "draft"]) assert.deepEqual(restored[key], retained[key], key);
      assert.equal(await browser.evaluate("retainedFigure===document.querySelector('.source-artifact') && retainedFrame===retainedFigure.captureElement.contentDocument && frameLoads===0"), true);
      assert.deepEqual(await browser.evaluate("expansionKeys.map(keys=>keys.size)"), [0, 0], "Each expansion removes both keyboard listeners.");
      assert.equal(await browser.evaluate("retainedFigure.captureElement.getAttribute('sandbox')"), "allow-same-origin");
      await click(browser, '[data-artifact-zoom="fit"]');
      await click(browser, '[data-artifact-expand]');
      const normalFit = await browser.evaluate("normalBeforeExpand.view");
      await click(browser, '[data-artifact-zoom="actual"]');
      await click(browser, '[data-artifact-expand]');
      await settleExpansion(browser);
      assert.deepEqual(await browser.evaluate("retainedFigure.getViewState()"), normalFit);
    });
    assert.deepEqual(f.posts, []);
    assert.deepEqual(browser.exceptions, []);
  });

test("expanded artifact preserves annotation dialogs, raw view and live updates without dispatch",
  { skip: !browserAvailable, timeout: 180_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    f.current.design = expansionDesign();
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('[data-artifact-expand]')?.disabled===false");
    await click(browser, '[data-artifact-expand]');
    await click(browser, '[data-annotate-artifact="large"]');
    await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
    await click(browser, '[data-annotation-action=close]');
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), true);
    assert.equal(await browser.evaluate("document.querySelector('[data-annotate-artifact]').textContent"), "Resume sketch");
    await click(browser, '[data-annotate-artifact="large"]');
    await escapeExpansion(browser);
    assert.equal(await browser.evaluate("document.querySelector('.annotation-editor').open"), false);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), true, "Inner Escape cancels annotation, not expansion.");
    assert.equal(await browser.evaluate("document.querySelector('[data-annotate-artifact]').textContent"), "Annotate");
    await click(browser, '[data-annotate-artifact="large"]');
    await browser.waitFor("!document.querySelector('[data-annotation-action=attach]').disabled");
    const point = await browser.evaluate(`(()=>{
      const ink=document.querySelector('.annotation-editor-ink'),r=ink.getBoundingClientRect();
      globalThis.strokePixel={x:Math.round(37*ink.width/r.width),y:Math.round(37*ink.height/r.height)};
      return {x:r.x+20,y:r.y+20};
    })()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: point.x + 35, y: point.y + 35 });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x + 35, y: point.y + 35 });
    await click(browser, '[data-annotation-action=attach]');
    await browser.waitFor("!document.querySelector('.annotation-editor').open && !document.querySelector('#annotation-preview').hidden");
    const image = await browser.evaluate("document.querySelector('#annotation-image').src");
    assert.match(await browser.evaluate("document.querySelector('#annotation-caption').textContent"), /large, revision expanded-revision/);
    const inkPixel = await browser.evaluate(`(async()=>{
      const image=document.querySelector('#annotation-image');await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const c=canvas.getContext('2d');c.drawImage(image,0,0);
      return {width:canvas.width,height:canvas.height,bottom:[...c.getImageData(canvas.width-20,canvas.height-20,1,1).data],
        stroke:[...c.getImageData(strokePixel.x,strokePixel.y,1,1).data]};
    })()`);
    assert.ok(inkPixel.height > 480);
    assert.deepEqual(inkPixel.bottom, [23, 107, 88, 255], "Expanded capture must not clip to the original narrow pane.");
    assert.deepEqual(inkPixel.stroke, [228, 93, 52, 255], "Physical annotation stays at the captured-image coordinate.");
    await click(browser, ".raw-toggle");
    assert.equal(await browser.evaluate("document.querySelector('#artifact-raw').hidden"), false);
    assert.equal(await browser.evaluate("document.querySelector('[data-annotate-artifact]').disabled"), true);
    await click(browser, ".raw-toggle");
    f.current.messages.push({ id: "expanded-update", kind: "assistant", text: "Work continues.", timestamp: "2026-09-15T00:00:03Z" });
    f.update();
    await browser.waitFor("document.querySelector('#messages').textContent.includes('Work continues.')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), true);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 700, deviceScaleFactor: 1, mobile: false });
    await settleExpansion(browser);
    await click(browser, '[data-artifact-zoom="fit"]');
    const narrow = await browser.evaluate(expansionMetrics);
    assert.equal(narrow.panel.width, 390); assert.ok(narrow.image.right <= 390 && narrow.image.bottom <= 700);
    await escapeExpansion(browser);
    assert.equal(await browser.evaluate("document.querySelector('#annotation-image').src"), image);
    const questionHidden = await browser.evaluate("document.querySelector('#question-panel').hidden");
    await click(browser, '#show-questions');
    assert.equal(await browser.evaluate("document.querySelector('#question-panel').hidden"), !questionHidden);
    await click(browser, '#canvas-settings summary');
    assert.equal(await browser.evaluate("document.querySelector('#canvas-settings').open"), true);
    await click(browser, '#canvas-settings summary');
    if (!await browser.evaluate("document.querySelector('#question-panel').hidden")) await click(browser, '#questions-back');
    await click(browser, '[data-artifact-expand]');
    await click(browser, '[data-artifact-note="note"]');
    await browser.waitFor("document.querySelector('[data-note-primary]')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('#conversation-panel').inert"), false);
    await click(browser, '[data-artifact-expand]');
    await click(browser, '[data-markdown-source] > summary');
    assert.equal(await browser.evaluate("document.querySelector('.artifact-document').scrollHeight>document.querySelector('.artifact-document').clientHeight"), true);
    await escapeExpansion(browser);
    await click(browser, '[data-note-primary]');
    await browser.waitFor("document.querySelector('[data-artifact-expand]')?.disabled===false");
    await click(browser, '[data-artifact-expand]');
    f.current.design = expansionDesign("html");
    f.current.design.binding.revisionId = "replacement";
    f.update();
    await browser.waitFor("document.querySelector('[data-artifact-format=html]')?.captureElement");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('#conversation-panel').inert"), false);
    await click(browser, '[data-artifact-expand]');
    f.current.design = null; f.update();
    await browser.waitFor("!document.querySelector('.shared-artifact-view')");
    assert.equal(await browser.evaluate("document.querySelector('[inert]')===null"), true);
    assert.equal(await browser.evaluate("document.documentElement.style.overflow"), "");
    await escapeExpansion(browser);
    assert.deepEqual(f.posts, []);
    assert.deepEqual(browser.exceptions, []);
  });

test("artifact expansion closes safely on loading, renderer failure and invalid Design replacement",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const gate = Promise.withResolvers(), requested = Promise.withResolvers();
    let hold = true;
    const f = await fixture(t, { onAsset: async path => {
      if (hold && path === "/artifacts/vendor/mermaid.js") { requested.resolve(); await gate.promise; }
    } }), { browser } = f;
    t.after(() => gate.resolve());
    f.current.design = expansionDesign("mermaid");
    await browser.call("Page.navigate", { url: f.url });
    await requested.promise;
    assert.equal(await browser.evaluate("document.querySelector('[data-artifact-expand]').disabled"), true);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), false);
    hold = false; gate.resolve();
    await browser.waitFor("document.querySelector('[data-artifact-expand]')?.disabled===false");
    await click(browser, "[data-artifact-expand]");
    f.current.design.content.artifacts[0].source = 'flowchart TB\nbroken["unterminated';
    f.current.design.binding = { revisionId: "failed-render", digest: policyHash(f.current.design.content) };
    f.update();
    await browser.waitFor("document.querySelector('.design-render-error')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('[data-artifact-expand]').disabled"), true);
    assert.equal(await browser.evaluate("document.querySelector('[inert]')===null"), true);
    f.current.design = expansionDesign("html"); f.update();
    await browser.waitFor("document.querySelector('[data-artifact-expand]')?.disabled===false");
    await click(browser, "[data-artifact-expand]");
    f.current.design.content.schemaVersion = "invalid";
    f.update();
    await browser.waitFor("document.querySelector('.design-render-error')?.textContent.startsWith('Design is not displayed')");
    assert.equal(await browser.evaluate("document.querySelector('[inert]')===null"), true);
    assert.equal(await browser.evaluate("document.documentElement.style.overflow"), "");
    await escapeExpansion(browser);
    assert.deepEqual(f.posts, []);
    assert.deepEqual(browser.exceptions, []);
  });

test("artifact expansion preserves legacy view state and lets users return to new work controls",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const f = await fixture(t), { browser } = f;
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('.shared-sketch')");
    await click(browser, '[data-sketch-view-action="in"]');
    const prior = await browser.evaluate("document.querySelector('.shared-sketch').getViewState()");
    await click(browser, '[data-artifact-expand]');
    await click(browser, '[data-sketch-view-action="out"]');
    f.current.workflow.status = "working"; f.current.workflow.activeRole = "implementer";
    f.current.workflow.activeRequestId = "running";
    f.current.messages.push({ id: "running", kind: "user", requestId: "running", text: "Implement the approved Design.",
      timestamp: "2026-09-15T00:00:05Z", queueState: "active" });
    f.current.accessRequests.push({ ...f.current.accessRequests[0], id: "new-permission", title: "New permission while expanded" });
    f.update();
    await browser.waitFor("document.querySelector('#access-requests').textContent.includes('New permission while expanded')");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-artifact-expanded]'))"), true);
    await escapeExpansion(browser);
    assert.deepEqual(await browser.evaluate("document.querySelector('.shared-sketch').getViewState()"), prior);
    await click(browser, ".access-request-picker select");
    for (const [key, code] of [["End", 35], ["Enter", 13]]) for (const type of ["keyDown", "keyUp"]) {
      await browser.call("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code });
    }
    await browser.waitFor("!document.querySelector('[data-request-id=\"new-permission\"][data-access-decision=\"denied\"]').closest('.access-card').hidden");
    for (const selector of ['#stop-current-flow', '[data-request-id="new-permission"][data-access-decision="denied"]', '#show-questions']) {
      await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await settleExpansion(browser);
      const reachable = await browser.evaluate(`(()=>{
        const button=document.querySelector(${JSON.stringify(selector)}),r=button.getBoundingClientRect();
        const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return {reachable:!button.disabled && !button.closest('[inert]') && button.contains(hit),
          rect:r.toJSON(),hit:hit?.outerHTML.slice(0,180),disabled:button.disabled};
      })()`);
      assert.equal(reachable.reachable, true, selector + JSON.stringify(reachable));
    }
    assert.deepEqual(f.posts, [], "Expansion never approves, stops or dispatches work automatically.");
    assert.deepEqual(browser.exceptions, []);
  });
async function permissionAction(browser, selector) {
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  const measurement = await browser.evaluate(`(() => {
    const node=document.querySelector(${JSON.stringify(selector)}), action=node.getBoundingClientRect();
    const tray=document.querySelector('#access-approval').getBoundingClientRect(), composer=document.querySelector('#composer').getBoundingClientRect();
    return {actionTop:action.top,actionBottom:action.bottom,trayTop:tray.top,trayBottom:tray.bottom,composerTop:composer.top,
      topHit:node.contains(document.elementFromPoint(action.x+action.width/2,action.top+2)),
      bottomHit:node.contains(document.elementFromPoint(action.x+action.width/2,action.bottom-2))};
  })()`);
  assert.ok(measurement.trayBottom <= measurement.composerTop, JSON.stringify(measurement));
  assert.ok(measurement.actionTop >= measurement.trayTop + 1 && measurement.actionBottom <= measurement.trayBottom - 1, JSON.stringify(measurement));
  assert.equal(measurement.topHit, true, JSON.stringify(measurement));
  assert.equal(measurement.bottomHit, true, JSON.stringify(measurement));
  await click(browser, selector);
}

test("historical Designer questions retain their provenance while a newer cycle owns its progress", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('.human-loop-questions textarea')");
  await browser.evaluate(`(() => {
    const input = document.querySelector('.human-loop-questions textarea');
    input.value = 'Retain this unanswered draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.originalQuestionForm = input.closest('form');
  })()`);
  f.current.workflow.activeRequestId = "implementation-request";
  f.current.workflow.activeRole = "implementer";
  f.current.workflow.status = "working";
  f.current.workflow.questionInteraction.canAnswer = false;
  f.current.workflow.currentCycle = { id: "new-cycle", originRequestId: "implementation-request", phase: "implementing", completed: 0, total: 1,
    plan: null, tasks: [{ id: "task", title: "Build the new experience", status: "working" }] };
  f.current.messages.push({ id: "implementation-message", kind: "user", requestId: "implementation-request",
    text: "Implement the new experience.", timestamp: "2026-09-15T00:01:00Z", queueState: "active" });
  f.update();
  await browser.waitFor("document.querySelector('#human-cycle-progress').textContent.includes('0 / 1')");
  assert.deepEqual(await browser.evaluate(`(() => {
    const form = document.querySelector('.human-loop-questions');
    const progress = document.querySelector('#human-cycle-progress');
    return {
      questionOwner: form.dataset.sourceRequestId,
      progressOwner: progress.closest('[data-entry-id]').dataset.entryId,
      sameForm: form === window.originalQuestionForm,
      draft: form.querySelector('textarea').value,
      questionState: form.querySelector('.human-loop-question-status').textContent,
      historicalHasProgress: form.closest('#question-panel').textContent.includes('Internal task progress'),
      disclosure: [...progress.querySelectorAll('summary')].some(n => n.textContent.includes('Technical details')),
      stopEnabled: !document.querySelector('#stop-current-flow').disabled,
    };
  })()`), { questionOwner: "request", progressOwner: "implementation-message", sameForm: true,
    draft: "Retain this unanswered draft", questionState: "open",
    historicalHasProgress: false, disclosure: true, stopEnabled: true });
  await browser.evaluate("document.querySelector('#human-cycle-progress details').open = true");
  f.current.workflow.questionInteraction.questions[0].state = "answered";
  f.current.workflow.questionInteraction.questions[0].answerRequestId = "answer";
  f.current.workflow.currentCycle.completed = 1;
  f.current.workflow.currentCycle.phase = "reviewing";
  f.update();
  await browser.waitFor("document.querySelector('.human-loop-question-status').textContent.includes('answered')");
  assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions').dataset.sourceRequestId"), "request");
  assert.equal(await browser.evaluate("document.querySelector('#human-cycle-progress details').open"), true);
  assert.match(await browser.evaluate("document.querySelector('#human-cycle-progress').textContent"), /Phase: reviewing/);
  assert.match(await browser.evaluate("document.querySelector('#human-cycle-progress').textContent"), /not per-item formal Review/);
});

test("a delayed Designer answer failure stays beside its source form after active work changes", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  let rejectAnswer;
  const f = await fixture(t, { onPost: ({ path }) => path === "/api/answers"
    ? new Promise((resolve, reject) => { rejectAnswer = reject; }) : undefined }), { browser } = f;
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('.human-loop-questions textarea')");
  await click(browser, "#show-questions");
  await browser.evaluate(`(() => {
    const input = document.querySelector('.human-loop-questions textarea');
    input.value = 'Keep this Designer answer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.closest('form').requestSubmit();
  })()`);
  await browser.waitFor("document.querySelector('.human-loop-questions button[type=submit]').textContent === 'Sending answers…'");
  f.current.workflow.activeRequestId = "new-request";
  f.current.workflow.activeRole = "implementer";
  f.current.workflow.status = "working";
  f.current.workflow.questionInteraction.canAnswer = false;
  f.current.workflow.currentCycle = { id: "new-cycle", phase: "implementing", completed: 0, total: 0, plan: null, tasks: [] };
  f.current.messages.push({ id: "new-message", kind: "user", requestId: "new-request",
    text: "New work", timestamp: "2026-09-15T00:01:00Z", queueState: "active" });
  f.update();
  await browser.waitFor("document.querySelector('#human-workflow').closest('[data-entry-id]').dataset.entryId === 'new-message'");
  assert.equal(typeof rejectAnswer, "function");
  rejectAnswer(new Error("Designer answer acknowledgement unavailable"));
  await browser.waitFor("document.querySelector('.human-loop-questions').textContent.includes('Designer answer acknowledgement unavailable')");
  assert.deepEqual(await browser.evaluate(`(() => {
    const form = document.querySelector('.human-loop-questions');
    const error = [...form.querySelectorAll('[role=alert]')].find(n => n.textContent.includes('acknowledgement'));
    return { owner: error.closest('form').dataset.sourceRequestId, visible: !error.hidden && error.getClientRects().length > 0,
      draft: form.querySelector('textarea').value,
      wrongOwnerHasError: document.querySelector('#human-workflow').textContent.includes('Designer answer acknowledgement unavailable') };
  })()`), { owner: "request", visible: true, draft: "Keep this Designer answer", wrongOwnerHasError: false });
});

test("active implementation questions preserve Enter submission, multiline drafts and exact retries beside their own cycle", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  let reject = true;
  const f = await fixture(t, { onPost: ({ path }) => {
    if (path === "/api/answers" && reject) throw new Error("Answer acknowledgement unavailable");
  } }), { browser } = f;
  const interaction = f.current.workflow.questionInteraction;
  interaction.source = { ...source, role: "implementer", requestId: "implementation-request",
    requestIds: ["implementation-request"], cycleId: "implementation-cycle" };
  interaction.questions[0].source = interaction.source;
  f.current.workflow.activeRequestId = "implementation-request";
  f.current.workflow.activeRole = "implementer";
  f.current.workflow.currentCycle = { id: "implementation-cycle", originRequestId: "implementation-request", phase: "implementing", completed: 0, total: 1,
    plan: null, tasks: [{ id: "task", title: "Build the experience", status: "working" }] };
  f.current.messages.push({ id: "implementation-message", kind: "user", requestId: "implementation-request",
    text: "Implement the experience.", timestamp: "2026-09-15T00:01:00Z", queueState: "active" });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('.human-loop-questions textarea')");
  await click(browser, "#show-questions");
  await browser.evaluate(`(() => {
    const input = document.querySelector('.human-loop-questions textarea');
    input.value = 'Use the existing behavior';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus(); input.setSelectionRange(4, 7);
    window.originalQuestionInput = input;
  })()`);
  f.current.workflow.currentCycle.phase = "reviewing";
  f.update();
  await browser.waitFor("document.querySelector('#human-cycle-progress').textContent.includes('Phase: reviewing')");
  assert.deepEqual(await browser.evaluate(`(() => {
    const input = document.querySelector('.human-loop-questions textarea');
    return [input === window.originalQuestionInput, document.activeElement === input, input.selectionStart, input.selectionEnd,
      input.closest('form').dataset.sourceRequestId,
      document.querySelector('#human-workflow').closest('[data-entry-id]').dataset.entryId];
  })()`), [true, true, 4, 7, "implementation-request", "implementation-message"]);
  await browser.evaluate(`(() => {
    const input = document.querySelector('.human-loop-questions textarea');
    input.setSelectionRange(input.value.length, input.value.length);
  })()`);
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.call("Input.insertText", { text: "Keep its saved decisions." });
  const answer = "Use the existing behavior\nKeep its saved decisions.";
  assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions textarea').value"), answer);
  assert.equal(f.posts.filter(({ path }) => path === "/api/answers").length, 0);
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.waitFor("document.querySelector('.human-loop-questions').textContent.includes('Answer acknowledgement unavailable')");
  assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions textarea').value"), answer);
  reject = false;
  await browser.evaluate("document.querySelector('.human-loop-questions textarea').focus()");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.waitFor("document.querySelector('.human-loop-questions textarea').value === ''");
  const answers = f.posts.filter(({ path }) => path === "/api/answers");
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[0].data, answers[1].data);
  assert.equal(answers[0].data.answers.answers[0].value, answer);
  f.current.workflow.activeRequestId = answers[0].data.id;
  f.current.messages.push({ id: "answer-message", kind: "user", requestId: answers[0].data.id,
    text: "Question form submission.", timestamp: "2026-09-15T00:02:00Z", queueState: "active" });
  f.update();
  await browser.waitFor("document.querySelector('#human-workflow').closest('[data-entry-id]').dataset.entryId === 'answer-message'");
  assert.equal(interaction.source.cycleId, f.current.workflow.currentCycle.id);
  assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions').dataset.sourceRequestId"), "implementation-request");
});

test("retained cycle stays at its originating request through unrelated Router, Agent and Ready", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t), { browser } = f;
  f.current.workflow.questionInteraction = null;
  f.current.workflow.currentCycle = { id: "cycle-original", originRequestId: "request", phase: "reviewed",
    completed: 2, total: 2, plan: null, tasks: [] };
  f.current.messages.push({ id: "launch-message", kind: "user", requestId: "launch",
    text: "Launch the website", timestamp: "2026-09-15T00:02:00Z", queueState: "active" });
  f.current.workflow.activeRequestId = "launch";
  f.current.workflow.status = "working";
  f.current.workflow.activeRole = "router";
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#human-cycle-progress')?.closest('[data-entry-id]')");
  for (const role of ["router", "agent", null]) {
    f.current.workflow.activeRole = role;
    if (role === null) {
      f.current.workflow.activeRequestId = null;
      f.current.workflow.status = "ready";
      f.current.workflow.lastHandoff = { id: "handoff:launched", role: "agent", kind: "readonly-answer",
        summary: "Launched the existing local website.", findings: [], verificationLimits: [] };
      f.current.messages.push({ id: "handoff:launched", kind: "assistant", requestId: "launch",
        text: "Launched the existing local website.", timestamp: "2026-09-15T00:03:00Z" });
    }
    f.update();
    const expected = role ? "launch-message" : "handoff:launched";
    await browser.waitFor(`document.querySelector('#human-workflow')?.closest('[data-entry-id]')?.dataset.entryId === ${JSON.stringify(expected)}`);
    assert.equal(await browser.evaluate("document.querySelector('#human-cycle-progress').closest('[data-entry-id]').dataset.entryId"), "original");
    assert.equal(await browser.evaluate("document.querySelector('#human-workflow').textContent.includes('Internal task progress')"), false);
    assert.match(await browser.evaluate("document.querySelector('#human-cycle-progress').textContent"), /2 \/ 2/);
  }
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("independent queued messages stay pinned until request-bound workflow pickup", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t), { browser } = f;
  const messages = [
    { id: "first-row", kind: "user", requestId: "first-request", text: "Design a small garden plan.",
      timestamp: "2026-09-15T01:00:00Z", queueState: "active" },
    { id: "waiting-row", kind: "user", requestId: "waiting-request", text: "Inspect the independent weather fixture.",
      timestamp: "2026-09-15T01:00:01Z", queueState: "waiting", queuedStatus: "queued", queuedOrder: 1 },
    { id: "answer-row", kind: "user", requestId: "answer-request", text: "Use the previously offered compact layout.",
      timestamp: "2026-09-15T01:00:02Z", queueState: "waiting", queuedStatus: "queued", queuedOrder: 2 },
  ];
  const ordinary = { id: "waiting-request", message: messages[1].text, status: "waiting", kind: "ordinary", priority: false };
  const answer = { id: "answer-request", message: messages[2].text, status: "waiting", kind: "answer", priority: true };
  f.current.messages = messages;
  f.current.events = []; f.current.accessRequests = [];
  Object.assign(f.current.workflow, { status: "working", activeRequestId: "first-request", activeRole: "designer",
    lastHandoff: null, questionInteraction: null, queue: [answer, ordinary] });
  await browser.call("Page.navigate", { url: f.url });
  const assertRows = async owner => {
    await browser.waitFor(owner
      ? `document.querySelector('#human-workflow')?.closest('[data-entry-id]')?.dataset.entryId===${JSON.stringify(owner)}`
      : "document.querySelector('#human-workflow').parentElement.id==='conversation-context-parking'");
    const actual = await browser.evaluate(`(() => {
      const inputs=${JSON.stringify(messages.filter(entry => entry.kind === "user"))};
      return {
        workflow:document.querySelector('#human-workflow').textContent,
        users:[...document.querySelectorAll('#messages > [data-entry-id]')].filter(row=>inputs.some(input=>input.id===row.dataset.entryId)).map(row=>row.dataset.entryId),
        rows:inputs.map(input=>{
          const row=document.querySelector('[data-entry-id="'+input.id+'"]');
          return {id:row.dataset.entryId,status:row.querySelector('.conversation-role').textContent,
            copies:[...document.querySelectorAll('.conversation-text')].filter(node=>node.textContent===input.text).length,
            nestedOther:inputs.some(other=>other.id!==input.id&&row.textContent.includes(other.text))};
        })
      };
    })()`);
    assert.deepEqual(actual.users, messages.filter(entry => entry.kind === "user" && !entry.queuedStatus).map(entry => entry.id));
    assert.deepEqual(await browser.evaluate('[...document.querySelectorAll("[data-queued-waiting] [data-queued-request-id]")].map(node=>node.dataset.queuedRequestId)'),
      f.current.workflow.queue.map(request => request.id), "Pinned rows follow authoritative dispatch priority.");
    for (const [index, row] of actual.rows.entries()) {
      assert.equal(row.status, messages[index].queuedStatus ? "Queued; not started" : messages[index].queueState);
      assert.equal(row.copies, 1);
      assert.equal(row.nestedOther, false, row.id);
    }
    assert.doesNotMatch(actual.workflow, /Queue \(|Inspect the independent weather fixture|Use the previously offered compact layout/);
    if (f.current.workflow.activeRole) assert.ok(actual.workflow.includes(`Active role: ${f.current.workflow.activeRole}`));
  };
  await assertRows("first-row");
  assert.deepEqual(f.current.workflow.queue, [answer, ordinary]);

  messages[0].queueState = "completed";
  messages.push({ id: "first-response", kind: "assistant", role: "designer", requestId: "first-request",
    text: "The garden plan is ready.", timestamp: "2026-09-15T01:00:03Z" });
  Object.assign(f.current.workflow, { status: "ready", activeRequestId: null, activeRole: null,
    lastHandoff: { id: "first-response", role: "designer", kind: "designer-changed",
      summary: "The garden plan is ready.", findings: [], verificationLimits: [] } });
  f.update(); await assertRows("first-response");
  f.current.workflow.lastHandoff = null;
  f.update(); await assertRows(null);
  assert.deepEqual(f.current.workflow.queue, [answer, ordinary], "A queue-only snapshot retains both entries without an unrelated card.");

  for (const [index, remaining] of [[2, [ordinary]], [1, []]]) {
    messages[index].queueState = "active";
    delete messages[index].queuedStatus; delete messages[index].queuedOrder;
    Object.assign(f.current.workflow, { status: "working", activeRole: "agent",
      activeRequestId: messages[index].requestId, queue: remaining, lastHandoff: null });
    f.update(); await assertRows(messages[index].id);
    messages[index].queueState = "completed";
    const reply = { id: `${messages[index].id}-response`, kind: "assistant", role: "agent", requestId: messages[index].requestId,
      text: `Finished independent work ${index}.`, timestamp: `2026-09-15T01:00:0${6-index}Z` };
    messages.push(reply);
    Object.assign(f.current.workflow, { status: "ready", activeRole: null, activeRequestId: null,
      lastHandoff: { id: reply.id, role: "agent", kind: "readonly-answer", summary: reply.text, findings: [], verificationLimits: [] } });
    f.update(); await assertRows(reply.id);
    assert.deepEqual(f.current.workflow.queue, remaining);
  }
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("Ready advisory forms retain independent source drafts, focus and retry envelopes", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  let failFirst = true;
  const f = await fixture(t, { onPost: ({ path, data }) => {
    if (path === "/api/answers" && data.answers.answers[0].sourceResultId === "result" && failFirst) {
      failFirst = false; throw new Error("First source acknowledgement unavailable");
    }
  } }), { browser } = f;
  const first = structuredClone(f.current.workflow.questionInteraction), second = structuredClone(first);
  first.questions[0].importance = "advisory"; first.questions[0].blockingActive = false;
  second.resultId = "second"; second.source = { ...source, resultId: "second", requestId: "second-request", requestIds: ["second-request"] };
  second.questions[0] = { ...first.questions[0], source: second.source };
  Object.assign(f.current.workflow, { status: "ready", activeRequestId: null, activeRole: null,
    questionInteractions: [first, second], canStop: false });
  f.current.accessRequests = [];
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#show-questions').textContent === 'Questions (2, 0 blockers)'");
  assert.equal(await browser.evaluate("document.querySelector('#question-panel').hidden"), true);
  await click(browser, "#show-questions");
  const selectSource = id => click(browser, `[data-question-open-key='${JSON.stringify([id, "scope"])}']`);
  await selectSource("second");
  await browser.evaluate(`(() => {
    for(const id of ['result','second']) {
      const input=document.querySelector('form[data-source-result-id="'+id+'"] textarea');
      input.value=id+' draft';input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    const input=document.querySelector('form[data-source-result-id="second"] textarea');
    input.focus();input.setSelectionRange(1,4);window.secondDraft=input;
    document.querySelector('form[data-source-result-id="result"]').requestSubmit();
  })()`);
  await browser.waitFor("document.querySelector('form[data-source-result-id=\"result\"]').textContent.includes('First source acknowledgement unavailable')");
  f.update();
  await browser.waitFor("document.activeElement===window.secondDraft");
  assert.deepEqual(await browser.evaluate("[secondDraft.value,secondDraft.selectionStart,secondDraft.selectionEnd]"), ["second draft", 1, 4]);
  await click(browser, 'form[data-source-result-id="second"] button[type="submit"]');
  await browser.waitFor("document.querySelector('form[data-source-result-id=\"second\"] textarea').value===''");
  await selectSource("result");
  await click(browser, 'form[data-source-result-id="result"] button[type="submit"]');
  await browser.waitFor("document.querySelector('form[data-source-result-id=\"result\"] textarea').value===''");
  const posts = f.posts.filter(post => post.path === "/api/answers");
  assert.equal(posts.length, 3);
  assert.deepEqual(posts.map(post => post.data.answers.answers.map(answer => answer.sourceResultId)), [["result"], ["second"], ["result"]]);
  assert.deepEqual(posts[0].data, posts[2].data);
  assert.deepEqual(browser.exceptions, []);
});

test("failed startup offers an explicit keyboard-accessible retry without replaying on render", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t, { onPost: ({ path, data, current }) => {
    assert.equal(path, "/api/runtime/start");
    assert.deepEqual(data, { retry: true });
    current.installation = { status: "ready", canStart: false, canReopen: false, canRetry: false };
  } }), { browser } = f;
  f.current.installation = { status: "unknown", canStart: false, canReopen: false, canRetry: true };
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#initialize')?.textContent === 'Retry runtime'");
  assert.deepEqual(f.posts, []);
  await browser.evaluate("document.querySelector('#initialize').scrollIntoView({block:'center'});document.querySelector('#initialize').focus()");
  assert.equal(await browser.evaluate("document.activeElement.id"), "initialize");
  assert.equal(await browser.evaluate("document.querySelector('#initialize').checkVisibility()"), true);
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
    text: "\r", unmodifiedText: "\r" });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.waitFor("document.querySelector('#initialize').hidden");
  assert.deepEqual(f.posts, [{ path: "/api/runtime/start", data: { retry: true } }]);
  assert.deepEqual(browser.exceptions, []);
});

test("Settings owns remembered approvals while pending permissions stay by the composer", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t, { onPost: ({ path, current }) => {
    if (path === "/api/permissions/reset") current.rememberedApprovals = { all: false, tools: [] };
  } }), { browser } = f;
  f.current.rememberedApprovals = { all: true, tools: [] };
  f.current.workflow.status = "working";
  f.current.workflow.canResetApprovals = false;
  f.current.workflow.questionInteraction = null;
  f.current.accessRequests = [];
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('[data-session-access-off]')");
  assert.equal(await browser.evaluate("document.querySelector('[data-session-access-off]').disabled"), false);
  assert.equal(await browser.evaluate("document.querySelector('#access-approval').hidden"), true);
  assert.equal(await browser.evaluate("document.querySelector('[data-session-access-off]').closest('details').id"), "canvas-settings");
  assert.match(await browser.evaluate("document.querySelector('#remembered-approvals').textContent"), /future callbacks.*without.*cancelling/s);
  for (const width of [390, 1280]) for (const theme of ["light", "dark"]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await browser.evaluate("document.querySelector('#canvas-settings').open=true");
    await browser.evaluate("document.querySelector('[data-session-access-off]').scrollIntoView({block:'nearest'})");
    assert.equal(await browser.evaluate("document.querySelector('[data-session-access-off]').checkVisibility()"), true);
    const bounds = await browser.evaluate("(()=>{const r=document.querySelector('#remembered-approvals').getBoundingClientRect();return{left:r.left,right:r.right}})()");
    assert.ok(bounds.left >= 0 && bounds.right <= width);
    await capture(browser, `remembered-settings-${width}-${theme}`, bounds);
  }
  f.current.rememberedApprovals = { all: false, tools: ["run_workflow_command"] };
  f.current.accessRequests = snapshot().accessRequests; f.update();
  await browser.waitFor("!document.querySelector('#access-approval').hidden");
  assert.match(await browser.evaluate("document.querySelector('#remembered-approvals').textContent"), /Separate custom per-tool approvals: run_workflow_command/);
  assert.doesNotMatch(await browser.evaluate("document.querySelector('#access-requests').textContent"), /Remembered approvals|Reset remembered/);
  assert.equal(await browser.evaluate("document.querySelectorAll('#access-requests [data-access-decision]').length"), 2);
  assert.equal(await browser.evaluate("document.querySelector('[data-reset-approvals]').disabled"), true);
  assert.deepEqual(f.posts, [], "Opening Settings and projecting grants never resets or approves.");
  f.current.workflow.status = "waiting-answer";
  f.current.workflow.canResetApprovals = true; f.update();
  await browser.waitFor("!document.querySelector('[data-reset-approvals]').disabled");
  await click(browser, "[data-reset-approvals]");
  await browser.waitFor("!document.querySelector('[data-reset-approvals]') && document.querySelector('#remembered-approvals [role=status]')?.textContent === 'Session access: Off'");
  assert.equal(await browser.evaluate("document.querySelector('[data-reset-approvals]')"), null);
  assert.equal(await browser.evaluate("document.querySelector('#access-approval').hidden"), false, "Reset must not hide the pending question.");
  assert.equal(await browser.evaluate("document.querySelectorAll('#access-requests [data-access-decision]').length"), 2);
  f.current.accessRequests = []; f.update();
  await browser.waitFor("document.querySelector('#access-approval').hidden");
  assert.deepEqual(f.posts, [{ path: "/api/permissions/reset", data: {} }]);
  assert.deepEqual(browser.exceptions, []);
});

test("Settings sections distinguish access status from its action across narrow and wide panels", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const model = { models: [{ id: "fixture", name: "Fixture private model" }], actual: "fixture", canChange: false,
    reason: "Model changes require Ready with no active work." };
  const f = await fixture(t, { modelSettings: model, onPost: ({ path, current }) => {
    if (path === "/api/permissions/off") current.rememberedApprovals = { all: false, tools: [] };
    if (path === "/api/project/open-folder") return { requested: true, path: "fixture-project" };
  } }), { browser } = f;
  f.current.rememberedApprovals = { all: true, tools: [] };
  f.current.workflow.compaction = { active: false, canRequest: false };
  const headings = ["Appearance", "Models", "Session access", "Workspace & context", "Diagnostics"];
  for (const width of [390, 1280]) for (const theme of ["light", "dark"]) {
    f.preferences.theme = theme;
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('[data-session-access-off]')");
    await browser.call("Page.bringToFront");
    await click(browser, "#canvas-settings > summary");
    assert.equal(await browser.evaluate("document.querySelector('#project-effort-settings').checkVisibility()"), false,
      "Standalone Settings never exposes the composed shared-effort controls.");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.settings-section h3')].filter(n=>n.checkVisibility()).map(n=>n.textContent)"), headings);
    assert.equal(await browser.evaluate("document.querySelector('#setting-model').disabled && document.querySelector('#apply-model').disabled && document.querySelector('#request-compaction').disabled"), true);
    assert.match(await browser.evaluate("document.querySelector('#model-setting-status').textContent"), /Model changes require Ready/);
    const layout = await browser.evaluate(`(() => {
      const panel=document.querySelector('#canvas-settings'), bounds=panel.getBoundingClientRect();
      return {left:bounds.left,right:bounds.right,overflow:panel.scrollWidth-panel.clientWidth,
        sections:[...panel.querySelectorAll('.settings-section')].filter(n=>n.checkVisibility()).map(n=>({border:getComputedStyle(n).borderTopWidth,
          spacing:getComputedStyle(n).marginTop,heading:n.querySelector('h3').textContent})),
        controls:[...panel.querySelectorAll('button,select')].filter(n=>n.checkVisibility()).map(n=>{
          const r=n.getBoundingClientRect();return {left:r.left,right:r.right};})};
    })()`);
    assert.ok(layout.left >= 0 && layout.right <= width && layout.overflow <= 1, JSON.stringify(layout));
    assert.ok(layout.sections.every(n => parseFloat(n.spacing) >= 12));
    assert.ok(layout.sections.slice(1).every(n => parseFloat(n.border) >= 1));
    assert.ok(layout.controls.every(n => n.left >= layout.left && n.right <= layout.right), JSON.stringify(layout));
    await capture(browser, `settings-sections-${width}-${theme}`, layout);
    await browser.evaluate("document.querySelector('[data-session-access-off]').scrollIntoView({block:'center'})");
    const access = await browser.evaluate(`(() => {
      const button=document.querySelector('[data-session-access-off]'), status=document.querySelector('#remembered-approvals [role=status]');
      const r=button.getBoundingClientRect();return {label:button.textContent,status:status.textContent,
        together:button.parentElement===status.parentElement,hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    })()`);
    assert.deepEqual(access, { label: "Turn off session access", status: "Session access: On", together: true, hit: true });
    await capture(browser, `settings-access-${width}-${theme}`, access);
  }
  assert.deepEqual(f.posts, [], "Rendering, opening and scrolling Settings never changes permissions or invokes actions.");
  await click(browser, "[data-session-access-off]");
  await browser.waitFor("document.querySelector('#remembered-approvals [role=status]')?.textContent === 'Session access: Off'");
  assert.equal(await browser.evaluate("document.querySelectorAll('#remembered-approvals button').length"), 0);
  assert.match(await browser.evaluate("document.querySelector('#remembered-approvals').textContent"), /eligible pending permission request.*Native permission mode stays manual/);
  assert.equal(f.current.accessRequests.length, 1);
  await capture(browser, "settings-access-off", { status: "Off", pendingPermissions: 1 });
  await click(browser, "#open-project-folder");
  await browser.waitFor("document.querySelector('#project-folder-status').textContent === 'Explorer requested for fixture-project'");
  f.current.rememberedApprovals = { all: true, tools: [] }; f.update();
  await browser.waitFor("document.querySelector('[data-session-access-off]')");
  await browser.evaluate("document.querySelector('#save-appearance').focus()");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await browser.evaluate("document.activeElement.id"), "refresh-models");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await browser.evaluate("document.activeElement.matches('[data-session-access-off]')"), true);
  assert.equal(await browser.evaluate("document.activeElement.textContent"), "Turn off session access");
  assert.ok(await browser.evaluate("parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0"));
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.waitFor("document.querySelector('#remembered-approvals [role=status]')?.textContent === 'Session access: Off'");
  assert.deepEqual(f.posts, [
    { path: "/api/permissions/off", data: {} }, { path: "/api/project/open-folder", data: {} },
    { path: "/api/permissions/off", data: {} },
  ]);
  assert.equal(f.current.accessRequests.length, 1);
  model.canChange = true; model.reason = "";
  await browser.evaluate("document.querySelector('#canvas-settings').open=false");
  await click(browser, "#canvas-settings > summary");
  await browser.waitFor("!document.querySelector('#apply-model').disabled");
  await browser.evaluate("document.querySelector('#setting-theme').value='light'; document.querySelector('#setting-font').value='larger'");
  await click(browser, "#save-appearance");
  await browser.waitFor("document.body.dataset.theme==='light' && document.body.dataset.fontSize==='larger'");
  await click(browser, "#apply-model");
  await browser.waitFor("!document.querySelector('#apply-model').disabled");
  assert.deepEqual(f.posts.slice(3), [
    { path: "/api/settings", data: { theme: "light", fontSize: "larger" } },
    { path: "/api/settings/model", data: { action: "select", model: "fixture", reasoningEffort: null } },
  ]);
  assert.equal(await browser.evaluate("document.querySelector('#settings-error').hidden"), true);
  assert.equal(await browser.evaluate("document.querySelector('#request-compaction').disabled"), true);
  assert.deepEqual(browser.exceptions, []);
});

test("approved shell keeps Design left and Conversation right without a third control column", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1050, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('.human-loop') && document.querySelector('#messages .conversation-entry')");
  const measured = await geometry(browser); await capture(browser, "desktop", measured);
  assert.equal(measured.thirdColumn, false);
  assert.ok(measured.design.x < measured.conversation.x);
  assert.ok(Math.abs(measured.design.width / 1500 - .55) < .025, JSON.stringify(measured));
  assert.ok(measured.rail.x >= measured.messages.right - 1);
  assert.ok(measured.rail.right <= measured.conversation.right + 1);
  assert.ok(measured.messages.width >= 420, JSON.stringify(measured));
  assert.ok(measured.pageWidth <= 1500);
  assert.ok(measured.composer.bottom <= 1050 && measured.composer.y > measured.messages.y);
  assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions').closest('#question-panel') !== null"), true);
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('[data-artifact-tab]')].map(n=>n.textContent)"),
    sharedDesignExample().artifacts.map(({ title }) => title));
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#canvas-scroll')).backgroundImage.includes('radial-gradient')"), true);
  await click(browser, '[data-annotate-artifact="interaction"]');
  await browser.waitFor('document.querySelector(\'[data-annotate-artifact="interaction"]\').getAttribute("aria-pressed") === "true"');
  await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
  assert.equal(await browser.evaluate("document.querySelector('#annotation-tools').hidden"), true);
  await click(browser, "[data-annotation-action=attach]");
  await browser.waitFor("!document.querySelector('#annotation-preview').hidden && document.querySelector('#annotation-image').src.startsWith('blob:')");
  assert.equal(f.posts.length, 0, "A local diagram snapshot must not send a request.");
  await click(browser, "#annotation-remove");
  assert.equal(await browser.evaluate("document.querySelector('#annotation-preview').hidden"), true);
  await click(browser, '[data-annotate-artifact="interaction"]');
  await click(browser, '[data-annotation-action=close]');
  await click(browser, '[data-design-artifact="interaction"] .raw-toggle');
  assert.equal(await browser.evaluate("document.querySelector('#artifact-raw').hidden"), false);
  await click(browser, '[data-design-artifact="interaction"] .raw-toggle');
  f.current.design = null; f.update();
  await browser.waitFor("document.querySelector('#backbone-proposal').hidden");
  const empty = await geometry(browser); await capture(browser, "empty-desktop", empty);
  assert.equal(empty.canvasOverflow, 0);
  assert.ok(empty.pageWidth <= 1500);
  assert.equal(await browser.evaluate("document.querySelector('#assessment-card').hidden"), false);
  f.current.workflow.questionInteraction = null; f.current.workflow.lastHandoff = null;
  f.current.workflow.status = "ready"; f.current.workflow.canStop = false; f.current.accessRequests = [];
  f.update();
  await browser.waitFor("document.querySelector('#human-workflow').parentElement.id === 'conversation-context-parking'");
  assert.equal(await browser.evaluate("document.querySelector('#access-approval').hidden"), true);
  assert.deepEqual(browser.exceptions, []);
});

test("approved shell keeps narrow views bounded and permission/composer actions reachable", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  for (const [width, height, color] of [[900, 850, "light"], [900, 850, "dark"], [390, 850, "light"], [390, 850, "dark"]]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 660 });
    await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: color }] });
    f.current.accessRequests = snapshot().accessRequests;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('.access-card button') && document.querySelector('.shared-sketch svg')?.children.length");
    let measured = await geometry(browser);
    await capture(browser, `${width}-${color}`, measured);
    assert.ok(measured.pageWidth <= width, JSON.stringify(measured));
    if (width > 660) assert.ok(measured.design.x < measured.conversation.x);
    else assert.ok(measured.design.bottom <= measured.conversation.y + 1);
    assert.ok(measured.messages.width > 200, JSON.stringify(measured));
    assert.ok(measured.rail.right <= measured.conversation.right + 1);
    assert.ok(measured.permissions.bottom <= measured.composer.y, JSON.stringify(measured));
    await click(browser, '[data-artifact-tab="architecture-example"]');
    const diagram = await browser.evaluate(`(() => {const n=document.querySelector('.shared-sketch'), r=n.getBoundingClientRect();
      return {right:r.right,viewportRight:document.querySelector('#design-panel').getBoundingClientRect().right,
        overflow:getComputedStyle(n).overflowX,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,pageWidth:document.documentElement.scrollWidth};})()`);
    assert.ok(diagram.right <= diagram.viewportRight && diagram.pageWidth <= width, JSON.stringify(diagram));
    assert.equal(diagram.overflow, "auto");
    if (width < 660) assert.ok(diagram.scrollWidth > diagram.clientWidth, "Legitimate diagram panning must remain local.");
    await click(browser, '[data-artifact-tab="interaction"]');
    f.current.accessRequests = [
      { ...snapshot().accessRequests[0], description: `${snapshot().accessRequests[0].description}\n${'Long explicit argument with readable scope. '.repeat(35)}` },
      { ...snapshot().accessRequests[0], id: "permit-2", title: "A separate scoped command?", description: "A second pending permission must remain separate." },
    ];
    f.update(); await browser.waitFor("document.querySelectorAll('.access-card').length === 2");
    await permissionAction(browser, '[data-request-id="permit"][data-access-decision="denied"]');
    await browser.waitFor("document.querySelectorAll('.access-card').length === 1");
    assert.deepEqual(f.posts.at(-1), { path: "/api/access/permit", data: { decision: "denied" } });
    await capture(browser, `${width}-${color}-permissions`, await geometry(browser));
    await permissionAction(browser, '[data-access-batch="once"]');
    await browser.waitFor("document.querySelector('#access-approval').hidden");
    assert.deepEqual(f.posts.at(-1), { path: "/api/permissions/once", data: { requestIds: ["permit-2"] } });
    await click(browser, "#message");
    await browser.call("Input.insertText", { text: `Ordinary discussion ${width} ${color}, not an answer.` });
    await click(browser, "#send");
    await browser.waitFor("document.querySelector('#message').value === ''");
    assert.equal(f.posts.at(-1).path, "/api/requests");
    assert.equal(f.posts.at(-1).data.answers, undefined);
    f.current.design = null; f.update();
    await browser.waitFor("document.querySelector('#backbone-proposal').hidden");
    measured = await geometry(browser);
    assert.equal(measured.canvasOverflow, 0, JSON.stringify(measured));
    assert.ok(measured.pageWidth <= width);
    f.current.design = snapshot().design;
  }
  assert.deepEqual(browser.exceptions, []);
});

test("native long-goal header keeps Diagnostics reachable without page overflow", { skip: !browserAvailable, timeout: 120_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  // Exact goal from the native tank-game failure snapshot (inspection-1789543222126).
  const goal = "Describe a tiny, self-contained side-view keyboard tank game with a readable game screen and a complete two-wave play loop, including three health points, pause, win/lose outcomes, and replay.";
  f.current.design.content = { ...sharedDesignExampleV2(), goal };
  f.current.design.binding = { revisionId: "long-goal", digest: policyHash(f.current.design.content) };
  f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null;
  f.current.workflow.lastHandoff = null; f.current.workflow.canStop = false; f.current.accessRequests = [];
  for (const width of [700, 699, 701, 320, 659, 660, 661, 949, 950, 951, 1500]) {
    for (const color of ["light", "dark"]) await t.test(`${width}px ${color}`, async () => {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1050, deviceScaleFactor: 1, mobile: width <= 660 });
      await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: color }] });
      await browser.call("Page.navigate", { url: f.url });
      await browser.waitFor(`document.querySelector('#project-name')?.textContent === ${JSON.stringify(goal)} && document.querySelector('.shared-sketch svg')?.children.length && document.querySelector('#current-state-title').textContent === 'Ready'`);
      await browser.evaluate("document.fonts.ready.then(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))");
      const measured = await geometry(browser);
      const header = await browser.evaluate(`(() => {
        const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect();
          return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const title=document.querySelector('#project-name'), settings=document.querySelector('#canvas-settings > summary');
        const r=settings.getBoundingClientRect();
        return {bodyWidth:document.body.scrollWidth,scrollX,header:rect('.human-header'),
          brand:rect('.brand'),mark:rect('.brand-mark'),title:rect('#project-name'),
          settings:rect('#canvas-settings > summary'),titleText:title.textContent,titleTooltip:title.title,
          titleFont:getComputedStyle(title).fontSize,
          ellipsis:getComputedStyle(title).textOverflow,
          reachable:[r.left+2,r.left+r.width/2,r.right-2].every(x=>settings.contains(document.elementFromPoint(x,r.top+r.height/2)))};
      })()`);
      await capture(browser, `long-goal-${width}-${color}`, { ...measured, ...header });
      assert.ok(measured.pageWidth <= width && header.bodyWidth <= width, JSON.stringify({ ...measured, ...header }));
      assert.equal(header.scrollX, 0);
      assert.ok(header.brand.right <= header.settings.x && header.brand.right <= header.title.x);
      assert.ok(header.title.right <= header.settings.x || header.title.bottom <= header.settings.y);
      assert.ok(header.settings.x >= 0 && header.settings.right <= width);
      assert.ok(header.settings.y >= 0 && header.settings.bottom <= header.header.bottom);
      assert.equal(header.reachable, true, "Settings must be hit-testable before any scrolling.");
      assert.equal(header.mark.width, width <= 480 ? 180 : 200, "The complete supplied logo must remain legible.");
      assert.equal(header.titleFont, width <= 480 ? "10px" : "12px");
      assert.equal(header.ellipsis, "ellipsis");
      assert.equal(header.titleText, goal);
      assert.equal(header.titleTooltip, goal, "The full goal must remain available despite visual ellipsis.");
      if (width > 660) {
        const share = width <= 950 ? .47 : .55;
        assert.ok(Math.abs(measured.design.width / width - share) < .005, JSON.stringify(measured));
        assert.ok(Math.abs(measured.conversation.width / width - (1 - share)) < .005, JSON.stringify(measured));
      } else assert.ok(measured.design.bottom <= measured.conversation.y + 1, JSON.stringify(measured));

      const point = { x: header.settings.x + header.settings.width / 2, y: header.settings.y + header.settings.height / 2 };
      for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...point });
      await browser.waitFor("document.querySelector('#canvas-settings').open");
      await click(browser, "#open-diagnostics");
      await browser.waitFor("document.querySelector('#advanced-workflow-controls').open && document.querySelector('#open-diagnostics').getAttribute('aria-expanded') === 'true'");
      assert.equal(await browser.evaluate("scrollX"), 0, "Opening Diagnostics must not pan the page.");
      await click(browser, "#advanced-workflow-controls > summary");
      await browser.waitFor("!document.querySelector('#advanced-workflow-controls').open");

      assert.equal(await browser.evaluate("document.querySelector('#design-overview').open"), true);
      assert.equal(await browser.evaluate("document.querySelector('#design-goal').textContent"), goal);
      assert.equal(await browser.evaluate("document.querySelector('#design-goal').checkVisibility()"), true);
      assert.ok(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth"));
      await click(browser, "#design-overview > summary");
      assert.equal(await browser.evaluate("document.querySelector('#design-overview').open"), false);
      await click(browser, '[data-artifact-tab="architecture-example"]');
      const diagram = await browser.evaluate(`(() => {
        const n=document.querySelector('.shared-sketch'), r=n.getBoundingClientRect();
        n.scrollLeft=n.scrollWidth;
        return {right:r.right,panelRight:document.querySelector('#design-panel').getBoundingClientRect().right,
          overflow:getComputedStyle(n).overflowX,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,scrollLeft:n.scrollLeft,
          pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,scrollX};
      })()`);
      assert.ok(diagram.right <= diagram.panelRight && diagram.pageWidth <= width && diagram.bodyWidth <= width, JSON.stringify(diagram));
      assert.equal(diagram.overflow, "auto");
      assert.equal(diagram.scrollX, 0);
      if (width === 320) assert.ok(diagram.scrollWidth > diagram.clientWidth,
        `Legitimate diagram panning must remain local: ${JSON.stringify(diagram)}`);
      if (diagram.scrollWidth > diagram.clientWidth) assert.ok(diagram.scrollLeft > 0, JSON.stringify(diagram));
      await capture(browser, `long-goal-pan-${width}-${color}`, diagram);
    });
  }
  assert.deepEqual(f.posts, [], "Header and disclosure controls must not dispatch workflow requests.");
  assert.deepEqual(browser.exceptions, []);
});

test("overview precedes tabs and compact current status owns navigation while workflow details remain visible", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  Object.assign(f.current.workflow, { status: "working", activeRequestId: "request", activeRole: null,
    questionInteraction: null, lastHandoff: null });
  f.current.accessRequests = [];
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#human-workflow > .human-loop')");
  assert.equal(await browser.evaluate("document.querySelector('#human-workflow > .human-loop').checkVisibility()"), false);
  assert.equal(await browser.evaluate("document.querySelectorAll('.conversation-state-strip').length"), 1);
  assert.equal(await browser.evaluate("document.querySelector('#focus-current-message').closest('.conversation-current')!==null"), true);
  assert.equal(await browser.evaluate("document.querySelector('#current-state-title').textContent"), "Request awaiting role dispatch");
  assert.equal(await browser.evaluate("document.querySelector('#design-summary').compareDocumentPosition(document.querySelector('.design-navigation')) & Node.DOCUMENT_POSITION_FOLLOWING"), 4);
  assert.equal(await browser.evaluate("document.querySelector('.design-metadata').compareDocumentPosition(document.querySelector('.design-navigation')) & Node.DOCUMENT_POSITION_FOLLOWING"), 4);
  for (const patch of [{ activeRole: "designer" }, { activeRole: null, reason: "Connection uncertain; refresh status before continuing." },
    { reason: null, lastHandoff: snapshot().workflow.lastHandoff, activeRequestId: null }]) {
    Object.assign(f.current.workflow, patch); f.update();
    await browser.waitFor("document.querySelector('#human-workflow > .human-loop').checkVisibility()");
    if (patch.reason) {
      await browser.waitFor("document.querySelector('#current-state-detail').textContent.includes('Connection uncertain')");
      assert.equal(await browser.evaluate("document.querySelector('#current-state-detail').checkVisibility()"), false);
      assert.match(await browser.evaluate("document.querySelector('#human-workflow').innerText"), /Connection uncertain/);
    }
  }
  await browser.waitFor("document.querySelector('#human-workflow').textContent.includes('Latest result')");
  assert.match(await browser.evaluate("document.querySelector('#human-workflow').textContent"), /Latest result.*designer/s);
  assert.deepEqual(f.posts, []);
});

test("Settings contains Diagnostics with keyboard focus handoff without moving normal permissions", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  for (const width of [1500, 390, 320]) for (const theme of ["light", "dark"]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('#send') && !document.querySelector('#send').disabled");
    await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)}`);
    assert.equal(await browser.evaluate("document.querySelector('#open-diagnostics').checkVisibility()"), false);
    assert.equal(await browser.evaluate("document.querySelectorAll('#open-diagnostics').length"), 1);
    await click(browser, "#canvas-settings > summary");
    await browser.waitFor("document.querySelector('#open-diagnostics').checkVisibility()");
    assert.equal(await browser.evaluate("document.querySelector('#open-diagnostics').closest('details').id"), "canvas-settings");
    assert.match(await browser.evaluate("document.querySelector('#diagnostics-purpose').textContent"), /Troubleshoot runtime status/);
    await capture(browser, `settings-diagnostics-${width}-${theme}`, { width, theme });
    await browser.evaluate("document.querySelector('#open-diagnostics').focus()");
    for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", {
      type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
    });
    const opened = await browser.evaluate("({panel:document.querySelector('#advanced-workflow-controls').open,settings:document.querySelector('#canvas-settings').open,focus:document.activeElement.outerHTML.slice(0,300)})");
    assert.ok(opened.panel && !opened.settings && opened.focus.startsWith("<summary"), JSON.stringify({ width, theme, opened }));
    await browser.waitFor("document.querySelector('#open-diagnostics').getAttribute('aria-expanded')==='true'");
    assert.equal(await browser.evaluate("document.querySelector('#open-diagnostics').getAttribute('aria-expanded')"), "true");
    assert.equal(await browser.evaluate("document.querySelector('#access-approval').hidden"), false);
    assert.equal(await browser.evaluate("document.querySelector('#access-approval').closest('#canvas-settings')"), null);
    assert.equal(await browser.evaluate("document.querySelector('#shutdown').disabled"), false);
    for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await browser.evaluate("document.activeElement.id"), "refresh");
    await capture(browser, `diagnostics-open-${width}-${theme}`, { width, theme });
    for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await browser.waitFor("!document.querySelector('#advanced-workflow-controls').open && document.activeElement===document.querySelector('#canvas-settings > summary')");
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  }
  f.current.workflow.status = "working";
  f.update();
  await browser.waitFor("document.querySelector('#current-state-title').textContent==='Permission response needed'");
  assert.equal(await browser.evaluate("document.querySelector('#shutdown').disabled"), false);
  assert.deepEqual(f.posts, [], "Diagnostics navigation must not execute a runtime action.");
  assert.deepEqual(browser.exceptions, []);
});

test("Stop stays below the composer at its left edge while Send remains inside at right", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  f.current.accessRequests = [];
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#stop-current-flow') && !document.querySelector('#stop-current-flow').hidden");
  for (const width of [1500, 390, 320]) for (const theme of ["light", "dark"]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)};document.querySelector('#send').focus()`);
    for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const geometry = await browser.evaluate(`(() => {
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
      const stop=document.querySelector('#stop-current-flow');
      const style=getComputedStyle(stop);
      return {stop:rect('#stop-current-flow'),input:rect('.command-composer'),send:rect('#send'),
        text:stop.textContent,type:stop.type,focused:document.activeElement===stop,
        outline:style.outlineStyle,ink:style.color,border:style.borderColor,background:style.backgroundColor,
        destructive:getComputedStyle(document.querySelector('#shutdown')).color,
        scrollWidth:document.documentElement.scrollWidth};
    })()`);
    assert.ok(Math.abs(geometry.stop.left - geometry.input.left) <= 1, JSON.stringify(geometry));
    assert.ok(geometry.stop.top >= Math.max(geometry.input.bottom, geometry.send.bottom) + 5, JSON.stringify(geometry));
    assert.ok(geometry.send.left > geometry.input.left && geometry.send.right < geometry.input.right, JSON.stringify(geometry));
    assert.ok(geometry.send.top > geometry.input.top && geometry.send.bottom < geometry.input.bottom, JSON.stringify(geometry));
    assert.ok(geometry.stop.right <= geometry.send.right && geometry.scrollWidth <= width, JSON.stringify(geometry));
    assert.equal(geometry.text, "Stop after this step");
    assert.equal(geometry.type, "button");
    assert.equal(geometry.focused, true);
    assert.notEqual(geometry.outline, "none");
    assert.notEqual(geometry.ink, geometry.destructive);
    assert.notEqual(geometry.border, geometry.destructive);
    const hover = await browser.evaluate(`(() => {
      const r=document.querySelector('#stop-current-flow').getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...hover });
    const states = await browser.evaluate(`(() => {
      const button=document.querySelector('#stop-current-flow'),hover=getComputedStyle(button);
      const result={hoverInk:hover.color,hoverBackground:hover.backgroundColor};
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
      const rgb=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data]};
      const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
        .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      let plate=button;while(plate.parentElement && rgb(getComputedStyle(plate).backgroundColor)[3]===0)plate=plate.parentElement;
      const a=luminance(rgb(hover.color)),b=luminance(rgb(getComputedStyle(plate).backgroundColor));
      result.hoverContrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      button.disabled=true;
      result.disabledInk=getComputedStyle(button).color;result.disabledOpacity=getComputedStyle(button).opacity;
      button.disabled=false;return result;
    })()`);
    assert.equal(states.hoverInk, geometry.ink);
    assert.notEqual(states.disabledInk, geometry.destructive);
    assert.ok(Number(states.disabledOpacity) > 0);
    assert.ok(states.hoverContrast >= 4.5, JSON.stringify({ theme, ...states }));
    await capture(browser, `stop-left-${width}-${theme}`, { ...geometry, ...states });
  }
  f.current.workflow.canStop = false;
  f.update();
  await browser.waitFor("document.querySelector('#stop-current-flow').hidden");
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("obsolete startup notice clears without masking current workflow or erasing action errors and history",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t, { onPost: ({ path }) => {
      if (path === "/api/runtime/close") throw new Error("The current Close operation is unconfirmed.");
    } });
    const { browser } = f, original = "Human loop workspace: Git observation failed: not a git repository.";
    f.current.installation = { status: "unknown", canRetry: true, reason: original };
    f.current.messages.push({ id: "retained-startup", kind: "status", role: "host", text: original,
      timestamp: "2026-09-15T00:00:02Z", requestId: null });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('#notice').textContent.includes('not a git repository')");
    await browser.evaluate("document.querySelector('#message').value='Retain this explicit new continuation draft.'");
    f.current.installation = { status: "ready", canStart: false, canReopen: false, reason: null };
    f.current.workflow.status = "execution-unknown";
    f.current.workflow.reason = "Private native event ownership is uncertain for the admitted Router.";
    f.update();
    await browser.waitFor("document.querySelector('#current-state-detail').textContent.includes('admitted Router')");
    assert.equal(await browser.evaluate("document.querySelector('#notice').hidden"), true);
    assert.ok(await browser.evaluate("document.querySelector('#messages').textContent.includes('not a git repository')"));
    assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Retain this explicit new continuation draft.");
    assert.deepEqual(f.posts, []);
    await browser.evaluate("document.querySelector('#shutdown').click()");
    await browser.waitFor("document.querySelector('#notice').textContent.includes('Close operation is unconfirmed')");
    f.update();
    await browser.waitFor("document.querySelector('#connection-status').textContent==='Live updates'");
    assert.equal(await browser.evaluate("document.querySelector('#notice').textContent"), "The current Close operation is unconfirmed.");
    assert.deepEqual(f.posts, [{ path: "/api/runtime/close", data: {} }]);
    assert.deepEqual(browser.exceptions, []);
  });

test("after-step Stop controls share an intent, retain retry identity and explain pending permission work", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  f.current.accessRequests = [];
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1050, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('[data-human-loop-action=stop]') && !document.querySelector('#stop-current-flow').hidden");
  assert.equal(await browser.evaluate("document.querySelector('#stop-current-flow').textContent"), "Stop after this step");
  assert.equal(await browser.evaluate("document.querySelector('[data-human-loop-action=stop]').textContent"), "Stop after current step");
  await browser.evaluate(`(()=>{
    const original=window.fetch.bind(window),gate=Promise.withResolvers();window.releaseStop=gate.resolve;window.stopCalls=[];
    let lose=true;
    window.fetch=async(url,options)=>{
      if(url==='/api/stop'){
        window.stopCalls.push(JSON.parse(options.body));await gate.promise;
        const response=await original(url,options);
        if(lose){lose=false;throw new Error('Stop acknowledgement lost');}
        return response;
      }
      return original(url,options);
    };
  })()`);
  try {
    await click(browser, "#stop-current-flow");
    await browser.waitFor("window.stopCalls.length===1 && document.querySelector('#stop-current-flow').disabled");
    // The reusable component's controls are hidden by this shell, but share its callback.
    await browser.evaluate("document.querySelector('[data-human-loop-action=stop]').click()");
    assert.equal(await browser.evaluate("window.stopCalls.length"), 1, "Both controls coalesce concurrent clicks.");
    assert.equal(f.posts.length, 0);
  } finally { await browser.evaluate("window.releaseStop()"); }
  await browser.waitFor("document.querySelector('#notice').textContent.includes('Stop acknowledgement lost') && !document.querySelector('#stop-current-flow').disabled");
  assert.equal(f.posts.length, 1);
  await click(browser, "#stop-current-flow");
  await browser.waitFor("window.stopCalls.length===2 && !document.querySelector('#stop-current-flow').disabled");
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1], f.posts[0], "An explicit retry retains the exact Stop identity.");
  assert.equal(await browser.evaluate("document.querySelector('#notice').hidden"), true);
  f.current.workflow.status = "stopping";
  f.current.workflow.reason = "Stop after current step requested. The current turn may continue editing or wait for permission; its result must settle first.";
  f.current.workflow.canStop = false; f.current.workflow.canSend = false;
  f.current.accessRequests = snapshot().accessRequests;
  f.update();
  await browser.waitFor("document.querySelector('#current-state-title').textContent==='Permission response needed'");
  assert.match(await browser.evaluate("document.querySelector('#current-state-detail').textContent"), /editing.*permission/);
  assert.equal(await browser.evaluate("document.querySelector('#send').disabled"), true);
  assert.equal(await browser.evaluate("document.querySelector('[data-access-batch=once]').disabled"), false,
    "A pending stop does not withdraw permission needed by the current settling step.");
  assert.equal(f.posts.every(post => post.path === "/api/stop"), true, "Stop controls never synthesize a new work request or question answer.");
  assert.deepEqual(browser.exceptions, []);
});

for (const settled of [false, true]) test(`lost Stop acknowledgement is confirmed from its exact ${settled ? "completed" : "pending"} identity`,
  { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
    const f = await fixture(t, { onPost: ({ path, data, current }) => {
      if (path !== "/api/stop") return;
      const stop = { id: data.stopId, mode: "after-step", taskId: "designer" };
      current.workflow.stop = settled ? null : stop;
      current.workflow.lastStop = settled ? { ...stop, invalidatedQuestions: [] } : null;
      current.workflow.status = settled ? "ready" : "stopping";
      current.workflow.canStop = false;
      current.workflow.canSend = settled;
      current.workflow.questionInteraction = null;
    } });
    const { browser } = f;
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1050, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("!document.querySelector('#stop-current-flow').hidden");
    await browser.evaluate(`(()=>{
      const original=window.fetch.bind(window);
      window.fetch=async(url,options)=>{
        const result=await original(url,options);
        if(url==='/api/stop')throw new Error('Acknowledgement lost after durable admission');
        return result;
      };
    })()`);
    await click(browser, "#stop-current-flow");
    await browser.waitFor(`document.querySelector('.conversation-state-strip').dataset.state==='${settled ? "ready" : "stopping"}' && document.querySelector('#stop-current-flow').hidden`);
    assert.equal(await browser.evaluate("document.querySelector('#notice').hidden"), true,
      "An exact durable Stop observation confirms the intent without a misleading failure.");
    assert.equal(f.posts.length, 1, "Confirmation must not resend Stop or admit another request.");
    assert.equal(f.posts[0].path, "/api/stop");
    assert.equal(await browser.evaluate("document.querySelector('#send').disabled"), !settled);
    assert.deepEqual(browser.exceptions, []);
  });

test("split Stop menu escalates the exact graceful identity and remains compact with Background in short panels",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t, { onPost: ({ path, data, current }) => {
      if (path !== "/api/stop") return;
      current.workflow.stop = { id: data.stopId, mode: data.mode ?? "after-step", taskId: "active" };
      current.workflow.status = "stopping";
      current.workflow.canStop = false;
      current.workflow.canStopNow = data.mode !== "immediate";
    } });
    f.current.accessRequests = [];
    f.current.workflow.canStopNow = true;
    f.current.processes.nativeSessions = [{
      id: "native:background", shellId: "owned-app", mode: "async", backgroundOrigin: "explicit-async",
      status: "running", command: "node server.mjs", canStop: true,
    }, { id: "native:foreground", shellId: "owned-sync", mode: "sync", backgroundOrigin: null, status: "starting" }];
    const { browser } = f;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("!document.querySelector('#stop-options').disabled");
    for (const width of [1500, 390, 320]) for (const theme of ["light", "dark"]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 420, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)};document.querySelector('#stop-options').focus()`);
      for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      const geometry = await browser.evaluate(`(() => {
        const r=document.querySelector('#stop-options-menu').getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,
          focused:document.activeElement.id,background:document.querySelector('#background-processes summary').textContent,
          expanded:document.querySelector('#stop-options').getAttribute('aria-expanded'),scroll:document.documentElement.scrollWidth};
      })()`);
      assert.equal(geometry.focused, "stop-now");
      assert.equal(geometry.expanded, "true");
      assert.equal(geometry.background, "Background 1");
      assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= 420
        && geometry.scroll <= width, JSON.stringify(geometry));
      await capture(browser, `stop-menu-${width}-${theme}`, geometry);
      for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      assert.equal(await browser.evaluate("document.activeElement.id"), "stop-options");
    }
    await click(browser, "#stop-current-flow");
    await browser.waitFor("document.querySelector('#stop-current-flow').disabled && !document.querySelector('#stop-options').disabled");
    await click(browser, "#stop-options");
    await click(browser, "#stop-now");
    await browser.waitFor("document.querySelector('#workflow-stop-control').hidden");
    assert.equal(f.posts.length, 2);
    assert.deepEqual(f.posts[1].data, { stopId: f.posts[0].data.stopId, mode: "immediate" });
    f.current.workflow.stop = null; f.current.workflow.status = "working";
    f.current.workflow.activeRequestId = "later";
    f.current.workflow.canStop = true; f.current.workflow.canStopNow = true; f.update();
    await browser.waitFor("!document.querySelector('#stop-current-flow').disabled");
    await click(browser, "#stop-current-flow");
    await browser.waitFor("document.querySelector('#stop-current-flow').disabled");
    assert.equal(f.posts.length, 3);
    assert.equal(f.posts[2].data.mode, undefined);
    assert.notEqual(f.posts[2].data.stopId, f.posts[0].data.stopId);
    assert.deepEqual(browser.exceptions, []);
  });

test("Background Stop preserves real keyboard focus through pending and completed controls",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    let finish, admitted;
    const f = await fixture(t, { onPost: ({ path, data, current }) => {
      assert.equal(path, "/api/apps/stop");
      assert.equal(data.id, "native:owned");
      return new Promise(resolve => {
        finish = () => {
          Object.assign(current.processes.nativeSessions[0], { status: "stopped", canStop: false });
          resolve({});
        };
        admitted();
      });
    } });
    f.current.accessRequests = [];
    Object.assign(f.current.workflow, { status: "working", activeRole: "designer", activeRequestId: "request",
      canStop: true, canStopNow: true, questionInteraction: null });
    const foreground = structuredClone(f.current.workflow);
    const { browser } = f;
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("!document.querySelector('#send').disabled");
    const summary = "#background-processes details > summary";
    const stop = '#background-processes button[data-native-process-id="native:owned"]';
    const escape = async () => {
      for (const type of ["keyDown", "keyUp"]) {
        await browser.call("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      }
    };
    for (const width of [1440, 390, 320]) for (const theme of ["light", "dark"]) {
      f.current.processes.nativeSessions = [
        { id: "native:owned", shellId: "owned-app", mode: "async", backgroundOrigin: "explicit-async",
          status: "running", command: "node server.mjs", canStop: true },
        { id: "native:retired", shellId: "historical-app", mode: "async", backgroundOrigin: "explicit-async",
          status: "held", recordedStatus: "running", command: "node server.mjs", canStop: false,
          controlRetirement: { outcome: "authority-retired-process-state-unconfirmed" },
          reason: "Historical control authority retired. Process state remains unconfirmed; no exit or completion is claimed." },
        { id: "native:foreground", shellId: "foreground", mode: "sync", backgroundOrigin: null, status: "running" },
      ];
      finish = null;
      const admission = new Promise(resolve => { admitted = resolve; });
      f.update();
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 420, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)}`);
      await browser.waitFor(`document.querySelector(${JSON.stringify(stop)})?.disabled===false`);
      await click(browser, summary);
      await click(browser, stop);
      await browser.waitFor(`document.querySelector(${JSON.stringify(stop)}).disabled`);
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(summary)})`), true);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(summary)}).textContent`), "Background 1");
      await escape();
      assert.equal(await browser.evaluate("document.querySelector('#background-processes details').open"), false);
      await admission;
      assert.equal(typeof finish, "function"); finish();
      await browser.waitFor("document.querySelector('#background-processes summary').textContent==='Background 0'");
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(summary)})`), true);
      await click(browser, summary);
      const geometry = await browser.evaluate(`(() => {
        const panel=document.querySelector('.background-panel'), r=panel.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:document.documentElement.scrollWidth,
          stopped:panel.textContent.includes('Stopped'),unconfirmed:panel.textContent.includes('Unconfirmed'),
          visibleStops:[...panel.querySelectorAll('button')].filter(button=>!button.hidden).length,
          disabledStops:[...panel.querySelectorAll('button')].filter(button=>button.disabled).length};
      })()`);
      assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= 420
        && geometry.scroll <= width, JSON.stringify(geometry));
      assert.equal(geometry.stopped, true); assert.equal(geometry.unconfirmed, true);
      assert.equal(geometry.visibleStops, 2);
      assert.equal(geometry.disabledStops, 2);
      assert.deepEqual(f.current.workflow, foreground, 'Process Stop does not change active Designer work or workflow Stop.');
      await capture(browser, `background-stop-focus-${width}-${theme}`, geometry);
      await escape();
    }
    assert.equal(f.posts.length, 6);
    assert.deepEqual(browser.exceptions, []);
  });

test("workspace questions preserve drafts and independent history browsing across repeated snapshots", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1450, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('.human-loop textarea')");
  await click(browser, "#show-questions");
  await browser.waitFor("(()=>{const n=document.querySelector('#state-history');return n.scrollTop>0 && n.scrollHeight-n.scrollTop-n.clientHeight<2})()");
  await browser.evaluate(`(() => {
    window.originalDraft=document.querySelector('.human-loop textarea');
    originalDraft.value='Keep my exact product answer.'; originalDraft.dispatchEvent(new Event('input',{bubbles:true}));
    originalDraft.focus(); originalDraft.setSelectionRange(5,12);
  })()`);
  for (let i = 0; i < 3; i++) {
    if (i === 0) f.current.messages.push({ id: "handoff", kind: "assistant", role: "designer", requestId: "request",
      text: "The source-bound handoff has arrived in the retained conversation.", timestamp: "2026-09-15T00:00:01Z" });
    f.current.events.push({ ...f.current.events[0], sequence: 26 + i, summary: `Update ${i}` }); f.update();
    await browser.waitFor(`document.querySelectorAll('#state-history li').length === ${26 + i}`);
    assert.deepEqual(await browser.evaluate(`({same:document.querySelector('.human-loop textarea')===originalDraft,
      focused:document.activeElement===originalDraft,text:originalDraft.value,start:originalDraft.selectionStart,end:originalDraft.selectionEnd})`),
    { same: true, focused: true, text: "Keep my exact product answer.", start: 5, end: 12 });
    assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions').dataset.sourceRequestId"), "request");
  }
  f.current.messages.push({ id: "history-scroll-room", kind: "assistant", role: "designer", requestId: "request",
    text: "Earlier retained conversation content. ".repeat(100), timestamp: "2026-09-15T00:00:02Z" });
  f.update();
  await browser.waitFor("document.querySelector('[data-entry-id=history-scroll-room]')");
  await browser.evaluate(`originalDraft.blur();
    for (const id of ['messages','state-history']) {
      const pane=document.getElementById(id);pane.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));pane.scrollTop=0;
    }`);
  await browser.waitFor("!document.querySelector('#newer').hidden");
  for (let i = 0; i < 3; i++) {
    f.current.events.push({ ...f.current.events[0], sequence: 29 + i, summary: `Later ${i}` });
    f.current.messages.push({ id: `later-${i}`, kind: "assistant", role: "designer", requestId: "request",
      text: "A later update that must not steal deliberate history browsing. ".repeat(8), timestamp: `2026-09-15T00:00:0${i + 2}Z` });
    f.update(); await browser.waitFor(`document.querySelectorAll('#state-history li').length === ${29 + i}`);
    assert.equal(await browser.evaluate("document.querySelector('#state-history').scrollTop"), 0);
    assert.ok(await browser.evaluate("document.querySelector('#messages').scrollTop < 2"));
  }
  await click(browser, "#newer");
  await browser.waitFor("(()=>{const n=document.querySelector('#state-history');return n.scrollHeight-n.scrollTop-n.clientHeight<2})()");
  assert.ok(await browser.evaluate("(()=>{const n=document.querySelector('#messages');return n.scrollHeight-n.scrollTop-n.clientHeight<2})()"),
    "Go to latest explicitly returns both conversation and history to the newest content.");
  await browser.evaluate("const pane=document.querySelector('#messages');pane.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));pane.scrollTop=0");
  await click(browser, "#focus-current-message");
  assert.equal(await browser.evaluate("document.querySelector('#question-panel').hidden"), false);
  assert.equal(await browser.evaluate("document.querySelector('.human-loop-question-group').open"), true);
  assert.ok(await browser.evaluate("document.querySelector('#messages').scrollTop < 2"),
    "Current blocking-question navigation reveals its own pane without moving historical messages.");
  await click(browser, '.human-loop button[data-human-loop-action="submitAnswers"]');
  await browser.waitFor("document.querySelector('.human-loop textarea').value === ''");
  assert.equal(f.posts.at(-1).path, "/api/answers");
  assert.deepEqual(f.posts.at(-1).data.answers.answers, [{ questionId: "scope", sourceResultId: "result", kind: "freeform", value: "Keep my exact product answer." }]);
  assert.deepEqual(browser.exceptions, []);
});

test("artifact snapshot actions live in the editor while raw view remains independent", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  for (const width of [1200, 390]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.url });
    await browser.waitFor("document.querySelector('[data-annotate-artifact]:not(:disabled)')");
    const hidden = () => browser.evaluate("['annotation-reset','annotation-capture'].every(id=>document.getElementById(id).getClientRects().length===0)");
    assert.equal(await hidden(), true);
    await click(browser, "[data-annotate-artifact]");
    await browser.waitFor("document.querySelector('[data-annotate-artifact]').getAttribute('aria-pressed')==='true'");
    assert.equal(await hidden(), true, "Retired live-overlay controls stay hidden.");
    await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
    await click(browser, "[data-annotation-action=close]");
    await browser.waitFor("document.querySelector('[data-annotate-artifact]').getAttribute('aria-pressed')==='false'");
    assert.equal(await hidden(), true, "A retained source binding must not keep actions visible.");
    await click(browser, ".raw-toggle");
    assert.equal(await hidden(), true);
    assert.equal(await browser.evaluate("document.querySelector('.raw-toggle').getAttribute('aria-expanded')"), "true");
    f.update();
    await browser.waitFor("document.querySelector('.raw-toggle').getAttribute('aria-expanded')==='true'");
    assert.equal(await hidden(), true);
    await capture(browser, `annotation-off-raw-${width}`, await geometry(browser));
  }
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("history tooltips show original local event timestamps on hover and keyboard focus", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  f.current.events = [
    { sequence: 1, type: "native.shell", summary: "native shell", timestamp: "2025-01-02T03:04:05Z" },
    { sequence: 2, type: "human.ready", summary: "Ready again", timestamp: "2025-06-07T18:19:20+02:00" },
  ];
  const original = structuredClone(f.current.events);
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelectorAll('#state-history li').length === 2");
  await browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const first = await browser.evaluate(`(() => {
    const button=document.querySelector('#state-history li:first-child button');
    button.scrollIntoView({block:'nearest'});
    const r=button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...first });
  await browser.waitFor("!document.querySelector('.state-history-popover').hidden");
  const assertTimestamp = async (index, title) => {
    const timestamp = original[index].timestamp;
    const actual = await browser.evaluate(`(() => {
      const panel=document.querySelector('.state-history-popover'), time=panel.querySelector('time');
      return {title:panel.querySelector('strong').textContent,detail:panel.querySelector('p').textContent,
        timestamp:time.dateTime,text:time.textContent,expected:new Date(${JSON.stringify(timestamp)}).toLocaleString(),
        visible:!panel.hidden && time.getClientRects().length>0};
    })()`);
    assert.equal(actual.title, title);
    assert.equal(actual.detail, original[index].summary);
    assert.equal(actual.timestamp, timestamp);
    assert.equal(actual.text, actual.expected);
    assert.equal(actual.visible, true);
  };
  await assertTimestamp(0, "Host update");
  await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  await browser.evaluate("document.querySelector('#state-history li:first-child button').focus()");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await browser.evaluate("document.activeElement===document.querySelector('#state-history li:nth-child(2) button')"), true);
  await browser.waitFor("document.querySelector('.state-history-popover strong').textContent==='Ready'");
  await assertTimestamp(1, "Ready");
  assert.equal(await browser.evaluate("document.activeElement.getAttribute('aria-describedby')"), "state-history-popover");
  assert.deepEqual(f.current.events, original);
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("history markers and Return to current reserve separate reachable areas with pending controls", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t), { browser } = f;
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelectorAll('#state-history > li').length === 25");
  for (const width of [1200, 390]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor: 1, mobile: false });
    for (const position of [1, 12]) {
      const selector = `#state-history > li:nth-child(${position}) > button`;
      await browser.evaluate("document.querySelector('#state-history').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}))");
      await click(browser, selector);
      await browser.waitFor("!document.querySelector('#newer').hidden");
      const geometry = await browser.evaluate(`(() => {
        const marker=document.querySelector(${JSON.stringify(selector)}), control=document.querySelector('#newer');
        const m=marker.getBoundingClientRect(), r=control.getBoundingClientRect();
        return {markerHit:marker.contains(document.elementFromPoint(m.x+m.width/2,m.y+m.height/2)),
          returnHit:control.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
          reserved:r.top>=document.querySelector('.conversation-layout').getBoundingClientRect().bottom,
          railHeight:document.querySelector('#state-history').clientHeight,
          permissionVisible:!document.querySelector('#access-approval').hidden};
      })()`);
      assert.deepEqual(geometry, { markerHit: true, returnHit: true, reserved: true,
        railHeight: geometry.railHeight, permissionVisible: true });
      assert.ok(geometry.railHeight >= 36);
      assert.equal(await browser.evaluate("document.querySelector('.state-history-popover').hidden"), false);
      await capture(browser, `history-return-${width}-${position}`, geometry);
      if (position === 1) await click(browser, "#newer");
      else {
        await browser.evaluate("document.querySelector('#newer').focus()");
        assert.equal(await browser.evaluate("document.activeElement.id"), "newer");
        for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", {
          type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
          ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
        });
      }
      await browser.waitFor("document.querySelector('#newer').hidden && (()=>{const h=document.querySelector('#state-history');return h.scrollHeight-h.scrollTop-h.clientHeight<1})()");
    }
  }
  assert.deepEqual(f.posts, [], "History navigation never changes permissions or workflow.");
  assert.deepEqual(browser.exceptions, []);
});

test("routine history groups update hover and keyboard details without losing exact events or message navigation", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t), { browser } = f;
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 720, deviceScaleFactor: 1, mobile: false });
  const approval = (sequence, timestamp) => ({ id: `approval-${sequence}`, sequence, timestamp, type: "permission.granted", source: "system",
    summary: `Read fixture-${sequence}.js approved`, data: { decision: "all", grantRequestId: "fixture-grant", permissionKind: "read",
      activity: { sessionId: "private-fixture", taskId: "task-fixture", requestId: "work-fixture", role: "designer", toolName: "view", toolCallId: `call-${sequence}` } } });
  const first = approval(1, "2025-01-02T23:59:58Z"), second = approval(2, "2025-01-04T01:00:02Z");
  const handoff = { id: "handoff-event", sequence: 4, timestamp: "2025-01-06T01:00:00Z",
    type: "human.handoff", summary: "Exact independent result", data: { kind: "designer-unchanged", requestId: "work-fixture", resultId: "result-fixture" } };
  f.current.events = [first, second, handoff];
  f.current.messages.push({ id: "handoff:result-fixture", requestId: "work-fixture", kind: "assistant", timestamp: handoff.timestamp, text: handoff.summary });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('.state-history-count')?.textContent === '×2'");
  assert.equal(await browser.evaluate("document.querySelectorAll('#state-history > li').length"), 2);
  const point = await browser.evaluate(`(async () => {
    const button=document.querySelector('#state-history > li > button');
    window.groupMarker=button; button.scrollIntoView({block:'center'});
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    const r=button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  assert.equal(await browser.evaluate(`document.elementFromPoint(${point.x},${point.y})?.closest('button') === window.groupMarker`), true,
    await browser.evaluate(`JSON.stringify({point:${JSON.stringify(point)},width:innerWidth,height:innerHeight,
      hit:document.elementFromPoint(${point.x},${point.y})?.outerHTML,
      bounds:window.groupMarker.getBoundingClientRect().toJSON(),
      rail:document.querySelector('#state-history').getBoundingClientRect().toJSON(),
      scrollTop:document.querySelector('#state-history').scrollTop,
      returnBounds:document.querySelector('#newer').getBoundingClientRect().toJSON()})`));
  await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await browser.waitFor("document.querySelector('.state-history-popover strong').textContent === 'Automatic approval ×2'");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.state-history-popover time')].map(n=>n.dateTime)"), [first.timestamp, second.timestamp]);
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.state-history-popover time')].map(n=>n.textContent)"),
    await browser.evaluate(`${JSON.stringify([first.timestamp, second.timestamp])}.map(t=>new Date(t).toLocaleString())`));
  const third = approval(3, "2025-01-05T01:00:03Z");
  f.current.events.splice(2, 0, third); f.update();
  await browser.waitFor("document.querySelector('.state-history-popover strong').textContent === 'Automatic approval ×3'");
  assert.equal(await browser.evaluate("window.groupMarker===document.querySelector('#state-history > li > button')"), true);
  assert.equal(await browser.evaluate("document.querySelector('.state-history-popover p').textContent"), `Latest: ${third.summary}`);
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.state-history-popover time')].map(n=>n.dateTime)"), [first.timestamp, third.timestamp]);
  f.update();
  await browser.evaluate("new Promise(resolve=>setTimeout(resolve,100))");
  assert.equal(await browser.evaluate("document.querySelector('.state-history-count').textContent"), "×3");
  await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  await browser.evaluate("document.querySelector('.state-history-count').focus()");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await browser.evaluate("document.activeElement===window.groupMarker"), true);
  assert.equal(await browser.evaluate("document.activeElement.getAttribute('aria-describedby')"), "state-history-popover");
  assert.equal(await browser.evaluate("document.querySelector('.state-history-popover').hidden"), false);
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await browser.evaluate("document.activeElement.className"), "state-history-count");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.waitFor("document.querySelector('.state-history-events').open");
  assert.equal(await browser.evaluate("document.querySelector('.state-history-count').getAttribute('aria-expanded')"), "true");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.state-history-events li time')].map(n=>n.dateTime)"),
    [first.timestamp, second.timestamp, third.timestamp]);
  const identities = await browser.evaluate("[...document.querySelectorAll('.state-history-events pre')].map(n=>JSON.parse(n.textContent))");
  assert.deepEqual(identities.map(({ eventId, timestamp, activity }) => ({ eventId, timestamp, activity })),
    [first, second, third].map(event => ({ eventId: event.id, timestamp: event.timestamp, activity: event.data.activity })));
  await click(browser, ".state-history-events summary");
  f.update(); await browser.evaluate("new Promise(resolve=>setTimeout(resolve,100))");
  assert.equal(await browser.evaluate("document.querySelector('.state-history-events details').open"), true);
  for (const width of [1200, 390]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor: 1, mobile: false });
    assert.equal(await browser.evaluate(`(() => {const r=document.querySelector('.state-history-events').getBoundingClientRect();
      return r.left>=0 && r.right<=${width} && r.top>=0 && r.bottom<=720})()`), true);
  }
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await browser.waitFor("!document.querySelector('.state-history-events').open");
  assert.equal(await browser.evaluate("document.activeElement.className"), "state-history-count");
  await click(browser, '#state-history [data-transition-id="event:shell-fixture:4"] > button');
  assert.equal(await browser.evaluate('document.querySelector(\'[data-entry-id="handoff:result-fixture"]\').classList.contains("state-focused")'), true);
  f.current.events = [first, handoff]; f.update();
  await browser.waitFor("document.querySelector('.state-history-count').hidden");
  assert.equal(await browser.evaluate("document.querySelector('#state-history > li > button').getAttribute('aria-label')"), "Automatic approval. Show recorded explanation.");
  assert.deepEqual(f.posts, []); assert.deepEqual(browser.exceptions, []);
});

test("history selection preserves exact links with transient viewport-bound hover and focus details", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null;
  f.current.workflow.lastHandoff = null; f.current.workflow.canStop = false; f.current.accessRequests = [];
  const waiting = "Setup needs an idle main Session; wait for the current Host turn to finish.\n" + "Exact retained explanation. ".repeat(90);
  f.current.events = [
    { sequence: 1, type: "human.setup-waiting", summary: waiting },
    { sequence: 2, type: "human.ready", summary: "One-copy project workflow is ready." },
    { sequence: 3, type: "human.role", data: { role: "reviewer", requestId: "late-request" }, summary: "Whole-plan completion has occurred; Review is now running." },
    { sequence: 4, type: "human.execution-unknown", summary: "The prior execution could not be confirmed; saved code is retained." },
    { sequence: 5, type: "human.handoff", data: { kind: "design-concern", requestId: "request" }, summary: "A product decision is required before continuing this plan." },
    { sequence: 6, type: "permission.denied", data: { requestId: "permission-id" }, summary: "The earlier command permission was denied." },
    { sequence: 7, type: "human.stopped", data: { stopId: "stop-id" }, summary: "The previous work was stopped. Its queued requests were discarded, not held." },
  ].map((event) => ({ ...event, timestamp: "2026-09-15T00:00:01Z" }));
  const originals = structuredClone(f.current.messages);
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelectorAll('#state-history li').length === 7");
  const labels = ["Setup waiting", "Ready", "Reviewing", "State unknown", "Input needed", "Permission denied", "Stopped"];
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#state-history button > span:last-child')].map(n=>n.textContent)"), labels);
  const before = await geometry(browser);
  const staleHeader = () => browser.evaluate("(()=>{const node=document.createElement('section');node.id='history-details';node.textContent='Previously opened history';document.querySelector('.conversation-state-strip').after(node)})()");
  await staleHeader();
  for (let i = 0; i < labels.length; i++) {
    await click(browser, `#state-history li:nth-child(${i + 1}) button`);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('#history-details'))"), false);
    assert.equal(await browser.evaluate("document.querySelector('.state-history-popover p').textContent"), f.current.events[i].summary);
    assert.equal(await browser.evaluate("document.querySelectorAll('.state-history-explanation').length"), 0);
    assert.equal(await browser.evaluate("document.activeElement.closest('li').dataset.transitionId"), `event:shell-fixture:${i + 1}`);
    assert.equal(await browser.evaluate("document.querySelectorAll('#messages .state-focused').length"), 0);
    assert.equal(await browser.evaluate("document.querySelector('#current-state-title').textContent"), "Ready");
    assert.equal(await browser.evaluate("document.querySelector('#current-state').textContent"), "Ready");
    assert.equal(await browser.evaluate("document.querySelectorAll('#messages .conversation-entry').length"), originals.length);
    const after = await geometry(browser);
    assert.equal(after.rail.width, before.rail.width);
    assert.ok(after.pageWidth <= 1200);
    if (i === 0) await capture(browser, "compact-rail-setup-details", after);
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    assert.equal(await browser.evaluate("document.querySelector('.state-history-popover').hidden"), true);
    assert.equal(await browser.evaluate("document.activeElement.closest('li').dataset.transitionId"), `event:shell-fixture:${i + 1}`);
  }
  assert.deepEqual(f.current.messages, originals);
  f.current.messages.push({ id: "late-original", kind: "user", requestId: "late-request",
    timestamp: "2026-09-15T00:00:00Z", text: "An exact original recovered with the next conversation snapshot." });
  f.update();
  await browser.waitFor("document.querySelector('[data-entry-id=\"late-original\"]')");
  await click(browser, "#state-history li:nth-child(3) button");
  assert.equal(await browser.evaluate("document.querySelector('[data-entry-id=\"late-original\"]').classList.contains('state-focused')"), false);
  f.current.events.push({ sequence: 8, type: "human.handoff", data: { kind: "review-result", requestId: "late-request", resultId: "exact-review" },
    summary: "Review result", timestamp: "2026-09-15T00:00:02Z" });
  f.update();
  await browser.waitFor("document.querySelectorAll('#state-history li').length === 8");
  await click(browser, "#state-history li:nth-child(8) button");
  assert.equal(await browser.evaluate("document.querySelector('.state-history-popover p').textContent"), "Review result");
  f.current.messages.push({ id: "handoff:exact-review", kind: "assistant", requestId: "late-request",
    text: "Exact persisted Review", timestamp: "2026-09-15T00:00:03Z" });
  f.update();
  await browser.waitFor("document.querySelector('#state-history li:nth-child(8) button').getAttribute('aria-controls') === 'messages'");
  assert.equal(await browser.evaluate("document.querySelectorAll('.state-history-explanation:not([hidden])').length"), 0);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('#history-details'))"), false);
  await staleHeader();
  await click(browser, "#state-history li:nth-child(8) button");
  assert.equal(await browser.evaluate("document.querySelector('[data-entry-id=\"handoff:exact-review\"]').classList.contains('state-focused')"), true);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('#history-details'))"), false);
  await click(browser, "#focus-current-message");
  assert.equal(await browser.evaluate("document.activeElement.dataset.entryId"), "handoff:exact-review");
  await browser.evaluate("document.querySelector('#focus-current-message').focus()");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  assert.equal(await browser.evaluate("document.activeElement.dataset.entryId"), "handoff:exact-review");
  assert.equal(await browser.evaluate("document.querySelector('.conversation-current').innerText.trim()"), "Ready");
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.state-history-hint'))"), false);
  await capture(browser, "history-exact-message-no-popup", await geometry(browser));
  const exactLabels = await browser.evaluate("[...document.querySelectorAll('#state-history button > span:last-child')].map(n=>n.textContent)");
  for (const theme of ["light", "dark"]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 950, deviceScaleFactor: 1, mobile: false });
    await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await browser.evaluate("document.querySelector('.conversation-state-column').scrollIntoView({block:'center'})");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#state-history button > span:last-child')].map(n=>n.textContent)"), exactLabels);
    const style = await browser.evaluate(`(() => {
      const step=document.querySelector('.state-history-step'), dot=step.querySelector('.state-history-dot');
      return {connector:getComputedStyle(step,'::after').width, dot:getComputedStyle(dot).width,
        current:document.querySelector('#current-state-title').textContent};
    })()`);
    assert.equal(style.connector, "1px"); assert.equal(style.dot, "28px"); assert.equal(style.current, "Ready");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await browser.evaluate("document.querySelector('#state-history li:first-child button').focus()");
    const focusLabel = await browser.evaluate(`(() => {
      const button=document.activeElement, label=button.querySelector('.state-history-label');
      return {text:label.textContent, aria:button.getAttribute('aria-label'), title:button.title,
        clip:getComputedStyle(label).clipPath, target:button.getBoundingClientRect().height};
    })()`);
    assert.equal(focusLabel.text, "Setup waiting");
    assert.match(focusLabel.aria, /^Setup waiting\./); assert.equal(focusLabel.title, "");
    assert.equal(await browser.evaluate("Boolean(document.activeElement.closest('[title]') || document.activeElement.querySelector('[title],title'))"), false);
    assert.ok(focusLabel.target >= 36);
    assert.equal(await browser.evaluate("document.querySelector('.state-history-popover').hidden"), false);
    assert.equal(await browser.evaluate("document.querySelector('.state-history-popover strong').textContent"), "Setup waiting");
    assert.equal(await browser.evaluate("document.querySelector('.state-history-popover p').textContent"), waiting);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.state-history-caption'))"), false);
    const popover = await browser.evaluate(`(() => {
      const p=document.querySelector('.state-history-popover'), r=p.getBoundingClientRect();
      return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
    })()`);
    assert.ok(popover.x >= 0 && popover.right <= 390 && popover.y >= 0 && popover.bottom <= 950);
    assert.ok(popover.width > 250, "Details must not be squeezed into the narrow rail.");
    await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: popover.x + 20, y: popover.y + 20 });
    await browser.evaluate("new Promise(done=>setTimeout(done,1500))");
    assert.equal(await browser.evaluate("document.querySelector('.state-history-popover').hidden"), false);
    const hoverTargets = await browser.evaluate(`(async () => {
      const first=document.querySelector('#state-history li:first-child');
      first.querySelector('button').scrollIntoView({block:'nearest'});
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const point=node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}};
      window.railPopoverHides=0;
      const panel=document.querySelector('.state-history-popover');
      window.railPopoverObserver=new MutationObserver(()=>{if(panel.hidden)window.railPopoverHides++});
      window.railPopoverObserver.observe(panel,{attributes:true,attributeFilter:['hidden']});
      return {icon:point(first.querySelector('button')),connector:point(first.querySelector('.state-history-hover-connector')),
        next:point(first.nextElementSibling.querySelector('button'))};
    })()`);
    for (const key of ["icon", "connector", "next"]) {
      await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverTargets[key] });
      await browser.evaluate("new Promise(done=>requestAnimationFrame(done))");
      assert.equal(await browser.evaluate("document.querySelector('.state-history-popover strong').textContent"), key === "next" ? "Ready" : "Setup waiting");
      assert.equal(await browser.evaluate("document.querySelector('.state-history-popover').hidden"), false);
    }
    assert.equal(await browser.evaluate("window.railPopoverHides"), 0);
    await browser.evaluate("window.railPopoverObserver.disconnect()");
    assert.equal(await browser.evaluate("document.querySelector('#state-history li:last-child .state-history-hover-connector').getClientRects().length"), 0);
    await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverTargets.connector });
    const selectedBefore = await browser.evaluate("[...document.querySelectorAll('#state-history li')].map(n=>n.dataset.selected)");
    for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...hoverTargets.connector });
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('#state-history li')].map(n=>n.dataset.selected)"), selectedBefore);
    await capture(browser, `history-visual-narrow-${theme}`, { ...await geometry(browser), ...style });
  }
  f.update();
  await browser.waitFor("!document.querySelector('[data-entry-id=\"handoff:exact-review\"]').classList.contains('state-focused')");
  assert.equal(await browser.evaluate("Boolean(document.querySelector('#history-details'))"), false);
  assert.equal(await browser.evaluate("document.querySelector('#current-state-title').textContent"), "Ready");
  assert.deepEqual(f.posts, [], "History selection must not write messages, queue requests or start work.");
  assert.deepEqual(browser.exceptions, []);
});

test("history connector paint never enters the next circle during interaction", { skip: !browserAvailable, timeout: 90_000 }, async t => {
  const f = await fixture(t, { rendererRoot: process.env.HISTORY_PAINT_PUBLIC ? resolve(process.env.HISTORY_PAINT_PUBLIC) : publicRoot });
  const { browser } = f;
  f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null;
  f.current.workflow.lastHandoff = null; f.current.workflow.canStop = false; f.current.accessRequests = [];
  f.current.events = ["human.ready", "human.setup-waiting", "human.stopped", "human.ready"]
    .map((type, i) => ({ sequence: i + 1, type, summary: `Exact event ${i + 1}`, timestamp: "2026-09-15T00:00:01Z" }));
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelectorAll('#state-history li').length === 4");
  const pixels = async index => {
    const image = await browser.call("Page.captureScreenshot", { format: "png" });
    return browser.evaluate(`(async () => {
      const image = new Image(); image.src = 'data:image/png;base64,${image.data}'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const c = canvas.getContext('2d'); c.drawImage(image,0,0);
      const node = ${index} === 4 ? document.querySelector('.conversation-current') : document.querySelectorAll('.state-history-dot')[${index}];
      const r = node.getBoundingClientRect();
      return [2,3].flatMap(dy => [Math.floor(r.x+r.width/2),Math.ceil(r.x+r.width/2)]
        .map(x => [...c.getImageData(x,Math.ceil(r.y)+dy,1,1).data]));
    })()`);
  };
  for (const width of [390, 1280]) for (const theme of ["light", "dark"]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
    await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await browser.evaluate("document.querySelector('.conversation-current').scrollIntoView({block:'nearest'})");
    for (let index = 0; index < 4; index++) {
      await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
      await browser.evaluate("document.activeElement.blur();document.querySelectorAll('#state-history li').forEach(n=>delete n.dataset.selected)");
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      const baseline = await pixels(index + 1);
      await capture(browser, `paint-${width}-${theme}-${index}-before`, { baseline });
      for (const state of ["hover", "focus", "selected", "popover"]) {
        const point = await browser.evaluate(`(() => {
          const item=document.querySelectorAll('#state-history li')[${index}], button=item.querySelector('button');
          if (${JSON.stringify(state)} === 'focus') button.focus();
          if (${JSON.stringify(state)} === 'selected') item.dataset.selected='true';
          const r=button.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
        })()`);
        await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await browser.waitFor("document.querySelector('.state-history-popover:not([hidden])')");
        if (state === "popover") {
          const point = await browser.evaluate("(()=>{const r=document.querySelector('.state-history-popover').getBoundingClientRect();return{x:r.x+10,y:r.y+10}})()");
          await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        }
        const actual = await pixels(index + 1);
        await capture(browser, `paint-${width}-${theme}-${index}-${state}`, { baseline, actual });
        assert.deepEqual(actual, baseline, `${width}/${theme}/${index}/${state}: next circle/current card's clear top interior must not acquire connector paint.`);
      }
    }
    const bounds = await browser.evaluate(`(() => {
      const nodes=[...document.querySelectorAll('#state-history li')];
      return nodes.slice(0,-1).map((node,i)=>{
        const r=node.getBoundingClientRect(), s=getComputedStyle(node,'::after');
        return {start:r.top+parseFloat(s.top),end:r.bottom-parseFloat(s.bottom),
          outerBottom:node.querySelector('.state-history-dot').getBoundingClientRect().bottom,
          nextOuterTop:nodes[i+1].querySelector('.state-history-dot').getBoundingClientRect().top};
      });
    })()`);
    for (const bound of bounds) {
      assert.ok(Math.abs(bound.start - bound.outerBottom) <= 0.5, JSON.stringify(bound));
      assert.ok(Math.abs(bound.end - bound.nextOuterTop) <= 0.5, JSON.stringify(bound));
    }
  }
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("compact history stays centered and ends at its last event with and without scrollbars", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t), { browser } = f;
  f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null;
  f.current.workflow.lastHandoff = null; f.current.workflow.canStop = false; f.current.accessRequests = [];
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#send').disabled === false");
  for (const width of [390, 1280]) for (const theme of ["light", "dark"]) for (const count of [2, 40]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false });
    await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    f.current.events = Array.from({ length: count }, (_, i) => ({ sequence: i + 1, type: "human.ready",
      summary: `Ready ${i + 1}`, timestamp: "2026-09-15T00:00:01Z" }));
    f.update();
    await browser.waitFor(`document.querySelectorAll('#state-history li').length === ${count}`);
    const measured = await browser.evaluate(`(async () => {
      const list = document.querySelector('#state-history'), footer = document.querySelector('.conversation-current');
      list.scrollTop = list.scrollHeight;
      footer.scrollIntoView({block:'nearest'});
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const center = node => { const r = node.getBoundingClientRect(); return r.x + r.width / 2; };
      const pseudo = (node, selector) => {
        const r = node.getBoundingClientRect(), s = getComputedStyle(node, selector);
        return {x:r.x + node.clientLeft + parseFloat(s.left) + parseFloat(s.width) / 2,
          top:r.y + node.clientTop + parseFloat(s.top), width:parseFloat(s.width)};
      };
      const last = list.lastElementChild, r = last.getBoundingClientRect(), s = getComputedStyle(last, '::after');
      return {center:center(list), currentConnector:getComputedStyle(footer,'::before').display,
        icons:[...list.querySelectorAll('.state-history-dot')].map(center),
        spines:[...list.children].slice(0,-1).map(node => pseudo(node,'::after').x),
        lastConnector:s.display,lastHeight:r.height,
        overflowing:list.scrollHeight > list.clientHeight, gutter:list.offsetWidth - list.clientWidth};
    })()`);
    assert.equal(measured.overflowing, count === 40, JSON.stringify(measured));
    if (count === 40) assert.ok(measured.gutter > 0, "Exercise actual classic scrollbar geometry, not only overlay scrollbars.");
    for (const x of [...measured.icons, ...measured.spines]) {
      assert.ok(Math.abs(x - measured.center) <= 0.5, JSON.stringify(measured));
    }
    assert.equal(measured.lastConnector, "none");
    assert.equal(measured.currentConnector, "none");
    assert.equal(measured.lastHeight, 36);
    await capture(browser, `history-centerline-${width}-${theme}-${count}`, measured);
  }
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("current status is quiet inline navigation in the composer action row", { skip: !browserAvailable, timeout: 90_000 }, async t => {
  const f = await fixture(t), { browser } = f;
  f.current.workflow.questionInteraction = null; f.current.workflow.lastHandoff = null; f.current.accessRequests = [];
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelector('#send').disabled === false");
  await browser.evaluate("document.querySelector('#message').value='A multiline request\\nwith a second line\\nand a third line';document.querySelector('#message').style.height='100px'");
  const states = [
    ["ready", "Ready"], ["working", "Designer working..."], ["closed", "Development closed"],
    ["waiting-permission", "Permission response needed"], ["execution-unknown", "Development needs attention"],
    ["stopping", "Development needs attention"], ["working", "Compacting context..."],
    ["ready", "Compacting context..."], ["working", "Compaction requested"],
  ];
  for (const width of [320, 390, 1280]) for (const height of [560, 950]) for (const theme of ["light", "dark"]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const [status, label] of states) {
      const compacting = label.startsWith("Compacting");
      const requested = label === "Compaction requested";
      f.current.workflow.status = status; f.current.workflow.canStop = status === "working" || status === "stopping";
      f.current.workflow.activeRequestId = status === "working" ? "request" : null;
      f.current.workflow.activeRole = status === "working" ? "designer" : null;
      f.current.workflow.activeCondition = status === "working" ? "running" : null;
      f.current.workflow.reason = status === "execution-unknown" || status === "stopping" ? "The current execution needs attention." : null;
      f.current.installation.status = status === "closed" ? "closed" : "ready";
      f.current.accessRequests = status === "waiting-permission" ? snapshot().accessRequests : [];
      f.current.workflow.compaction = { active: compacting, requested, trigger: "native", canRequest: !compacting && !requested, error: null };
      f.update();
      await browser.waitFor(`document.querySelector('#current-state-title').textContent === ${JSON.stringify(label)}`);
      const measured = await browser.evaluate(`(async () => {
        const current=document.querySelector('.conversation-current'), row=current.parentElement;
        current.scrollIntoView({block:'nearest'});
        await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
        const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        const rail=document.querySelector('.conversation-state-column'),button=document.querySelector('#focus-current-message');
        const style=getComputedStyle(current),buttonStyle=getComputedStyle(button),icon=button.querySelector('.current-state-icon');
        return {current:rect(current),row:rect(row),composer:rect(document.querySelector('#composer')),
          send:rect(document.querySelector('#send')),stop:rect(document.querySelector('#stop-current-flow')),rail:rect(rail),
          hit:rect(document.querySelector('#state-history button')),name:rail.getAttribute('aria-label'),
          parent:row.className,insideComposer:row.parentElement.id==='composer',position:getComputedStyle(row).position,buttonText:button.textContent,
          border:style.borderTopWidth,background:style.backgroundColor,buttonBorder:buttonStyle.borderTopWidth,
          buttonBackground:buttonStyle.backgroundColor,buttonShadow:buttonStyle.boxShadow,type:button.type,
          indicator:rect(icon),indicatorHidden:icon.getAttribute('aria-hidden'),live:current.getAttribute('aria-live'),
          clipped:current.scrollWidth>current.clientWidth,heading:getComputedStyle(rail.querySelector('h3')).position,
          compactionVisible:!document.querySelector('#compaction-status').hidden,pageWidth:document.documentElement.scrollWidth};
      })()`);
      assert.equal(measured.parent, "composer-actions");
      assert.equal(measured.insideComposer, true);
      assert.ok(["static", "relative"].includes(measured.position), "Composer actions remain in normal document flow.");
      assert.equal(measured.name, "State history");
      assert.equal(measured.heading, "absolute");
      assert.equal(measured.buttonText, label);
      assert.equal(measured.type, "button");
      assert.equal(measured.border, "0px");
      assert.equal(measured.buttonBorder, "0px");
      assert.equal(measured.background, "rgba(0, 0, 0, 0)");
      assert.equal(measured.buttonBackground, "rgba(0, 0, 0, 0)");
      assert.equal(measured.buttonShadow, "none");
      assert.equal(measured.live, "polite");
      assert.equal(measured.indicatorHidden, "true");
      assert.ok(measured.indicator.width >= 7 && measured.indicator.width <= 14);
      assert.ok(measured.rail.width <= 76 && measured.hit.width >= 36, JSON.stringify(measured));
      assert.ok(measured.current.top >= measured.send.bottom && measured.current.bottom <= measured.composer.bottom, JSON.stringify(measured));
      if (f.current.workflow.canStop) {
        const beside = measured.current.left >= measured.stop.right + 10
          && measured.current.top < measured.stop.bottom && measured.current.bottom > measured.stop.top;
        const wrapped = measured.current.top >= measured.stop.bottom + 8;
        assert.ok(beside || wrapped, "Status must remain separate from the split Stop control: " + JSON.stringify(measured));
      }
      assert.ok(measured.current.right <= width && measured.current.left >= 0 && measured.current.bottom <= height, JSON.stringify(measured));
      assert.ok(Math.abs(measured.row.right - measured.current.right) <= 1, JSON.stringify(measured));
      assert.equal(measured.clipped, false);
      assert.equal(measured.compactionVisible, false, "Routine compaction uses current status; the separate field is error-only.");
      assert.ok(measured.pageWidth <= width);
      if (status === "working") {
        await browser.evaluate("document.querySelector('#stop-current-flow').focus()");
        for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.equal(await browser.evaluate("document.activeElement === document.querySelector('#quick-requests summary')"), true);
        for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.equal(await browser.evaluate("document.activeElement.id"), "focus-current-message");
        assert.equal(await browser.evaluate("getComputedStyle(document.activeElement).outlineWidth"), "2px");
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        assert.equal(await browser.evaluate("document.querySelector('#messages .state-focused')?.dataset.entryId"), "original");
        if (height === 950 && label === "Designer working...") {
          await capture(browser, `status-inline-focus-${width}-${theme}`, { ...measured, focusOutline: "2px" });
        }
      }
      await browser.evaluate("document.activeElement.blur()");
      await capture(browser, `status-inline-${width}-${height}-${theme}-${compacting ? "compacting-" + status : requested ? "compaction-requested" : status}`, measured);
    }
  }
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("Your request markers precede routing and link distinct persisted requests through delayed entry and reload", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t), { browser } = f;
  f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null;
  f.current.workflow.lastHandoff = null; f.current.accessRequests = [];
  const timestamp = "2026-09-18T00:00:01Z";
  f.current.historyRequests = ["a", "b", "image-only"].map(id => ({ id, receivedAt: timestamp }));
  f.current.messages = ["a", "b"].map(id => ({ id: `request:${id}`, requestId: id, kind: "user",
    text: "Same request text", timestamp, queueState: id === "a" ? "active" : "waiting" }));
  f.current.events = ["router", "planner"].map((role, index) => ({ sequence: index + 1, type: "human.role",
    timestamp, summary: `${role} role`, data: { requestId: "a", role } }));
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelectorAll('#state-history li').length === 5");
  const labels = () => browser.evaluate("[...document.querySelectorAll('#state-history button > span:last-child')].map(n=>n.textContent)");
  assert.deepEqual(await labels(), ["Your request", "Your request", "Your request", "Routing", "Planning"]);
  for (const id of ["a", "b"]) {
    await click(browser, `#state-history [data-transition-id="request:${id}"] button`);
    assert.equal(await browser.evaluate("document.querySelector('#messages .state-focused').dataset.entryId"), `request:${id}`);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('#history-details'))"), false);
  }
  await click(browser, '#state-history [data-transition-id="request:image-only"] button');
  assert.equal(await browser.evaluate("document.querySelector('.state-history-popover p').textContent"), "Your request was received.");
  assert.equal(await browser.evaluate("document.querySelector('#messages .state-focused').dataset.entryId"), "request:b");
  f.current.messages.push({ id: "request:image-only", requestId: "image-only", kind: "user", text: "", timestamp, queueState: "waiting" });
  f.update();
  await browser.waitFor(`document.querySelector('[data-transition-id="request:image-only"] button').getAttribute('aria-controls') === 'messages'`);
  await click(browser, '#state-history [data-transition-id="request:image-only"] button');
  assert.equal(await browser.evaluate("document.querySelector('#messages .state-focused').dataset.entryId"), "request:image-only");
  await capture(browser, "request-markers-exact-navigation", await geometry(browser));
  await browser.call("Page.reload", {});
  await browser.waitFor("document.querySelectorAll('#state-history li').length === 5");
  assert.deepEqual(await labels(), ["Your request", "Your request", "Your request", "Routing", "Planning"]);
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-transition-id=\"request:b\"]').length"), 1);
  await click(browser, '#state-history [data-transition-id="request:b"] button');
  assert.equal(await browser.evaluate("document.querySelector('#messages .state-focused').dataset.entryId"), "request:b");
  assert.equal(await browser.evaluate("document.querySelector('#current-state-title').textContent"), "Ready");
  assert.equal(await browser.evaluate("Boolean(document.querySelector('#history-details'))"), false);
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

test("production Canvas selects arbitrary common artifacts and rejects stale or unrenderable reference targets", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), { browser } = f;
  f.current.workflow.status = "ready"; f.current.workflow.questionInteraction = null; f.current.workflow.lastHandoff = null;
  f.current.accessRequests = [];
  for (let i = 0; i < 4; i++) f.current.design.content.artifacts.push({
    ...structuredClone(f.current.design.content.artifacts[0]), id: `custom-document-${i}`, title: `Custom concept ${i}`,
  });
  f.current.design.binding = { revisionId: "revision-one", digest: policyHash(f.current.design.content) };
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1450, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.url });
  await browser.waitFor("document.querySelectorAll('[data-artifact-tab]').length === 7");
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-design-perspective]').length"), 0);
  for (const artifact of f.current.design.content.artifacts) {
    await click(browser, `[data-artifact-tab="${artifact.id}"]`);
    assert.equal(await browser.evaluate("document.querySelector('[data-sketch-id]').dataset.sketchId"), artifact.id);
    assert.equal(await browser.evaluate("document.querySelectorAll('.shared-sketch').length"), 1);
  }
  assert.deepEqual(await browser.evaluate("JSON.parse(document.querySelector('#design-raw').textContent)"), f.current.design.content);
  await browser.evaluate(`(() => {
    const button=[...document.querySelectorAll('#design-outcomes button')].find(n=>n.textContent==='interaction#deliver');
    window.oldReference=button; button.click();
  })()`);
  assert.equal(await browser.evaluate("document.querySelector('[data-sketch-id]').dataset.sketchId"), "interaction");
  assert.equal(await browser.evaluate("document.querySelector('.artifact-element-details code').textContent"), "interaction#deliver");
  f.current.design.content.artifacts[0].boxes.find(({ id }) => id === "deliver").details = "Revised details with the same stable element ID.";
  f.current.design.binding = { revisionId: "revision-two", digest: policyHash(f.current.design.content) };
  f.update();
  await browser.waitFor("document.querySelector('#design-raw').textContent.includes('Revised details')");
  await browser.evaluate("oldReference.click()");
  assert.match(await browser.evaluate("document.querySelector('#notice').textContent"), /another retained Design revision/);
  assert.equal(await browser.evaluate("document.querySelector('.artifact-element-details').hidden"), true);
  f.current.design.content.artifacts.at(-1).boxes[0].w = 2;
  f.current.design.binding = { revisionId: "invalid-revision", digest: policyHash(f.current.design.content) };
  f.update();
  await browser.waitFor("document.querySelector('.design-render-error')");
  assert.equal(await browser.evaluate("document.querySelectorAll('.shared-sketch').length"), 0);
  assert.deepEqual(await browser.evaluate("JSON.parse(document.querySelector('#design-raw').textContent)"), f.current.design.content);
  assert.deepEqual(f.posts, []);
  assert.deepEqual(browser.exceptions, []);
});

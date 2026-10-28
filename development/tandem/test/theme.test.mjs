import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const browserPath = process.env.CANVAS_TEST_BROWSER
  ?? (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : "");

const fixture = `
  <header class="topbar"><div class="brand"><span class="brand-mark">T</span>
    <strong>Tandem Living Canvas</strong></div><span class="runtime">Ready</span></header>
  <section class="activity-timeline"><strong>Activity history</strong></section>
  <main class="workspace-shell">
    <section class="panel canvas-panel">
      <div class="panel-heading"><h2>Living design</h2><span class="empty-badge">Living design</span></div>
      <div class="backbone-proposal"><span class="proposal-label">Contract-first proposal</span>
        <h3>Deliver a locally runnable health trend experience</h3>
        <p class="proposal-summary">Local sample data, honest provenance, and confirmed CSV import.</p>
        <section class="design-review-summary">
          <div class="design-review-summary-heading"><h4>What changed</h4></div>
          <div class="design-review-change"><strong>Specified atomic CSV import</strong><p>Validate before saving.</p></div>
        </section>
        <div class="backbone-view">
          <div class="contract-overview-exchange"><code>Read local observations</code></div>
          <section class="storage-contract"><span class="storage-medium">SQLite</span>
            <article class="storage-record"><header><strong>Observation</strong></header></article>
            <ul class="storage-fields"><li><code>date</code><span>Recorded day</span></li></ul>
          </section>
          <div class="gui-sketch-frame"><div class="gui-sketch"><div class="gui-region">
            <div class="gui-element">Source and date filters</div>
            <div class="gui-element gui-element-action">Import</div>
          </div></div></div>
          <svg class="flow-map" viewBox="0 0 400 80">
            <g class="control-flow-node" data-design-element-id="sample" data-implementation-state="in-progress">
              <rect width="180" height="60" rx="8"></rect>
              <text class="control-flow-node-label" x="12" y="35">Read local data</text>
            </g>
          </svg>
        </div>
      </div>
    </section>
    <section class="panel attention-panel">
      <div class="panel-heading"><h2>Attention</h2></div>
      <p class="attention-batch-guidance"><strong>Answer several at once:</strong> choose an answer on each card.</p>
      <article class="attention-card"><span class="attention-impact attention-impact-blocking">Blocking</span>
        <h3>Where should provider credentials be stored?</h3>
        <button class="attention-option">Local configuration</button>
      </article>
    </section>
    <section class="panel activity-panel">
      <div class="panel-heading"><h2>Activity</h2></div>
      <div class="assistant-message">The reviewed proposal was applied to its target.</div>
      <ul class="event-list"><li><time>09:08 AM</time><span class="event-type">Agent response</span>
        <p class="event-summary">Reviewed implementation is available.</p></li>
      <li class="event-user-request"><span class="event-type">Your request</span>
        <p class="event-summary">Update the local app.</p></li></ul>
      <div class="change-plan-error">The request could not be completed.</div>
      <div class="implementation-review-card">Review the saved operation before continuing.</div>
    </section>
  </main>
  <form class="command-bar"><label>Guide the agent</label><div class="command-composer">
    <div class="quick-messages"><button>Show current Attention</button></div>
    <textarea placeholder="Ask about the design"></textarea></div><button>Send</button>
  </form>`;

async function openBrowser(t) {
  const directory = await mkdtemp(join(tmpdir(), "canvas-theme-"));
  const child = spawn(browserPath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${directory}`, "about:blank",
  ], { stdio: "ignore" });
  let socket;
  t.after(async () => {
    socket?.close();
    if (child.exitCode === null) {
      const closed = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await closed;
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const discovery = join(directory, "DevToolsActivePort");
  const deadline = Date.now() + 15000;
  while (!existsSync(discovery)) {
    assert.equal(child.exitCode, null, "The browser must stay running.");
    assert.ok(Date.now() < deadline, "Browser startup timed out.");
    await delay(100);
  }
  const port = Number((await readFile(discovery, "utf8")).split(/\r?\n/)[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const result = JSON.parse(data);
    const waiter = pending.get(result.id);
    if (!waiter) return;
    pending.delete(result.id);
    clearTimeout(waiter.timer);
    if (result.error) waiter.reject(new Error(JSON.stringify(result.error)));
    else waiter.resolve(result.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 950, deviceScaleFactor: 1, mobile: false });
  const css = await readFile(process.env.CANVAS_THEME_STYLESHEET ?? new URL("../public/styles.css", import.meta.url), "utf8");
  await send("Page.enable");
  await send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(
    `<!doctype html><html data-theme-fixture="ready"><head><style>${css}</style></head><body>${fixture}</body></html>`) });
  const loaded = Date.now() + 15000;
  while (!await evaluate('document.documentElement?.dataset.themeFixture === "ready" && document.readyState === "complete"')) {
    assert.ok(Date.now() < loaded, "The owned theme fixture did not finish loading.");
    await delay(50);
  }
  return { evaluate, send };
}

const themes = {
  light: { background: "#ffffff", text: "#17241f", muted: "#59655f", border: "#ccd5d0" },
  dark: { background: "#1b1824", text: "#e5dce1", muted: "#b6aab9", border: "#494352" },
};

async function setTheme(browser, theme, media = theme) {
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: media }] });
  const colors = themes[theme];
  await browser.evaluate(`(() => {
    const root = document.documentElement;
    const colors = ${JSON.stringify(colors)};
    for (const [name, value] of Object.entries({
      '--background-color-default': colors.background,
      '--text-color-default': colors.text,
      '--text-color-muted': colors.muted,
      '--border-color-default': colors.border
    })) root.style.setProperty(name, value);
    root.style.colorScheme = ${JSON.stringify(theme)};
  })()`);
}

async function measure(browser) {
  return browser.evaluate(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgb = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value);
    };
    const luminance = values => values.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const background = element => {
      if (!element) return rgb(getComputedStyle(document.body).backgroundColor);
      const foreground = rgb(getComputedStyle(element).backgroundColor);
      if (foreground[3] === 1) return foreground;
      const parent = element.parentElement ? background(element.parentElement) : [255, 255, 255, 1];
      return foreground.slice(0, 3).map((value, index) => value * foreground[3] + parent[index] * (1 - foreground[3]));
    };
    return [
      '.brand strong', '.runtime', '.activity-timeline strong', '.empty-badge',
      '.proposal-label', '.proposal-summary', '.design-review-summary h4', '.design-review-change strong',
      '.attention-panel h2', '.attention-batch-guidance', '.attention-card h3', '.attention-option',
      '.attention-impact-blocking', '.activity-panel h2', '.assistant-message', '.event-list time',
      '.event-list .event-summary', '.event-user-request .event-summary', '.event-user-request .event-type',
      '.change-plan-error', '.implementation-review-card',
      '.contract-overview-exchange code', '.storage-medium', '.storage-record header strong', '.storage-fields code',
      '.command-bar button', '.command-bar textarea', '.gui-element', '.gui-element-action',
      '.control-flow-node-label'
    ].map(selector => {
      const element = document.querySelector(selector);
      const svg = selector === '.control-flow-node-label';
      const style = getComputedStyle(element);
      const ink = rgb(svg ? style.fill : style.color);
      const surface = svg ? rgb(getComputedStyle(element.previousElementSibling).fill) : background(element);
      const a = luminance(ink), b = luminance(surface);
      return { selector, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), surface: surface.slice(0, 3) };
    });
  })()`);
}

test("renderer text stays readable in light, dark, and host/OS-mismatched themes", {
  skip: !browserPath || !existsSync(browserPath) ? "Set CANVAS_TEST_BROWSER to a Chromium browser." : false,
}, async (t) => {
  const browser = await openBrowser(t);
  for (const [theme, media] of [["dark", "dark"], ["light", "light"], ["dark", "light"], ["light", "dark"]]) {
    await t.test(`${theme} host with ${media} OS preference`, async () => {
      await setTheme(browser, theme, media);
      const observations = await measure(browser);
      const failures = observations.filter(({ contrast }) => contrast < 4.5);
      assert.equal(failures.length, 0, `Text must reach 4.5:1 contrast: ${JSON.stringify(failures)}`);
      if (theme === "dark") {
        const chrome = observations.filter(({ selector }) => [
          ".brand strong", ".activity-timeline strong", ".attention-panel h2",
          ".activity-panel h2", ".design-review-summary h4", ".command-bar textarea",
        ].includes(selector));
        assert.ok(chrome.every(({ surface }) => Math.max(...surface) < 100),
          `Dark host must not retain light panels: ${JSON.stringify(chrome)}`);
      }
    });
  }
  for (const theme of ["dark", "light"]) {
    await t.test(`${theme} fallback without host tokens`, async () => {
      await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      await browser.evaluate("document.documentElement.removeAttribute('style')");
      const failures = (await measure(browser)).filter(({ contrast }) => contrast < 4.5);
      assert.equal(failures.length, 0, `Fallback contrast: ${JSON.stringify(failures)}`);
    });
  }
  await t.test("composer focus and placeholder stay visible", async () => {
    await setTheme(browser, "dark");
    await browser.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    const result = await browser.evaluate(`(() => {
      const input = document.querySelector('textarea');
      input.focus();
      return {
        outline: getComputedStyle(input).outlineStyle,
        width: getComputedStyle(input).outlineWidth,
        placeholder: getComputedStyle(input, '::placeholder').color,
        background: getComputedStyle(input).backgroundColor
      };
    })()`);
    assert.equal(result.outline, "solid");
    assert.equal(result.width, "2px");
    assert.notEqual(result.placeholder, result.background);
  });
  if (process.env.CANVAS_THEME_PREVIEW_URL) {
    const url = new URL(process.env.CANVAS_THEME_PREVIEW_URL);
    assert.equal(url.hostname, "127.0.0.1", "Only local appearance previews may be captured.");
    await browser.send("Page.navigate", { url: url.href });
    const deadline = Date.now() + 15000;
    while (!await browser.evaluate("Boolean(document.querySelector('#backbone-goal')?.textContent)")) {
      assert.ok(Date.now() < deadline, "The saved Design must actually render in the preview.");
      await delay(100);
    }
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 870, height: 990, deviceScaleFactor: 1, mobile: false });
  }
  if (process.env.CANVAS_THEME_SCREENSHOT) {
    await setTheme(browser, "dark");
    const image = await browser.send("Page.captureScreenshot", { format: "png" });
    await writeFile(process.env.CANVAS_THEME_SCREENSHOT, Buffer.from(image.data, "base64"));
  }
  if (process.env.CANVAS_THEME_PREVIEW) {
    const dark = await browser.evaluate("document.documentElement.outerHTML");
    await writeFile(process.env.CANVAS_THEME_PREVIEW, `<!doctype html>${dark}`);
  }
});

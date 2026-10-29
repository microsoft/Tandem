import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

let compiled: Promise<{ code: string; inputs: string[] }> | undefined;
function compile() {
  return compiled ??= build({
    stdin: {
      contents: `
        import React, { createRef, useState } from "react";
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import { History } from "lucide-react";
        import { Badge, Button, Dialog, FormField, IconButton, Status, Textarea } from "./index.js";
        export function mount() {
          const root = createRoot(document.getElementById("root"));
          const buttonRef = createRef(), iconRef = createRef();
          const counts = { clicks: 0, submits: 0, changes: 0, focuses: 0, blurs: 0, messages: [], submitters: [] };
          function Fixture({ loading = false, disabled = false, readOnly = false, preventEnter = false, error = "" }) {
            const [open, setOpen] = useState(false);
            const [message, setMessage] = useState("First second");
            return <>
              <form id="sample-form" className="revision-form" onSubmit={event => { event.preventDefault(); counts.submits++; }}>
                <Button id="action" ref={buttonRef} variant="primary" loading={loading} disabled={disabled}
                  data-owner="fixture" onClick={() => counts.clicks++}>Save changes</Button>
                <Button id="submit" type="submit">Submit sample</Button>
                <Button id="danger" variant="danger">Discard sample</Button>
                <Button id="small" size="small">Small action</Button>
                <Button id="long" style={{ maxWidth: 180 }}>Review the saved Prototype before continuing to Development</Button>
                <IconButton id="history" ref={iconRef} aria-label="Open history" loading={loading}
                  onClick={() => counts.clicks++}><History aria-hidden="true" /></IconButton>
                <FormField id="project-name" label="Project name" description="A recognizable name." error={error}>
                  {control => <input {...control} onChange={() => counts.changes++} />}
                </FormField>
                <FormField label="Notes">{control => <Textarea {...control} />}</FormField>
                <FormField label="Preview size">{control => <select {...control}><option>Desktop</option></select>}</FormField>
              </form>
              <form id="composer-form" onSubmit={event => {
                event.preventDefault(); counts.messages.push(message); counts.submitters.push(event.nativeEvent.submitter.id);
              }}>
                <Textarea id="composer-input" className="composer-input" submitOnEnter value={message} maxLength={12}
                  disabled={disabled} readOnly={readOnly} aria-label="Request"
                  onChange={event => setMessage(event.target.value)}
                  onFocus={() => counts.focuses++} onBlur={() => counts.blurs++}
                  onKeyDown={event => { if (preventEnter) event.preventDefault(); }} />
              </form>
              <Button id="composer-send" form="composer-form" type="submit" disabled={disabled || loading}>Send request</Button>
              <Dialog open={open} onOpenChange={setOpen} className="host-dialog" title="Review sample" description="No project will be changed."
                trigger={<Button id="open-dialog">Open review</Button>}
                footer={<Button id="close-dialog" onClick={() => setOpen(false)}>Close review</Button>}>
                <FormField label="Review name">{control => <input {...control} defaultValue="Sample review" />}</FormField>
              </Dialog>
              <Status id="static-status">Ready to review.</Status>
              <Status id="busy-status" role="status" busy>Reading the saved Prototype...</Status>
              <Status id="error-status" tone="danger" role="alert">The request failed. Saved work is unchanged.</Status>
              <Status id="success-status" tone="success">Changes saved.</Status>
              <Status id="warning-status" tone="warning">Review the changed source.</Status>
              <Status id="hidden-status" hidden>Hidden status</Status>
              {["neutral", "info", "success", "warning", "danger"].map(tone =>
                <Badge key={tone} id={tone + "-badge"} tone={tone} data-owner="fixture">{tone}</Badge>)}
              <Badge id="hidden-badge" hidden>Hidden badge</Badge>
            </>;
          }
          return {
            counts, buttonRef, iconRef,
            render: props => flushSync(() => root.render(<Fixture {...props} />)),
            dispose: () => flushSync(() => root.unmount())
          };
        }
      `,
      loader: "tsx", resolveDir: fileURLToPath(new URL("../src/renderer/ui/", import.meta.url)),
    },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", globalName: "UiTest",
    target: "es2022", logLevel: "silent", define: { "process.env.NODE_ENV": '"development"' },
  }).then(result => ({ code: result.outputFiles[0].text, inputs: Object.keys(result.metafile.inputs) }));
}

async function fixture(t: TestContext) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://127.0.0.1/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const errors: string[] = [];
  dom.window.console.error = (...args) => errors.push(args.map(String).join(" "));
  dom.window.eval((await compile()).code);
  const mounted = dom.window.UiTest.mount();
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  const element = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const value = dom.window.document.querySelector<T>(selector);
    assert.ok(value, `Missing element ${selector}`);
    return value;
  };
  mounted.render({});
  await flush();
  t.after(() => { mounted.dispose(); dom.window.close(); });
  return {
    document: dom.window.document, window: dom.window, element, errors,
    counts: mounted.counts, buttonRef: mounted.buttonRef, iconRef: mounted.iconRef,
    async render(props: object) { mounted.render(props); await flush(); },
    async click(selector: string) { element(selector).click(); await flush(); },
    async focus(selector: string) { element(selector).focus(); await flush(); },
    async key(key: string, properties: KeyboardEventInit = {}) {
      const target = dom.window.document.activeElement!;
      const event = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...properties });
      target.dispatchEvent(event);
      await flush();
      target.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key, bubbles: true, ...properties }));
      await flush();
      return event;
    },
  };
}

test("shared buttons preserve native form semantics, refs and explicit loading state", async t => {
  const h = await fixture(t);
  assert.equal(h.element<HTMLButtonElement>("#action").type, "button");
  assert.equal(h.buttonRef.current, h.element("#action"));
  assert.equal(h.iconRef.current, h.element("#history"));
  assert.equal(h.element("#action").dataset.owner, "fixture");
  assert.equal(h.element("#history").getAttribute("aria-label"), "Open history");
  await h.click("#action");
  assert.equal(h.counts.clicks, 1);
  assert.equal(h.counts.submits, 0);
  await h.click("#submit");
  assert.equal(h.counts.submits, 1);
  await h.render({ loading: true });
  assert.equal(h.element<HTMLButtonElement>("#action").disabled, true);
  assert.equal(h.element("#action").getAttribute("aria-busy"), "true");
  assert.equal(h.element("#action").textContent, "Save changes");
  assert.equal(h.element("#history").querySelectorAll("svg").length, 1);
  await h.click("#action");
  await h.click("#history");
  assert.equal(h.counts.clicks, 1);
  await h.render({ disabled: true });
  assert.equal(h.element<HTMLButtonElement>("#action").disabled, true);
  assert.notEqual(h.element("#action").getAttribute("aria-busy"), "true");
  assert.deepEqual(h.errors, []);
});

test("shared badges preserve readable tone labels and native attributes without implicit announcements", async t => {
  const h = await fixture(t);
  for (const tone of ["neutral", "info", "success", "warning", "danger"]) {
    const badge = h.element(`#${tone}-badge`);
    assert.equal(badge.tagName, "SPAN");
    assert.equal(badge.dataset.tone, tone);
    assert.equal(badge.dataset.owner, "fixture");
    assert.equal(badge.textContent, tone);
    assert.equal(badge.hasAttribute("role") || badge.hasAttribute("aria-live"), false);
  }
  assert.equal(h.element("#hidden-badge").hidden, true);
  assert.deepEqual(h.errors, []);
});

test("request textareas send on Enter and preserve controlled newlines, selections and external submitters", async t => {
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const h = await fixture(t);
    const input = h.element<HTMLTextAreaElement>("#composer-input");
    input.focus();
    input.setSelectionRange(5, 6);
    assert.equal((await h.key("Enter", { [modifier]: true })).defaultPrevented, true);
    assert.equal(input.value, "First\nsecond");
    assert.deepEqual([input.selectionStart, input.selectionEnd], [6, 6]);
    assert.deepEqual([...h.counts.messages], []);
    await h.render({});
    assert.equal(input.value, "First\nsecond", "A controlled rerender retains the newline");
    assert.equal(input.getAttribute("aria-keyshortcuts"), "Enter");
    assert.match(input.title, /Ctrl\+Enter for a new line/);
    assert.equal((await h.key("Enter")).defaultPrevented, true);
    assert.deepEqual([...h.counts.messages], ["First\nsecond"]);
    assert.deepEqual([...h.counts.submitters], ["composer-send"]);
    assert.deepEqual(h.errors, []);
  }
});

test("compact composers expand only when editing and retain expansion when focus moves to an action", async t => {
  const h = await fixture(t);
  const input = h.element<HTMLTextAreaElement>("#composer-input");
  assert.equal(input.dataset.composerExpanded, undefined);
  await h.focus("#composer-send");
  assert.equal(input.dataset.composerExpanded, undefined, "Focusing an action must not expand the editor.");
  await h.focus("#composer-input");
  assert.equal(input.dataset.composerExpanded, "true");
  assert.equal(h.counts.focuses, 1, "The native focus handler is preserved.");
  await h.focus("#composer-send");
  assert.equal(h.counts.blurs, 1, "The native blur handler is preserved.");
  assert.equal(input.dataset.composerExpanded, "true", "Leaving the editor must not move the clicked action.");
  await h.render({});
  assert.equal(h.element("#composer-input"), input);
  assert.equal(input.dataset.composerExpanded, "true", "Unrelated rerenders preserve the expanded editor.");
  assert.deepEqual(h.errors, []);
});

test("request textareas preserve composition, disabled submission, readonly, maxlength and custom key guards", async t => {
  const h = await fixture(t);
  const input = h.element<HTMLTextAreaElement>("#composer-input");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  await h.key("Enter", { ctrlKey: true });
  assert.equal(input.value, "First second", "Newlines respect the existing maxlength");
  input.dispatchEvent(new h.window.CompositionEvent("compositionstart", { bubbles: true }));
  await h.key("Enter");
  input.dispatchEvent(new h.window.CompositionEvent("compositionend", { bubbles: true }));
  await h.key("Enter", { isComposing: true });
  await h.key("Enter", { keyCode: 229 });
  await h.key("Enter", { repeat: true });
  assert.deepEqual([...h.counts.messages], []);
  for (const props of [{ loading: true }, { disabled: true }, { readOnly: true }, { preventEnter: true }]) {
    await h.render(props);
    input.focus();
    input.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    input.dispatchEvent(new h.window.KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    assert.deepEqual([...h.counts.messages], [], `${JSON.stringify(props)} must not submit`);
  }
  await h.render({});
  const notes = h.element<HTMLTextAreaElement>(".tandem-field textarea");
  notes.focus();
  assert.equal((await h.key("Enter")).defaultPrevented, false, "Non-request editors retain ordinary Enter behavior");
  assert.equal(h.counts.submits, 0);
  input.focus();
  await h.key("Enter");
  assert.deepEqual([...h.counts.messages], ["First second"]);
  assert.deepEqual(h.errors, []);
});

test("form fields associate native controls with stable labels, descriptions and visible errors", async t => {
  const h = await fixture(t);
  const input = h.element<HTMLInputElement>("#project-name");
  assert.equal(input.labels?.[0]?.textContent, "Project name");
  assert.equal(input.getAttribute("aria-describedby"), "project-name-help");
  const generatedIds = [...h.document.querySelectorAll(".tandem-field textarea, .tandem-field select")].map(control => control.id);
  assert.equal(new Set(generatedIds).size, 2);
  assert.ok(generatedIds.every(Boolean));
  await h.render({ error: "Enter a project name." });
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(input.getAttribute("aria-describedby"), "project-name-help project-name-error");
  assert.equal(h.element("#project-name-error").getAttribute("role"), "alert");
  assert.equal(h.element("#project-name-error").textContent, "Enter a project name.");
  assert.deepEqual([...h.document.querySelectorAll(".tandem-field textarea, .tandem-field select")].map(control => control.id), generatedIds);
  Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Planner");
  input.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(h.counts.changes, 1);
  await h.render({});
  assert.equal(input.hasAttribute("aria-invalid"), false);
  assert.equal(h.document.querySelector("#project-name-error"), null);
  assert.deepEqual(h.errors, []);
});

test("shared dialogs preserve accessible names, keyboard dismissal and trigger focus", async t => {
  const h = await fixture(t);
  h.element("#open-dialog").focus();
  await h.click("#open-dialog");
  const dialog = h.element('[role="dialog"]');
  assert.equal(h.document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent, "Review sample");
  assert.equal(h.document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent, "No project will be changed.");
  assert.equal(h.document.activeElement?.tagName, "INPUT");
  await h.key("Escape");
  assert.equal(h.document.querySelector('[role="dialog"]'), null);
  assert.equal(h.document.activeElement, h.element("#open-dialog"));
  await h.click("#open-dialog");
  await h.click("#close-dialog");
  assert.equal(h.document.querySelector('[role="dialog"]'), null);
  assert.equal(h.document.activeElement, h.element("#open-dialog"));
  assert.deepEqual(h.errors, []);
});

test("status messages keep announcements explicit and include text, not color-only meaning", async t => {
  const h = await fixture(t);
  assert.equal(h.element("#static-status").hasAttribute("role"), false);
  assert.equal(h.element("#busy-status").getAttribute("role"), "status");
  assert.equal(h.element("#error-status").getAttribute("role"), "alert");
  assert.equal(h.element("#error-status").dataset.tone, "danger");
  for (const selector of ["#static-status", "#busy-status", "#error-status"]) {
    assert.equal(h.element(selector).querySelector("svg")?.getAttribute("aria-hidden"), "true");
    assert.ok(h.element(selector).querySelector("span")?.textContent);
  }
  assert.equal(h.element("#hidden-status").hidden, true);
  assert.deepEqual(h.errors, []);
});

test("production component imports do not pull in Storybook, stories or Vite", async () => {
  const { inputs } = await compile();
  assert.ok(inputs.some(path => /ui[/\\]index\.tsx$/.test(path)));
  assert.equal(inputs.some(path => /(?:storybook|\.stories\.|node_modules[/\\]vite[/\\])/.test(path)), false);
});

function contrast(foreground: number[], background: number[]) {
  const luminance = (color: number[]) => color.map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test("shared controls retain contrast, focus, touch sizes and portal themes in the real host CSS", { skip: !browserAvailable }, async t => {
  const [{ code }, styles] = await Promise.all([
    compile(),
    build({ entryPoints: [fileURLToPath(new URL("../src/browser/styles.css", import.meta.url))], bundle: true, write: false, logLevel: "silent" }),
  ]);
  const html = `<!doctype html><html data-project-theme="light"><head><style>${styles.outputFiles[0].text}</style></head>
    <body><div id="root" class="host-dialog"></div><script>${code.replaceAll("</script", "<\\/script")}
    globalThis.fixture = UiTest.mount(); fixture.render({});</script></body></html>`;
  const server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(html); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await openFixtureBrowser(t);
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
  await browser.waitFor('Boolean(document.getElementById("action"))');
  assert.equal(await browser.evaluate('getComputedStyle(document.getElementById("history")).fontWeight === getComputedStyle(document.getElementById("sample-form")).fontWeight'), true);
  assert.equal(await browser.evaluate('getComputedStyle(document.getElementById("submit")).backgroundColor === getComputedStyle(document.documentElement).backgroundColor'), true);
  for (const theme of ["light", "dark"]) {
    await browser.evaluate(`document.documentElement.dataset.projectTheme = ${JSON.stringify(theme)}`);
    const colors: Array<{ id: string; foreground: number[]; background: number[] }> = await browser.evaluate(`(() => {
      const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
      const rgb = color => { context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      return ["action", "danger", "error-status", "warning-status", "success-status",
        "neutral-badge", "info-badge", "success-badge", "warning-badge", "danger-badge"].map(id => {
        const element = document.getElementById(id), style = getComputedStyle(element);
        return { id, foreground: rgb(style.color), background: rgb(id.endsWith("-status") ? getComputedStyle(document.documentElement).backgroundColor : style.backgroundColor) };
      });
    })()`);
    for (const color of colors) assert.ok(contrast(color.foreground, color.background) >= 4.5, `${theme} ${color.id} text contrast`);
    assert.equal(await browser.evaluate('getComputedStyle(document.getElementById("hidden-badge")).display'), "none");
    await browser.evaluate('document.getElementById("open-dialog").click()');
    await browser.waitFor('Boolean(document.querySelector("[role=dialog]"))');
    assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("[role=dialog]")).backgroundColor === getComputedStyle(document.documentElement).backgroundColor'), true);
    await browser.evaluate('document.getElementById("close-dialog").click()');
    await browser.waitFor('!document.querySelector("[role=dialog]")');
  }
  await browser.evaluate('document.getElementById("action").focus()');
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await browser.evaluate('document.activeElement.id'), "submit");
  assert.equal(await browser.evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid");
  await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".tandem-spin")).animationName'), "none");
  await browser.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 1, mobile: true });
  await browser.waitFor('matchMedia("(pointer: coarse)").matches');
  for (const id of ["action", "small", "history", "project-name"]) {
    assert.ok(await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).getBoundingClientRect().height`) >= 44, `${id} touch target`);
  }
  assert.equal(await browser.evaluate('document.getElementById("long").scrollWidth <= document.getElementById("long").clientWidth'), true);
  assert.deepEqual(browser.exceptions, []);
});

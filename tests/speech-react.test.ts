import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import type * as React from "react";
import type { createRoot } from "react-dom/client";
import type { SpeechProvider, SpeechTextarea } from "../src/renderer/speech-textarea.js";
import type { SpeechEvents, SpeechSession, SpeechSessionFactory } from "../src/renderer/speech-recognizer.js";
import type { UiContext } from "../src/renderer/ui-context.js";

const bundle = build({
  stdin: {
    contents: `
      export { SpeechProvider, SpeechTextarea } from "./src/renderer/speech-textarea.tsx";
      export { UiContext } from "./src/renderer/ui-context.tsx";
      export { createRoot } from "react-dom/client";
      export { createElement, useState, act, StrictMode } from "react";
    `,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "SpeechHarness",
  define: { "process.env.NODE_ENV": '"development"' },
  external: ["microsoft-cognitiveservices-speech-sdk"],
});

interface Field {
  id: string;
  key?: string;
  value?: string;
  maxLength?: number;
  disabled?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
}
interface SessionRecord {
  events: SpeechEvents;
  signal: AbortSignal;
  closed: boolean;
  stopped: boolean;
  session: SpeechSession;
}
async function fixture(t: TestContext, fields: Field[] = [{ id: "message", value: "Original" }], choices = false) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost:34567/", pretendToBeVisual: true, runScripts: "outside-only",
  });
  const win = dom.window;
  Object.assign(win, {
    IS_REACT_ACT_ENVIRONMENT: true,
    MessageChannel: class {
      port1 = { onmessage: () => {} };
      port2 = { postMessage: () => { setImmediate(() => this.port1.onmessage()); } };
    },
  });
  win.eval((await bundle).outputFiles[0].text);
  const api = (win as unknown as { SpeechHarness: {
    SpeechProvider: typeof SpeechProvider; SpeechTextarea: typeof SpeechTextarea; UiContext: typeof UiContext;
    createRoot: typeof createRoot; createElement: typeof React.createElement; useState: typeof React.useState;
    act: typeof React.act; StrictMode: typeof React.StrictMode;
  } }).SpeechHarness;
  const { createElement: h, useState, act } = api;
  const root = api.createRoot(win.document.getElementById("root")!);
  t.after(async () => { await act(async () => root.unmount()); win.close(); });
  const sessions: SessionRecord[] = [];
  let createSession: SpeechSessionFactory = async (events, signal) => {
    const record: SessionRecord = {
      events, signal, closed: false, stopped: false,
      session: {
        start: async () => {},
        stop: async () => { record.stopped = true; },
        close: () => { record.closed = true; },
      },
    };
    sessions.push(record);
    return record.session;
  };
  const requests: { path: string; options: RequestInit }[] = [];
  let fetcher: (path: string, options: RequestInit) => Promise<unknown> = async () => ({
    ok: true, status: 200, json: async () => ({ authenticated: true }),
  });
  Object.assign(win, { fetch: (path: string, options: RequestInit) => {
    requests.push({ path, options });
    return fetcher(path, options);
  } });
  let state = { prototypeId: "effort", generation: "one", provider: { canSubmitAnswers: true } };
  const submissions: string[] = [];
  let latestChoice = "";
  const ref = { current: null as HTMLTextAreaElement | null };
  function App() {
    const [drafts, setDrafts] = useState<Record<string, string>>(() =>
      Object.fromEntries(fields.map((field) => [field.key || field.id, field.value || ""])));
    const [choice, setChoice] = useState("preset");
    latestChoice = choice;
    return h(api.UiContext.Provider, { value: { state } as never },
      h(api.SpeechProvider, { children: null, createSession: (events, signal) => createSession(events, signal) },
        fields.map((field, index) => h("section", { key: field.id, hidden: field.hidden },
          h("form", {
            id: `${field.id}-form`,
            onSubmit: (event: React.FormEvent) => { event.preventDefault(); submissions.push(drafts[field.key || field.id] || ""); },
          },
          h(api.SpeechTextarea, {
            id: field.id, ref: index === 0 ? ref : undefined, speechKey: field.key,
            "aria-label": field.id, "aria-describedby": "existing-help",
            value: drafts[field.key || field.id] || "", maxLength: field.maxLength,
            disabled: field.disabled, readOnly: field.readOnly,
            onValueChange: (value: string) => {
              setDrafts((previous) => ({ ...previous, [field.key || field.id]: value }));
              if (choices) setChoice(value ? "custom" : "preset");
            },
            onSpeechStart: choices ? () => {
              const previous = choice;
              return () => setChoice(previous);
            } : undefined,
          }),
          h("button", { type: "submit" }, "Send"))))));
  }
  const render = async () => { await act(async () => root.render(h(api.StrictMode, null, h(App)))); };
  await render();
  const input = (id = fields[0].id) => win.document.getElementById(id) as HTMLTextAreaElement;
  const control = (selector = ".speech-toggle", id = fields[0].id) =>
    win.document.getElementById(`${id}-form`)!.querySelector(selector) as HTMLButtonElement;
  const click = async (selector = ".speech-toggle", id = fields[0].id) => {
    await act(async () => control(selector, id).click());
  };
  const start = async (id = fields[0].id) => {
    input(id).setSelectionRange(input(id).value.length, input(id).value.length);
    await click(".speech-toggle", id);
    return sessions.at(-1)!;
  };
  const transcript = async (record: SessionRecord, text: string, final = false) => {
    await act(async () => record.events.transcript(text, final));
  };
  const type = async (value: string, id = fields[0].id) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value")!.set!.call(input(id), value);
      input(id).dispatchEvent(new win.Event("input", { bubbles: true }));
    });
  };
  return {
    win, act, ref, input, control, click, start, transcript, type, sessions, requests, submissions,
    choice: () => latestChoice,
    setFetch: (next: typeof fetcher) => { fetcher = next; },
    setFactory: (factory: SpeechSessionFactory) => { createSession = factory; },
    render: async (nextFields = fields, nextState = state) => { fields = nextFields; state = nextState; await render(); },
    submit: async (id = fields[0].id) => {
      await act(async () => win.document.getElementById(`${id}-form`)!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
    },
  };
}

test("React owns accessible speech controls, forwards refs, and never authenticates or submits typed text", async (t) => {
  const h = await fixture(t);
  assert.equal(h.ref.current, h.input());
  assert.equal(h.input().getAttribute("data-speech-input"), "");
  assert.match(h.input().getAttribute("aria-describedby")!, /^existing-help speech-status-/);
  assert.equal(h.win.document.querySelectorAll(".speech-controls").length, 1);
  assert.ok(h.control().querySelector("svg"));
  assert.equal(h.control(".speech-cancel").hidden, true);
  assert.equal(h.requests.length, 0);
  await h.type("Edited by keyboard");
  assert.equal(h.input().value, "Edited by keyboard");
  assert.equal(h.sessions.length, 0);
  assert.deepEqual(h.submissions, []);
});

test("hypotheses replace the selection; stopping commits only final results and unlocks manual submit", async (t) => {
  const h = await fixture(t, [{ id: "message", value: "Hello world." }]);
  h.input().setSelectionRange(6, 11);
  await h.click();
  const record = h.sessions[0];
  assert.equal(h.input().readOnly, true);
  await h.transcript(record, "te");
  assert.equal(h.input().value, "Hello te.");
  await h.transcript(record, "team");
  assert.equal(h.input().value, "Hello team.");
  await h.transcript(record, "team", true);
  await h.transcript(record, "unfinished");
  await h.submit();
  assert.deepEqual(h.submissions, []);
  assert.match(h.control(".speech-status").textContent!, /Stop speech input before sending/);
  await h.click();
  assert.equal(h.input().value, "Hello team.");
  assert.equal(h.input().readOnly, false);
  assert.equal(h.input().selectionStart, "Hello team.".length);
  assert.equal(record.stopped, true);
  assert.equal(record.closed, true);
  assert.equal(record.signal.aborted, true);
  await h.submit();
  assert.deepEqual(h.submissions, ["Hello team."]);
});

test("one provider permits only one microphone or login across all mounted panels", async (t) => {
  const h = await fixture(t, [{ id: "first" }, { id: "second" }]);
  const record = await h.start();
  assert.equal(h.control(".speech-toggle", "second").disabled, true);
  assert.equal(h.control(".speech-sign-in", "second").disabled, true);
  await h.click(".speech-toggle", "second");
  assert.equal(h.sessions.length, 1);
  await h.transcript(record, "discard", true);
  await h.click(".speech-cancel");
  assert.equal(h.control(".speech-toggle", "second").disabled, false);
  await h.start("second");
  assert.equal(h.sessions.length, 2);
});

test("cancel and errors restore drafts and radio choices and fence callbacks from old recognizers", async (t) => {
  const h = await fixture(t, [{ id: "message", value: "  Keep me  " }], true);
  const first = await h.start();
  await h.transcript(first, "different", true);
  assert.equal(h.choice(), "custom");
  await h.click(".speech-cancel");
  assert.equal(h.input().value, "  Keep me  ");
  assert.equal(h.choice(), "preset");
  const next = await h.start();
  await h.transcript(first, "stale", true);
  await h.act(async () => first.events.error("Stale error"));
  assert.equal(h.input().value, "  Keep me  ");
  await h.transcript(next, "also discard");
  await h.act(async () => next.events.error("Microphone disconnected. Retry."));
  assert.equal(h.input().value, "  Keep me  ");
  assert.equal(h.choice(), "preset");
  assert.equal(next.closed, true);
  assert.match(h.control(".speech-status").textContent!, /Microphone disconnected/);
  assert.equal(h.control(".speech-status").dataset.status, "error");
  const link = h.control("a") as unknown as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), "/speech");
  assert.equal(link.hidden, false);
  assert.match(link.title, /sign in with Microsoft/);
});

test("stopping without a final result restores the original choice and text", async (t) => {
  const h = await fixture(t, [{ id: "message", value: "" }], true);
  const record = await h.start();
  await h.transcript(record, "only a hypothesis");
  await h.click();
  assert.equal(h.input().value, "");
  assert.equal(h.choice(), "preset");
  assert.match(h.control(".speech-status").textContent!, /No speech recognized/);
});

test("polling keeps the recognizer, while switching draft identities restores only the old draft", async (t) => {
  const h = await fixture(t, [{ id: "message", key: "first", value: "First draft" }]);
  const record = await h.start();
  await h.transcript(record, "live");
  await h.render([{ id: "message", key: "first" }]);
  assert.equal(record.closed, false);
  assert.equal(h.input().value, "First draft live");
  await h.render([{ id: "message", key: "second" }]);
  assert.equal(record.closed, true);
  assert.equal(h.input().value, "");
  await h.transcript(record, "late", true);
  assert.equal(h.input().value, "");
  await h.type("Second draft");
  await h.render([{ id: "message", key: "first" }]);
  assert.equal(h.input().value, "First draft");
  await h.render([{ id: "message", key: "second" }]);
  assert.equal(h.input().value, "Second draft");
});

test("hidden, inert, removed, and disabled ancestors immediately release microphones", async (t) => {
  const h = await fixture(t);
  for (const attribute of ["hidden", "inert", "aria-hidden"]) {
    const record = await h.start();
    await h.transcript(record, "discard");
    const panel = h.input().closest("section")!;
    await h.act(async () => panel.setAttribute(attribute, attribute === "aria-hidden" ? "true" : ""));
    assert.equal(record.closed, true, attribute);
    assert.equal(h.input().value, "Original", attribute);
    await h.act(async () => panel.removeAttribute(attribute));
  }
  const record = await h.start();
  await h.render([{ id: "message", disabled: true }]);
  assert.equal(record.closed, true);
  assert.equal(h.control().disabled, true);
  await h.render([{ id: "message", readOnly: true }]);
  assert.equal(h.control().disabled, true);
  await h.render([{ id: "message" }]);
  const unmounted = await h.start();
  await h.render([]);
  assert.equal(unmounted.closed, true);
  await h.transcript(unmounted, "late", true);
});

test("effort and provider changes release capture and permit recording only in the current identity", async (t) => {
  const h = await fixture(t);
  const record = await h.start();
  await h.transcript(record, "discard");
  await h.render(undefined, { prototypeId: "effort", generation: "two", provider: { canSubmitAnswers: true } });
  assert.equal(record.closed, true);
  assert.equal(h.input().value, "Original");
  const next = await h.start();
  await h.transcript(next, "current", true);
  assert.equal(next.closed, false);
  assert.equal(h.input().value, "Original current");
  await h.render(undefined, { prototypeId: "effort", generation: "two", provider: { canSubmitAnswers: false } });
  assert.equal(next.closed, true);
  assert.equal(h.control().disabled, true);
});

test("excess speech fails without truncating; startup cancellation closes a late session without starting", async (t) => {
  const h = await fixture(t, [{ id: "message", value: "Draft", maxLength: 10 }]);
  const record = await h.start();
  await h.transcript(record, "far too long", true);
  assert.equal(h.input().value, "Draft");
  assert.equal(record.closed, true);
  assert.match(h.control(".speech-status").textContent!, /10 character limit/);
  let resolve!: (session: SpeechSession) => void;
  let started = false;
  let closed = false;
  h.setFactory(() => new Promise((done) => { resolve = done; }));
  await h.click();
  await h.click(".speech-cancel");
  await h.act(async () => resolve({
    start: async () => { started = true; },
    stop: async () => {},
    close: () => { closed = true; },
  }));
  assert.equal(started, false);
  assert.equal(closed, true);
  assert.equal(h.input().readOnly, false);
});

test("explicit login opens no microphone, preserves edits, and survives browser focus changes", async (t) => {
  const h = await fixture(t, [{ id: "first", value: "Original" }, { id: "second" }]);
  let resolve!: (value: unknown) => void;
  h.setFetch(() => new Promise((done) => { resolve = done; }));
  await h.click(".speech-sign-in");
  assert.equal(h.requests[0].path, "/api/speech/login");
  assert.equal(h.requests[0].options.method, "POST");
  assert.equal(h.requests[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].options.headers)), {
    "Content-Type": "application/json", "X-Tandem-Speech": "1",
  });
  assert.equal(h.input().readOnly, false);
  assert.equal(h.control(".speech-toggle", "second").disabled, true);
  await h.type("Typed during sign-in");
  await h.act(async () => {
    Object.defineProperty(h.win.document, "visibilityState", { value: "hidden", configurable: true });
    h.win.document.dispatchEvent(new h.win.Event("visibilitychange"));
    h.win.dispatchEvent(new h.win.Event("blur"));
  });
  assert.equal(h.requests[0].options.signal!.aborted, false);
  await h.act(async () => resolve({ ok: true, json: async () => ({ authenticated: true }) }));
  assert.equal(h.input().value, "Typed during sign-in");
  assert.equal(h.sessions.length, 0);
  assert.match(h.control(".speech-status", "second").textContent!, /Signed in to Microsoft/);
  assert.equal(h.control(".speech-cancel").hidden, true);
});

test("cancelled login frees ownership immediately and late auth results cannot replace a newer result", async (t) => {
  const h = await fixture(t);
  let resolve!: (value: unknown) => void;
  h.setFetch(() => new Promise((done) => { resolve = done; }));
  await h.click(".speech-sign-in");
  await h.click(".speech-cancel");
  assert.equal(h.requests[0].options.signal!.aborted, true);
  assert.equal(h.control(".speech-sign-in").disabled, false);
  assert.match(h.control(".speech-status").textContent!, /sign-in cancelled/);
  h.setFetch(async () => ({ ok: false, status: 503, json: async () => ({ error: "Your organization requires approval." }) }));
  await h.click(".speech-sign-in");
  await h.act(async () => resolve({ ok: true, json: async () => ({ authenticated: true }) }));
  assert.match(h.control(".speech-status").textContent!, /organization requires approval/);
  assert.equal(h.control(".speech-status").dataset.status, "error");
  assert.equal(h.input().value, "Original");
});

test("legacy sign-in endpoint remains compatible, but authorization failures never trigger fallback", async (t) => {
  const h = await fixture(t);
  h.setFetch(async (path) => path.endsWith("/login")
    ? { ok: false, status: 404 }
    : { ok: true, status: 200, json: async () => ({ authenticated: true }) });
  await h.click(".speech-sign-in");
  assert.deepEqual(h.requests.map((request) => request.path), ["/api/speech/login", "/api/speech/sign-in"]);
  assert.match(h.control(".speech-status").textContent!, /Signed in to Microsoft/);
  h.setFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: "Open the writable provider." }) }));
  await h.click(".speech-sign-in");
  assert.equal(h.requests.length, 3);
  assert.match(h.control(".speech-status").textContent!, /writable provider/);
});

test("Escape, hidden document, and pagehide cancel capture; blurring a field does not", async (t) => {
  const h = await fixture(t);
  const first = await h.start();
  await h.transcript(first, "discard");
  await h.act(async () => h.input().dispatchEvent(new h.win.Event("blur")));
  assert.equal(first.closed, false);
  await h.act(async () => h.win.document.dispatchEvent(new h.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(first.closed, true);
  const second = await h.start();
  await h.act(async () => {
    Object.defineProperty(h.win.document, "visibilityState", { value: "hidden", configurable: true });
    h.win.document.dispatchEvent(new h.win.Event("visibilitychange"));
  });
  assert.equal(second.closed, true);
  const third = await h.start();
  await h.act(async () => h.win.dispatchEvent(new h.win.Event("pagehide")));
  assert.equal(third.closed, true);
});

test("startup, stop, capture duration, and login deadlines clean up even if promises never settle", async (t) => {
  const h = await fixture(t);
  const timers = new Map<number, { delay: number; callback: () => void }>();
  let sequence = 0;
  h.win.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++sequence;
    timers.set(id, { delay, callback });
    return id;
  }) as typeof h.win.setTimeout;
  h.win.clearTimeout = ((id: number) => { timers.delete(id); }) as typeof h.win.clearTimeout;
  const tick = async (delay: number) => {
    const timer = [...timers.entries()].find(([, entry]) => entry.delay === delay);
    assert.ok(timer, `expected ${delay}ms deadline`);
    timers.delete(timer[0]);
    await h.act(async () => timer[1].callback());
  };
  h.setFactory(() => new Promise(() => {}));
  await h.click();
  await tick(30_000);
  assert.match(h.control(".speech-status").textContent!, /startup timed out/);
  assert.equal(h.input().readOnly, false);
  let events!: SpeechEvents;
  let signal!: AbortSignal;
  let closed = false;
  let stopped = false;
  h.setFactory(async (callbacks, abort) => {
    events = callbacks;
    signal = abort;
    return { start: async () => {}, stop: () => { stopped = true; return new Promise(() => {}); }, close: () => { closed = true; } };
  });
  await h.click();
  await h.act(async () => events.transcript("discard", true));
  await tick(120_000);
  assert.equal(stopped, true);
  await tick(8000);
  assert.equal(closed, true);
  assert.equal(signal.aborted, true);
  assert.equal(h.input().value, "Original");
  assert.match(h.control(".speech-status").textContent!, /did not stop in time/);
  h.setFetch(() => new Promise(() => {}));
  await h.click(".speech-sign-in");
  await tick(190_000);
  assert.equal(h.requests[0].options.signal!.aborted, true);
  assert.match(h.control(".speech-status").textContent!, /sign-in timed out/);
  assert.equal(timers.size, 0);
});

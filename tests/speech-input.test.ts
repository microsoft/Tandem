import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { composeSpeechDraft } from "../src/renderer/speech-input.js";
import type { SpeechEvents, SpeechSession } from "../src/renderer/speech-recognizer.js";
import { reactHarness, state, decision, response } from "./helpers/react-harness.js";

async function fixture(t: TestContext, value = state()) {
  const h = await reactHarness(t);
  const sessions: { events: SpeechEvents; signal: AbortSignal; closed: boolean; stopped: boolean }[] = [];
  h.setSpeechFactory(async (events, signal) => {
    const record = { events, signal, closed: false, stopped: false };
    sessions.push(record);
    return { start: async () => {}, stop: async () => { record.stopped = true; }, close: () => { record.closed = true; } };
  });
  h.render(value);
  await h.flush();
  const control = (input: HTMLTextAreaElement, kind = ".speech-toggle") => {
    const node = input.closest(".voice-composer")?.querySelector<HTMLButtonElement>(kind);
    assert.ok(node, `Missing ${kind} for speech input ${input.id || input.name}`);
    return node;
  };
  const start = async (input: HTMLTextAreaElement) => {
    input.setSelectionRange(input.value.length, input.value.length);
    await h.click(control(input));
    return sessions.at(-1)!;
  };
  t.after(() => assert.deepEqual(h.errors, [], "Speech renders without React errors"));
  return { ...h, sessions, control, start };
}
function dag() {
  const value = state();
  value.requirements.substage = "dag";
  value.decisionGraph.nodes = [decision("q"), decision("other", "answered")] as typeof value.decisionGraph.nodes;
  return value;
}

test("speech controls cover conversational fields and exclude process configuration", async (t) => {
  const h = await fixture(t, dag());
  const inputs = h.document.querySelectorAll("[data-speech-input]");
  assert.deepEqual(Array.from(inputs).map((input) => input.id || input.getAttribute("name")).sort(), [
    "prototype-detail", "revision-input", "sketch-instruction", "usage-input",
  ]);
  assert.equal(h.document.querySelectorAll(".speech-toggle").length, inputs.length);
  assert.equal(h.document.querySelectorAll(".speech-sign-in").length, 0, "Per-field sign-in is replaced by the shared header action.");
  assert.equal(h.document.querySelectorAll("#speech-sign-in").length, 1);
  for (const input of inputs) {
    const toggle = h.control(input as HTMLTextAreaElement);
    assert.equal(toggle.getAttribute("aria-label"), "Start speech input");
    assert.ok(h.document.getElementById(toggle.getAttribute("aria-describedby")!));
  }
  assert.equal(h.get("sketch-instruction").hasAttribute("data-speech-input"), true);
  for (const name of ["intake-content", "handoff-approver"]) {
    assert.equal(h.get(name).hasAttribute("data-speech-input"), false);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.sessions.length, 0);
});

test("explicit Microsoft sign-in retains drafts through polling without requesting a microphone", async (t) => {
  const h = await fixture(t);
  const input = h.get<HTMLTextAreaElement>("usage-input");
  await h.input(input, "Keep this thought");
  let release!: (value: Response) => void;
  h.setFetch(() => new Promise((resolve) => { release = resolve; }));
  await h.click("speech-sign-in");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, "/api/speech/login");
  assert.equal(input.readOnly, false);
  assert.equal(h.control(input).disabled, true);
  await h.click("speech-sign-in");
  await h.click(h.control(input));
  assert.equal(h.sessions.length, 0);
  Object.defineProperty(h.document, "visibilityState", { value: "hidden", configurable: true });
  h.document.dispatchEvent(new h.window.Event("visibilitychange"));
  h.render({ ...state(), revision: 2 });
  assert.match(h.control(input, ".speech-status").textContent!, /Complete Microsoft sign-in/);
  await h.input(input, "Typed during sign-in");
  release(response({ authenticated: true })); await h.flush();
  assert.equal(input.value, "Typed during sign-in");
  assert.match(h.control(input, ".speech-status").textContent!, /Signed in to Microsoft/);
  assert.equal(h.sessions.length, 0);
  assert.equal(h.control(input).disabled, false);
});

test("sign-in cancellation and errors are visible and leave the draft untouched", async (t) => {
  const h = await fixture(t), input = h.get<HTMLTextAreaElement>("usage-input");
  await h.input(input, "Original");
  let signal: AbortSignal | null | undefined;
  h.setFetch((_path, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal!.addEventListener("abort", () => reject(new Error("Aborted")));
  }));
  await h.click("speech-sign-in");
  await h.click(h.document.querySelector('.speech-header-sign-in [aria-label="Cancel Microsoft sign-in"]')!);
  assert.equal(signal!.aborted, true);
  assert.equal(input.value, "Original");
  assert.match(h.control(input, ".speech-status").textContent!, /cancelled/);
  h.setFetch(async () => response({ error: "Your organization requires an approved desktop application." }, 503));
  await h.click("speech-sign-in");
  assert.match(h.control(input, ".speech-status").textContent!, /approved desktop application/);
  assert.equal(h.control(input, ".speech-status").dataset.status, "error");
  assert.equal(input.value, "Original");
});

test("speech composes at the selection without changing surrounding text", () => {
  assert.equal(composeSpeechDraft("Hello world.", 6, 11, "team"), "Hello team.");
  assert.equal(composeSpeechDraft("Hello", 5, 5, "team"), "Hello team");
  assert.equal(composeSpeechDraft("a  ", 3, 3, "b"), "a  b");
  assert.equal(composeSpeechDraft("unchanged", 2, 6, ""), "unchanged");
});

test("live hypotheses replace each other and Stop keeps only final text for manual submission", async (t) => {
  const h = await fixture(t), input = h.get<HTMLTextAreaElement>("usage-input");
  await h.input(input, "I want");
  const capture = await h.start(input);
  capture.events.transcript("to bu", false); await h.flush();
  assert.equal(input.value, "I want to bu");
  capture.events.transcript("to build a board", false); await h.flush();
  assert.equal(input.value, "I want to build a board");
  capture.events.transcript("to build a board.", true);
  capture.events.transcript("Unfinished", false); await h.flush();
  await h.fire(h.get("usage-form"), "submit");
  assert.equal(h.requests.length, 0);
  assert.match(h.control(input, ".speech-status").textContent!, /Stop speech/);
  await h.click(h.control(input));
  assert.equal(input.value, "I want to build a board.");
  assert.equal(input.readOnly, false);
  assert.equal(capture.closed, true);
  assert.equal(capture.stopped, true);
  h.setFetch(async () => response({ ...state(), revision: 2 }));
  await h.fire(h.get("usage-form"), "submit");
  assert.equal(h.requests[0].body.answer, "I want to build a board.");
});

test("speech cancellation and failures restore drafts and fence stale callbacks", async (t) => {
  const h = await fixture(t), input = h.get<HTMLTextAreaElement>("usage-input");
  await h.input(input, "  Keep my draft  ");
  const first = await h.start(input);
  first.events.transcript("discard me", true); await h.flush();
  await h.click(h.control(input, ".speech-cancel"));
  assert.equal(input.value, "  Keep my draft  ");
  assert.equal(first.signal.aborted, true);
  const second = await h.start(input);
  first.events.transcript("stale", true); first.events.error("stale error"); await h.flush();
  assert.equal(input.value, "  Keep my draft  ");
  second.events.transcript("also discard", false); second.events.error("Microphone disconnected. Retry."); await h.flush();
  assert.equal(input.value, "  Keep my draft  ");
  assert.match(h.control(input, ".speech-status").textContent!, /Microphone disconnected/);
  assert.equal(second.closed, true);
  assert.equal(input.readOnly, false);
});

test("recording stays bound through polling, and cancellation restores the decision draft", async (t) => {
  const value = dag(), h = await fixture(t, value);
  const input = h.get("question-host").querySelector("textarea")!;
  await h.input(input, "My answer");
  const capture = await h.start(input);
  capture.events.transcript("with speech", true); await h.flush();
  h.render({ ...value, revision: 2, processing: { status: "success", message: "Updated" } }); await h.flush();
  assert.equal(input.value, "My answer with speech");
  assert.equal(input.readOnly, true);
  assert.equal(capture.closed, false);
  capture.events.transcript("and more", true); await h.flush();
  assert.equal(input.value, "My answer with speech and more");
  await h.click(h.control(input, ".speech-cancel"));
  h.render({ ...value, revision: 3 });
  assert.equal(h.get("question-host").querySelector("textarea")!.value, "My answer");
});

test("changing questions and resetting efforts cannot leak transcripts into another draft", async (t) => {
  const value = dag(), h = await fixture(t, value);
  const input = h.get("question-host").querySelector("textarea")!;
  await h.input(input, "Original");
  const capture = await h.start(input);
  capture.events.transcript("private draft", false); await h.flush();
  await h.click(h.get("decision-list").querySelector('[data-decision-id="other"]')!);
  const other = h.get("question-host").querySelector("textarea")!;
  assert.equal(other.value, "");
  assert.equal(capture.closed, true);
  capture.events.transcript("late", true); await h.flush();
  assert.equal(other.value, "");
  h.render({ ...state("prepare", 3), goal: "", generation: "new" }); await h.flush();
  assert.equal(h.get<HTMLTextAreaElement>("start-goal").value, "");
});

test("decision speech cancellation restores the prior Radix choice and navigation binds new controls", async (t) => {
  const h = await fixture(t, dag());
  const form = h.get("question-host").querySelector("form")!;
  const input = form.querySelector("textarea")!;
  const radios = form.querySelectorAll('[role="radio"]');
  await h.click(radios[1]);
  const capture = await h.start(input);
  capture.events.transcript("custom answer", false); await h.flush();
  assert.equal(radios[1].getAttribute("aria-checked"), "false");
  await h.click(h.control(input, ".speech-cancel"));
  assert.equal(radios[1].getAttribute("aria-checked"), "true");
  assert.equal(input.value, "");
  await h.click(h.get("decision-list").querySelector('[data-decision-id="other"]')!);
  assert.equal(h.get("question-host").querySelectorAll(".speech-toggle").length, 1);
});

test("prototype clarification speech cancellation restores the selected answer", async (t) => {
  const value = state("prototype");
  value.prototypeReview.question = decision("clarify").question;
  const h = await fixture(t, value);
  const input = h.get<HTMLTextAreaElement>("revision-question-detail");
  const radios = h.get("revision-question-choices").querySelectorAll('[role="radio"]');
  await h.click(radios[1]);
  const capture = await h.start(input);
  capture.events.transcript("temporary clarification", false); await h.flush();
  assert.equal(radios[1].getAttribute("aria-checked"), "false");
  await h.click(h.control(input, ".speech-cancel"));
  assert.equal(radios[1].getAttribute("aria-checked"), "true");
  assert.equal(input.value, "");
  assert.equal(h.requests.length, 0);
});

test("browsing historical artifacts cancels speech without changing retained reviews or the active draft", async (t) => {
  const value = state("prototype");
  value.artifacts = ["first", "second"].map((id) => ({
    id, title: id, stage: "design", kind: "contract", content: id, reviewStatus: "current", path: "", language: "", mermaid: "",
  }));
  const h = await fixture(t, value);
  const buttons = h.get("artifact-list").querySelectorAll("[data-artifact-id]");
  const input = h.get<HTMLTextAreaElement>("revision-input");
  await h.input(input, "Original prototype feedback");
  const capture = await h.start(input);
  capture.events.transcript("must not transfer", false); await h.flush();
  await h.click("artifact-group-discovery-design");
  assert.equal(capture.closed, false, "Expanding the artifact index does not leave the current phase.");
  await h.click(buttons[0]);
  assert.equal(capture.closed, true);
  assert.equal(h.get("artifact-content").textContent, "first");
  assert.match(h.get("content-panel").textContent!, /Read-only legacy evidence/);
  assert.equal(h.get("content-panel").querySelector("textarea, .speech-toggle"), null);
  assert.equal(h.document.getElementById("design-review-input"), null, "Retired review editing is not reintroduced.");
  await h.click(buttons[1]);
  assert.equal(h.get("artifact-content").textContent, "second");
  capture.events.transcript("late callback", true); await h.flush();
  await h.click(buttons[0]);
  assert.equal(h.get("artifact-content").textContent, "first");
  await h.click("live-preview-tab");
  assert.equal(input.value, "Original prototype feedback");
  assert.equal(h.store.getSnapshot().state!.lifecycle.currentStage, "prototype");
  assert.deepEqual(h.store.getSnapshot().state!.artifacts, value.artifacts);
  assert.equal(h.requests.length, 0);
});

test("overlong speech fails visibly without truncating or submitting", async (t) => {
  const h = await fixture(t), input = h.get<HTMLTextAreaElement>("usage-input");
  await h.input(input, "Original");
  const capture = await h.start(input);
  capture.events.transcript("x".repeat(501), true); await h.flush();
  assert.equal(input.value, "Original");
  assert.match(h.control(input, ".speech-status").textContent!, /500 character limit/);
  assert.equal(capture.closed, true);
});

test("cancelled startup closes a late recognizer without starting it", async (t) => {
  const h = await fixture(t), input = h.get<HTMLTextAreaElement>("usage-input");
  let resolve!: (session: SpeechSession) => void;
  let started = false, closed = false;
  h.setSpeechFactory(() => new Promise((done) => { resolve = done; }));
  await h.click(h.control(input)); await h.click(h.control(input, ".speech-cancel"));
  resolve({ start: async () => { started = true; }, stop: async () => {}, close: () => { closed = true; } });
  await h.flush();
  assert.equal(started, false); assert.equal(closed, true); assert.equal(input.readOnly, false);
});

test("read-only and hidden stages cannot record and release the active microphone", async (t) => {
  const h = await fixture(t), input = h.get<HTMLTextAreaElement>("usage-input");
  const capture = await h.start(input);
  const preparation = h.document.querySelector('[data-stage-id="prepare"]')!;
  await h.fire(preparation, "mousedown", { button: 0 });
  assert.equal(preparation.getAttribute("aria-selected"), "true");
  assert.equal(capture.closed, true);
  assert.equal(capture.signal.aborted, true);
  assert.equal(h.control(input).disabled, true);
  await h.click(h.control(input));
  assert.equal(h.sessions.length, 1, "A hidden field cannot acquire another microphone.");
  await h.fire(h.document.querySelector('[data-stage-id="requirements"]')!, "mousedown", { button: 0 });
  assert.equal(h.control(input).disabled, false);
  h.render({ ...state(), revision: 2, provider: { canSubmitAnswers: false } }); await h.flush();
  assert.equal(h.control(input).disabled, true);
  await h.click(h.control(input));
  assert.equal(h.sessions.length, 1);
});

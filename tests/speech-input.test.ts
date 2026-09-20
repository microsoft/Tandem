import assert from "node:assert/strict";
import { test } from "node:test";
import { composeSpeechDraft } from "../src/renderer/speech-input.js";
import type { SpeechEvents, SpeechSession } from "../src/renderer/speech-recognizer.js";
import { rendererHarness, state, decision, response, type Element } from "./helpers/renderer-harness.js";

async function fixture(value = state()) {
    const h = await rendererHarness();
    const sessions: { events: SpeechEvents; signal: AbortSignal; closed: boolean; stopped: boolean }[] = [];
    h.setSpeechFactory(async (events, signal) => {
        const record = { events, signal, closed: false, stopped: false };
        sessions.push(record);
        return {
            start: async () => {},
            stop: async () => { record.stopped = true; },
            close: () => { record.closed = true; },
        };
    });
    h.api.render(value);
    const control = (input: Element, kind = ".speech-toggle") =>
        input.parentElement!.children.find((node) => node.className === "speech-controls")!.querySelector(kind)!;
    const start = async (input: Element) => {
        input.setSelectionRange(input.value.length, input.value.length);
        await control(input).emit("click");
        await h.flush();
        return sessions.at(-1)!;
    };
    return { ...h, sessions, control, start };
}

test("speech controls cover all conversational fields and exclude configuration", async () => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("q")];
    const h = await fixture(value);
    assert.equal(h.document.querySelectorAll("[data-speech-input]").length, 9);
    assert.equal(h.document.querySelectorAll(".speech-toggle").length, 9);
    assert.equal(h.document.querySelectorAll(".speech-sign-in").length, 9);
    assert.notEqual(h.document.getElementById("sketch-instruction")!.getAttribute("data-speech-input"), null);
    for (const name of ["intake-content", "verification-checks", "protected-paths", "handoff-approver"]) {
        assert.equal(h.document.getElementById(name)!.getAttribute("data-speech-input"), null);
    }
    assert.equal(h.requests.length, 0, "no Azure authentication before explicit recording");
    assert.equal(h.sessions.length, 0);
});

test("explicit browser sign-in preserves editable drafts, survives polling, and does not request a microphone", async () => {
    const h = await fixture();
    const input = h.api.elements.usageInput;
    input.value = "Keep this thought";
    let release!: (value: unknown) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.control(input, ".speech-sign-in").emit("click");
    await h.flush();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].path, "/api/speech/sign-in");
    assert.equal(input.readOnly, false);
    assert.equal(h.control(input).disabled, true);
    assert.equal(h.control(input, ".speech-sign-in").disabled, true);
    await h.control(input, ".speech-sign-in").emit("click");
    await h.control(input).emit("click");
    assert.equal(h.requests.length, 1);
    assert.equal(h.sessions.length, 0);
    h.document.visibilityState = "hidden";
    await h.document.emit("visibilitychange");
    h.api.renderIfChanged({ ...state(), revision: 2 });
    assert.match(h.control(input, ".speech-status").textContent, /Complete Microsoft sign-in/);
    input.value = "Typed during sign-in";
    await input.emit("input");
    release(response({ authenticated: true }));
    await h.flush();
    assert.equal(input.value, "Typed during sign-in");
    assert.match(h.control(input, ".speech-status").textContent, /Signed in to Microsoft/);
    assert.equal(h.sessions.length, 0);
    assert.equal(h.control(input).disabled, false);
    assert.equal(h.control(input, ".speech-cancel").hidden, true);
});

test("browser sign-in cancellation and errors are visible and leave the draft untouched", async () => {
    const h = await fixture();
    const input = h.api.elements.usageInput;
    input.value = "Original";
    let signal: AbortSignal | undefined;
    h.setFetch((_path, options) => new Promise((_resolve, reject) => {
        signal = options.signal;
        signal!.addEventListener("abort", () => reject(new Error("Aborted")));
    }));
    await h.control(input, ".speech-sign-in").emit("click");
    await h.control(input, ".speech-cancel").emit("click");
    await h.flush();
    assert.equal(signal!.aborted, true);
    assert.equal(input.value, "Original");
    assert.match(h.control(input, ".speech-status").textContent, /cancelled/);
    assert.equal(h.control(input, ".speech-sign-in").disabled, false);
    h.setFetch(async () => response({ error: "Your organization requires an approved desktop application." }, 503));
    await h.control(input, ".speech-sign-in").emit("click");
    await h.flush();
    assert.match(h.control(input, ".speech-status").textContent, /approved desktop application/);
    assert.equal(h.control(input, ".speech-status").dataset.status, "error");
    assert.equal(input.value, "Original");
    assert.equal(h.sessions.length, 0);
});

test("speech composes at the selection without changing surrounding text", () => {
    assert.equal(composeSpeechDraft("Hello world.", 6, 11, "team"), "Hello team.");
    assert.equal(composeSpeechDraft("Hello", 5, 5, "team"), "Hello team");
    assert.equal(composeSpeechDraft("a  ", 3, 3, "b"), "a  b");
    assert.equal(composeSpeechDraft("unchanged", 2, 6, ""), "unchanged");
});

test("live hypotheses replace each other and Stop keeps only final text for manual submission", async () => {
    const h = await fixture();
    const input = h.api.elements.usageInput;
    input.value = "I want";
    const capture = await h.start(input);
    capture.events.transcript("to bu", false);
    assert.equal(input.value, "I want to bu");
    capture.events.transcript("to build a board", false);
    assert.equal(input.value, "I want to build a board");
    capture.events.transcript("to build a board.", true);
    capture.events.transcript("Unfinished", false);
    await h.api.elements.usageForm.emit("submit");
    assert.equal(h.requests.length, 0, "recording never submits and Send is fenced until Stop");
    assert.match(h.control(input, ".speech-status").textContent, /Stop speech/);
    await h.control(input).emit("click");
    await h.flush();
    assert.equal(input.value, "I want to build a board.");
    assert.equal(input.readOnly, false);
    assert.equal(capture.closed, true);
    assert.equal(capture.stopped, true);
    h.setFetch(async () => response({ ...state(), revision: 2 }));
    await h.api.elements.usageForm.emit("submit");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.answer, "I want to build a board.");
});

test("Cancel and failure preserve existing text and fence stale callbacks", async () => {
    const h = await fixture();
    const input = h.api.elements.usageInput;
    input.value = "  Keep my draft  ";
    const first = await h.start(input);
    first.events.transcript("discard me", true);
    await h.control(input, ".speech-cancel").emit("click");
    assert.equal(input.value, "  Keep my draft  ");
    assert.equal(first.signal.aborted, true);
    const second = await h.start(input);
    first.events.transcript("stale", true);
    first.events.error("stale error");
    assert.equal(input.value, "  Keep my draft  ");
    second.events.transcript("also discard", false);
    second.events.error("Microphone disconnected. Retry.");
    assert.equal(input.value, "  Keep my draft  ");
    assert.match(h.control(input, ".speech-status").textContent, /Microphone disconnected/);
    assert.equal(second.closed, true);
    assert.equal(input.readOnly, false);
});

test("recording stays bound across polling and dynamic question replacement", async () => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("q")];
    const h = await fixture(value);
    let input = h.api.elements.questionHost.querySelector("textarea");
    input.value = "My answer";
    await input.emit("input");
    const capture = await h.start(input);
    capture.events.transcript("with speech", true);
    h.api.setPending(true);
    h.api.setPending(false);
    h.api.renderIfChanged({ ...value, revision: 2, processing: { status: "success", message: "Updated" } });
    input = h.api.elements.questionHost.querySelector("textarea");
    assert.equal(input.value, "My answer with speech");
    assert.equal(input.readOnly, true);
    assert.equal(capture.closed, false);
    capture.events.transcript("and more", true);
    assert.equal(input.value, "My answer with speech and more");
    await h.control(input, ".speech-cancel").emit("click");
    assert.equal(input.value, "My answer");
    h.api.renderIfChanged({ ...value, revision: 3 });
    assert.equal(h.api.elements.questionHost.querySelector("textarea").value, "My answer");
});

test("changing questions or resetting the effort cannot leak a transcript into another draft", async () => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("q"), decision("other", "answered")];
    const h = await fixture(value);
    const input = h.api.elements.questionHost.querySelector("textarea");
    input.value = "Original";
    await input.emit("input");
    const capture = await h.start(input);
    capture.events.transcript("private draft", false);
    h.api.selectDecision("other");
    h.api.render({ ...value, revision: 2 });
    const other = h.api.elements.questionHost.querySelector("textarea");
    assert.equal(other.value, "");
    assert.equal(capture.closed, true);
    capture.events.transcript("late", true);
    assert.equal(other.value, "");
    h.api.render({ ...state("prepare", 3), goal: "", generation: "new" });
    assert.equal(h.api.elements.startGoal.value, "");
});

test("decision navigation immediately attaches speech controls and preserves the previous choice on Cancel", async () => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("q"), decision("other", "answered")];
    const h = await fixture(value);
    const form = h.api.elements.questionHost.querySelector("form");
    const input = form.querySelector("textarea");
    const radios = form.querySelectorAll('input[type="radio"]');
    radios[0].checked = false;
    radios[1].checked = true;
    await radios[1].emit("change");
    const capture = await h.start(input);
    capture.events.transcript("custom answer", false);
    assert.equal(radios[1].checked, false);
    await h.control(input, ".speech-cancel").emit("click");
    assert.equal(radios[1].checked, true);
    assert.equal(input.value, "");
    await h.api.elements.decisionList.querySelector('[data-decision-id="other"]').emit("click");
    assert.equal(h.api.elements.questionHost.querySelectorAll(".speech-toggle").length, 1);
});

test("switching artifacts restores the old draft before binding the new artifact", async () => {
    const value = state("design");
    value.artifacts = ["first", "second"].map((id) => ({
        id, title: id, stage: "design", kind: "contract", content: id, reviewStatus: "current",
    }));
    const h = await fixture(value);
    const buttons = h.api.elements.artifactList.querySelectorAll("button");
    await buttons[0].emit("click");
    const input = h.api.elements.designReviewInput;
    input.value = "Original review";
    await input.emit("input");
    const capture = await h.start(input);
    capture.events.transcript("must not transfer", false);
    await buttons[1].emit("click");
    assert.equal(capture.closed, true);
    assert.equal(input.value, "");
    capture.events.transcript("late callback", true);
    await buttons[0].emit("click");
    assert.equal(input.value, "Original review");
});

test("overlong speech fails visibly instead of truncating or submitting", async () => {
    const h = await fixture();
    const input = h.api.elements.usageInput;
    input.value = "Original";
    const capture = await h.start(input);
    capture.events.transcript("x".repeat(501), true);
    assert.equal(input.value, "Original");
    assert.match(h.control(input, ".speech-status").textContent, /500 character limit/);
    assert.equal(capture.closed, true);
});

test("cancelling startup closes a late recognizer and never starts it", async () => {
    const h = await fixture();
    let resolve!: (session: SpeechSession) => void;
    let started = false;
    let closed = false;
    h.setSpeechFactory(() => new Promise((done) => { resolve = done; }));
    const input = h.api.elements.usageInput;
    await h.control(input).emit("click");
    await h.control(input, ".speech-cancel").emit("click");
    resolve({ start: async () => { started = true; }, stop: async () => {}, close: () => { closed = true; } });
    await h.flush();
    assert.equal(started, false);
    assert.equal(closed, true);
    assert.equal(input.readOnly, false);
});

test("read-only stages cannot record and hiding the active tab releases the microphone", async () => {
    const h = await fixture();
    const capture = await h.start(h.api.elements.usageInput);
    h.api.browseStage("prepare");
    assert.equal(capture.closed, true);
    assert.equal(h.control(h.api.elements.usageInput).disabled, true);
    h.api.render({ ...state(), revision: 2, provider: { canSubmitAnswers: false } });
    await h.control(h.api.elements.usageInput).emit("click");
    assert.equal(h.sessions.length, 1);
});

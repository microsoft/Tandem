import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, state, decision, response, text, field, disabled, hidden, submit, browse, type Harness } from "./renderer-fixtures.test.js";
import { requirementsResearchInput } from "../src/requirements-research.js";

function dag(...nodes: ReturnType<typeof decision>[]) {
    const value = state(); value.requirements.substage = "dag"; value.decisionGraph.nodes = nodes;
    return value;
}
const host = (h: Harness) => h.get("question-host");
const detail = (h: Harness) => host(h).querySelector<HTMLTextAreaElement>("textarea")!;
const radios = (h: Harness) => host(h).querySelectorAll<HTMLButtonElement>('[role="radio"]');
const defaults = (h: Harness) => host(h).querySelector<HTMLButtonElement>(".all-recommended")!;
const send = (h: Harness) => h.fire(host(h).querySelector("form")!, "submit");
function batch() {
    const value = dag(decision("first"), { ...decision("second", "toAnswer"), dependencies: ["first"] });
    for (const node of value.decisionGraph.nodes) node.question.choices.push("C");
    return value;
}

test("requirements remain answerable and selectable without Mermaid", async (t) => {
    const h = await setup(t, dag(decision("active"), decision("previous", "answered"),
        { ...decision("future", "toAnswer"), dependencies: ["active"] }));
    assert.ok(detail(h));
    assert.doesNotMatch(text(h, "design-tree-card"), /You are here/);
    assert.match(text(h, "design-tree-current"), /Active/);
    assert.ok(h.get("design-tree-current").classList.contains("eyebrow"));
    assert.ok(h.get("design-tree-current").querySelector('svg[aria-hidden="true"]'));
    assert.equal(h.document.querySelector(".design-tree-host .diagram-header .design-tree-legend")?.textContent, "AnsweredActiveTo answerExplicit answer");
    assert.equal(h.document.querySelectorAll(".design-tree-host .diagram-toolbar button").length, 1);
    assert.equal(h.get("design-tree-host-source-trigger").textContent, "Mermaid source");
    const buttons = h.get("decision-list").querySelectorAll<HTMLButtonElement>("button");
    assert.equal(buttons.length, 3);
    await h.click(buttons[2]);
    assert.equal(host(h).querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
    assert.match(host(h).textContent!, /Waiting for this decision|Blocked until/);
    await h.click(buttons[1]);
    assert.match(host(h).textContent!, /Previous answer/);
    assert.equal(hidden(h, "decision-list"), false);
});

test("Requirements keeps Mermaid source in a popup without replacing the diagram or decision drafts", async t => {
    const h = await setup(t, dag(decision("active"), decision("previous", "answered")));
    const diagram = h.document.querySelector(".design-tree-host .diagram-scroll-area")!;
    const list = h.document.querySelector(".decision-list-pane")!;
    const question = h.document.querySelector<HTMLElement>(".design-tree-inspector")!;
    const sourceButton = h.get("design-tree-host-source-trigger");
    assert.equal(h.document.querySelector(".diagram-source-dialog"), null);
    await h.click(sourceButton);
    const source = h.get("design-tree-host-source-dialog");
    assert.ok(diagram.contains(h.get("design-tree-host")));
    assert.equal(diagram.contains(source), false);
    assert.equal(diagram.contains(list), false);
    assert.ok(list.contains(h.get("decision-list")));
    assert.ok(question.contains(host(h)));
    assert.equal(question.tabIndex, 0);
    assert.equal(source.getAttribute("role"), "dialog");
    assert.equal(source.getAttribute("aria-modal"), "true");
    assert.match(text(h, "design-tree-host-source-label"), /Mermaid source/);
    const code = source.querySelector("pre")!;
    assert.equal(code.tabIndex, 0);
    assert.equal(code.getAttribute("role"), "region");
    assert.equal(code.getAttribute("aria-labelledby"), source.querySelector("h2")!.id);
    const before = code;
    await h.click(source.querySelector('[aria-label="Close Mermaid source"]')!);
    assert.equal(h.document.activeElement, sourceButton);
    await h.input(detail(h), "Keep the selected answer draft.");
    await h.fire(h.get("usage-substage"), "mousedown", { button: 0 });
    await h.fire(h.get("dag-substage"), "mousedown", { button: 0 });
    await h.click(sourceButton);
    assert.equal(h.get("design-tree-host-source-dialog").querySelector("pre")!.textContent, before.textContent);
    await h.fire(h.get("design-tree-host-source-dialog"), "keydown", { key: "Escape" });
    assert.equal(h.document.querySelector(".diagram-source-dialog"), null);
    assert.equal(h.document.activeElement, sourceButton);
    assert.equal(detail(h).value, "Keep the selected answer draft.");
    assert.deepEqual(h.requests, []);
});

test("rejected DAGs retain usages, stop generating, and expose explicit retry", async (t) => {
    const value = state(); value.requirements.usageItems = ["I want to explore a model."];
    value.processing = { action: "generate-dag", requestId: "dag-request", status: "running" };
    const h = await setup(t, value);
    assert.equal(text(h, "generate-dag"), "Generating DAG...");
    assert.equal(h.get("dag-substage").querySelector(".substage-status")!.getAttribute("aria-label"), "Generating requirements DAG");
    assert.equal(disabled(h, "generate-dag"), true);
    const failed = { ...value, revision: 2, processing: { ...value.processing, status: "error",
        message: "New requirements must be answered by the user, not by the worker." } };
    h.render(failed);
    assert.equal(text(h, "generate-dag"), "Retry requirements DAG");
    assert.equal(disabled(h, "generate-dag"), false);
    assert.equal(hidden(h, "usage-intake"), false);
    assert.equal(h.get("dag-substage").dataset.status, "locked");
    assert.equal(h.get("dag-substage").querySelector(".substage-status")!.getAttribute("aria-label"), "Generation failed - retry available");
    assert.equal(hidden(h, "design-tree-card"), true);
    assert.match(text(h, "usage-items"), /explore a model/);
    assert.match(text(h, "usage-message"), /answered by the user/);
    assert.equal(h.get("usage-message").dataset.status, "error");
    assert.match(text(h, "next-action-guide"), /Retry.*requirements DAG/);
    h.render({ ...failed, revision: 3 });
    assert.match(text(h, "usage-message"), /Your usages are saved/);
    h.setFetch(async () => response({ ...value, revision: 4 }));
    await h.click("generate-dag");
    assert.equal(h.requests[0].path, "/api/answer");
    assert.equal(h.requests[0].body.action, "generate-dag");
    assert.equal(text(h, "generate-dag"), "Generating DAG...");
});

test("Requirements shows research progress and retained sources without adding a stage or accepting decisions", async (t) => {
    const value = state();
    value.requirements.usageItems = ["I want to recover from a declined payment."];
    value.status = "Researching missing facts for your accepted usages...";
    value.processing = { action: "generate-dag", requestId: "research-request", status: "running" };
    const h = await setup(t, value);
    assert.match(text(h, "usage-message"), /Researching missing facts/);
    assert.equal(h.document.querySelectorAll(".requirements-substage").length, 2);
    assert.equal(h.document.getElementById("requirements-research"), null);
    const researched = { ...value, revision: 2, requirements: { ...value.requirements, research: {
        generation: value.generation, requestId: "research-request", runId: "research-run",
        input: requirementsResearchInput(value), completedAt: new Date().toISOString(),
        summary: "Declines may need another payment method.",
        checks: [{ label: "Live payment", status: "deferred" as const, detail: "Use mocks." }],
        sources: [{ title: "Declines reference", url: "https://docs.stripe.com/declines", purpose: "Recovery options" }],
    } }, processing: { ...value.processing, status: "error", message: "Question generation failed." } };
    h.render(researched);
    assert.equal(h.get<HTMLDetailsElement>("requirements-research").open, true);
    assert.match(text(h, "requirements-research"), /Declines may need another payment method/);
    assert.match(text(h, "requirements-research"), /Live payment.*deferred/);
    const link = h.get("requirements-research").querySelector("a")!;
    assert.equal(link.href, "https://docs.stripe.com/declines");
    assert.equal(link.rel, "noreferrer");
    assert.equal(text(h, "generate-dag"), "Retry requirements DAG");
    assert.match(text(h, "usage-message"), /Question generation failed/);
    assert.equal(hidden(h, "usage-intake"), false);
    h.render({ ...researched, revision: 3, requirements: { ...researched.requirements, usageItems: ["I want to save a payment method."] } });
    assert.match(text(h, "requirements-research"), /Earlier research and sources/);
    assert.match(text(h, "requirements-research"), /belong to earlier inputs/);
    assert.equal(h.requests.length, 0);
});

test("Requirements substage tabs retain usages, research and decision drafts without reopening saved work", async t => {
    const value = dag(decision("first"), decision("second", "toAnswer"));
    value.requirements.usageItems = ["Review saved work."];
    value.requirements.research = {
        generation: value.generation, requestId: "research", runId: "research",
        input: requirementsResearchInput(value), completedAt: value.updatedAt, summary: "Retained research.",
        checks: [], sources: [{ title: "Reference", url: "https://example.com/reference", purpose: "Background" }],
    };
    const h = await setup(t, value);
    assert.equal(text(h, "design-tree-phase"), "Requirements decisions");
    assert.equal(h.get("dag-substage").getAttribute("role"), "tab");
    assert.equal(h.get("dag-substage").getAttribute("aria-label"), "Decision DAG, Decisions to answer");
    assert.equal(h.get("usage-substage").getAttribute("aria-label"), "Usage list, Usage list complete");
    assert.ok(h.get("dag-substage").classList.contains("substage-tab"));
    assert.equal(h.get("dag-substage").querySelector(".substage-index")!.textContent, "2");
    assert.equal(h.get("dag-substage").getAttribute("aria-selected"), "true");
    assert.equal(h.get("requirements-dag-panel").getAttribute("aria-labelledby"), "dag-substage");
    await h.input(detail(h), "Keep this answer draft.");
    const question = host(h), input = detail(h), graph = h.get("design-tree-host");
    await h.fire(h.get("usage-substage"), "mousedown", { button: 0 });
    assert.equal(h.get("requirements-usage-panel").hidden, false);
    assert.equal(h.get("requirements-dag-panel").hidden, true);
    assert.ok(h.get("requirements-usage-panel").contains(h.get("requirements-substage-section")));
    assert.ok(h.get("requirements-usage-panel").contains(h.get("requirements-research")));
    assert.match(h.get("requirements-usage-panel").textContent!, /Review saved work.*Retained research/s);
    assert.equal(h.get<HTMLDetailsElement>("requirements-research").open, true);
    h.get<HTMLDetailsElement>("requirements-research").open = false;
    h.render({ ...value, revision: 2, status: "Unrelated update" }); await h.flush();
    assert.equal(h.get("usage-substage").getAttribute("aria-selected"), "true");
    await h.fire(h.get("usage-substage"), "keydown", { key: "ArrowRight" });
    assert.equal(h.get("dag-substage").getAttribute("aria-selected"), "true");
    assert.equal(host(h), question);
    assert.equal(detail(h), input);
    assert.equal(detail(h).value, "Keep this answer draft.");
    assert.equal(h.get("design-tree-host"), graph);
    assert.equal(h.get<HTMLDetailsElement>("requirements-research").open, false, "An explicit collapse is preserved across updates and tabs.");
    const later = { ...value, revision: 3, lifecycle: { ...value.lifecycle,
        currentStage: "prototype", completedStages: ["prepare", "requirements", "sketch"] } };
    h.render(later); await browse(h, "requirements");
    assert.equal(h.document.getElementById("design-tree-phase"), null, "Completed Requirements does not show a redundant saved badge.");
    await h.fire(h.get("usage-substage"), "mousedown", { button: 0 });
    assert.equal(h.get("usage-substage").getAttribute("aria-selected"), "true");
    await h.fire(h.get("dag-substage"), "mousedown", { button: 0 });
    assert.equal(disabled(h, "decision-submit"), true);
    assert.deepEqual(h.requests, []);
    assert.equal(h.store.getSnapshot().state!.lifecycle.currentStage, "prototype");
});

test("Requirements disables the empty DAG tab and switches to its result only after generation settles", async t => {
    const value = state(), h = await setup(t, value);
    assert.equal(disabled(h, "dag-substage"), true);
    assert.equal(h.get("usage-substage").getAttribute("aria-selected"), "true");
    const lockedStatus = h.get("dag-substage").querySelector(".substage-status")!;
    assert.equal(lockedStatus.getAttribute("role"), "img");
    assert.equal(lockedStatus.getAttribute("title"), lockedStatus.getAttribute("aria-label"));
    assert.equal(lockedStatus.getAttribute("data-status"), "locked");
    assert.ok(lockedStatus.querySelector('svg[aria-hidden="true"]'));
    assert.equal(text(h, "dag-substage"), "2Decision DAG");
    assert.equal(h.get("dag-substage").getAttribute("aria-label"), "Decision DAG, Complete the usage list to unlock the decision DAG");
    const ready = { ...dag(decision("first")), revision: 2 };
    h.render(ready); await h.flush();
    assert.equal(disabled(h, "dag-substage"), false);
    assert.equal(h.get("dag-substage").getAttribute("aria-selected"), "true");
    await h.fire(h.get("usage-substage"), "mousedown", { button: 0 });
    h.render({ ...ready, revision: 3 }); await h.flush();
    assert.equal(h.get("usage-substage").getAttribute("aria-selected"), "true");
    assert.deepEqual(h.requests, []);
});

test("accepted DAG opens Requirements and focuses exactly once without Mermaid", async (t) => {
    const value = state(); value.requirements.usageItems = ["Explore a model."];
    value.processing = { action: "generate-dag", status: "running", requestId: "dag-request" };
    const h = await setup(t, value); h.setNarrowViewport(true);
    await browse(h, "prepare"); await h.click("context-toggle");
    const ready = { ...value, revision: 2, requirements: { ...value.requirements, substage: "dag" },
        processing: { ...value.processing, status: "success" }, decisionGraph: { nodes: [decision("first"), decision("next", "toAnswer")] } };
    h.render(ready); await h.flush();
    assert.equal(hidden(h, "design-tree-panel"), false);
    assert.equal(hidden(h, "preparation-panel"), true);
    assert.equal(hidden(h, "usage-intake"), true);
    assert.equal(h.get("usage-substage").dataset.status, "complete");
    assert.equal(h.get("dag-substage").dataset.status, "active");
    assert.equal(hidden(h, "design-tree-card"), false);
    assert.equal(h.get("context-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(h.document.activeElement, host(h).querySelector('[role="radio"][aria-checked="true"]'));
    await h.input(detail(h), "My own decision"); detail(h).focus(); detail(h).setSelectionRange(2, 5);
    h.render({ ...ready, revision: 3 }); await h.flush();
    assert.equal(h.document.activeElement, detail(h));
    assert.equal(detail(h).selectionStart, 2);
    await browse(h, "prepare"); h.render({ ...ready, revision: 4 }); await h.flush();
    assert.equal(hidden(h, "preparation-panel"), false);
    assert.equal(h.requests.length, 0);
});

test("DAG focus waits for a real pending submission and does not leak old effort drafts", async (t) => {
    const value = state(), h = await setup(t, value);
    await h.input("usage-input", "A usage");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await submit(h, "usage-form");
    const ready = { ...dag(decision("first")), revision: 2 };
    h.render(ready); await h.flush();
    assert.equal(disabled(h, "add-usage"), true);
    release(response(ready)); await h.flush();
    assert.ok(h.document.activeElement === host(h).querySelector('[role="radio"][aria-checked="true"]'), "Focus moves to the active decision after the pending request settles");
    await h.input(detail(h), "Old effort answer");
    h.render({ ...ready, revision: 3, generation: "another-effort" }); await h.flush();
    assert.equal(detail(h).value, "");
    assert.equal(h.requests.length, 1, "focus never submits a recommendation");
});

test("unrelated SSE retains decision text, selected Radix choice, focus and caret", async (t) => {
    const value = dag(decision("q")), h = await setup(t, value);
    await h.input(detail(h), "My unsent answer");
    detail(h).focus(); detail(h).setSelectionRange(3, 7);
    const before = detail(h);
    h.render({ ...value, revision: 2, status: "Unrelated artifact update" });
    assert.equal(detail(h), before);
    assert.equal(detail(h).value, "My unsent answer");
    assert.equal(h.document.activeElement, before);
    assert.equal(detail(h).selectionStart, 3); assert.equal(detail(h).selectionEnd, 7);
    assert.equal(host(h).querySelector('[role="radio"][aria-checked="true"]'), null);
    await h.click(radios(h)[1]);
    h.render({ ...value, revision: 3 });
    assert.equal(radios(h)[1].getAttribute("aria-checked"), "true");
    assert.equal(radios(h)[1].getAttribute("data-state"), "checked");
});

test("whole-graph defaults freeze all choices in one confirmed request without chaining", async (t) => {
    const value = batch(), h = await setup(t, value);
    assert.match(defaults(h).textContent!, /whole-graph defaults/);
    assert.match(defaults(h).title, /ALL unanswered decisions/);
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.click(defaults(h));
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /first: A\s+second: A/);
    await h.confirm(); await h.click(defaults(h));
    h.render({ ...value, revision: 2, status: "Unrelated notification" });
    assert.equal(defaults(h).disabled, true);
    assert.equal(h.requests.length, 1);
    release(response({ ...value, revision: 3, processing: { status: "running", action: "apply-defaults",
        question: { id: "whole-graph-defaults" } } })); await h.flush();
    h.render({ ...value, revision: 4, decisionGraph: { nodes: [decision("first", "answered"), decision("second")] } });
    await h.flush();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].body, { action: "apply-defaults", expectedRevision: 1, generation: "fixture-generation",
        defaults: [{ nodeId: "first", answer: "A" }, { nodeId: "second", answer: "A" }] });
});

test("whole-graph defaults skip non-curated downstream questions and still require confirmation", async (t) => {
    const value = batch(); value.decisionGraph.nodes[1].question.choices.pop();
    const h = await setup(t, value);
    await h.click(defaults(h));
    assert.equal(h.requests.length, 0);
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /ALL 1 unanswered/);
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /explicit answer.*second/s);
    assert.match(h.document.querySelector('[data-decision-id="second"]')!.textContent!, /Explicit answer/);
    await h.confirm(false);
    h.render({ ...batch(), revision: 2 });
    await h.click(defaults(h));
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /ALL 2 unanswered/);
    await h.confirm(false);
    assert.equal(h.requests.length, 0);
    assert.equal(defaults(h).disabled, false);
});

test("a single default answer does not consent to whole-graph defaults", async (t) => {
    const value = dag(decision("first"), decision("second", "toAnswer")), h = await setup(t, value);
    h.setFetch(async () => response({ ...value, revision: 2, processing: { status: "running", action: "answer-decision" } }));
    await send(h);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.action, "answer-decision");
    assert.equal(h.requests[0].body.questionId, "first");
    assert.equal(h.requests[0].body.defaults, undefined);
});

test("failed whole-graph defaults retry saved identity and show unresolved review evidence", async (t) => {
    const value = dag(decision("first"), decision("second", "toAnswer"));
    value.processing = { status: "error", action: "apply-defaults", requestId: "saved-batch", message: "Semantic worker failed" };
    const h = await setup(t, value);
    assert.match(host(h).textContent!, /Semantic worker failed/);
    assert.equal(defaults(h).textContent, "Retry whole-graph defaults");
    h.setFetch(async () => response({ ...value, revision: 2, processing: { status: "running", action: "apply-defaults" } }));
    await h.click(defaults(h));
    assert.equal(h.requests[0].body.retryRequestId, "saved-batch");
    assert.equal(h.requests[0].body.defaults, undefined);
    h.render({ ...value, revision: 3, processing: { status: "success", action: "apply-defaults" },
        decisionGraph: { nodes: [{ ...decision("first"), review: { reason: "Incompatible choices", previousAnswer: "Old recommendation" } }, decision("second", "toAnswer")] } });
    assert.match(host(h).textContent!, /Review required: Incompatible choices/);
    assert.match(host(h).textContent!, /Previously selected: Old recommendation/);
    assert.equal(h.requests.length, 1);
});

test("replacing a failed batch confirms the current whole-graph choices", async (t) => {
    const value = batch(); value.processing = { action: "apply-defaults", status: "error", requestId: "old", message: "Inputs changed" };
    const h = await setup(t, value);
    const replace = () => host(h).querySelector(".review-current-defaults")!;
    await h.click(replace()); await h.confirm(false); assert.equal(h.requests.length, 0);
    h.setFetch(async () => response({ ...value, revision: 2, processing: { status: "running", action: "apply-defaults" } }));
    await h.click(replace()); await h.confirm();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.retryRequestId, undefined);
    assert.equal(h.requests[0].body.defaults.length, 2);
});

test("terminal review-only updates refresh unchanged questions even when running updates were missed", async (t) => {
    const value = batch(); value.processing = { status: "success", action: "apply-defaults" };
    const h = await setup(t, value);
    assert.doesNotMatch(host(h).textContent!, /Review required:/);
    for (const [index, review] of [
        { reason: "Incompatible choices", previousAnswer: "Old recommendation" },
        { reason: "Changed constraint", previousAnswer: "Another selection" }, null,
    ].entries()) {
        h.render({ ...value, revision: index + 2, decisionGraph: { nodes: [
            { ...value.decisionGraph.nodes[0], review }, value.decisionGraph.nodes[1],
        ] } });
        const content = host(h).textContent!;
        if (review) {
            assert.ok(content.includes(`Review required: ${review.reason}`));
            assert.ok(content.includes(`Previously selected: ${review.previousAnswer}`));
        } else assert.doesNotMatch(content, /Review required:|Previously selected:/);
        if (index > 0) assert.doesNotMatch(content, /Old recommendation/);
    }
    assert.equal(h.requests.length, 0);
});

test("failed usage submissions retain their inputs and errors through SSE", async (t) => {
    const value = state(), h = await setup(t, value);
    await h.input("usage-input", "Use the app offline");
    h.setFetch(async () => response({ error: "Rejected" }, 503));
    await submit(h, "usage-form"); h.render({ ...value, revision: 2 });
    assert.equal(field(h, "usage-input").value, "Use the app offline");
    assert.match(text(h, "usage-message"), /Rejected/);
});

test("successful usage submission clears only the accepted draft, never replacement text", async (t) => {
    const value = state(), h = await setup(t, value);
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.input("usage-input", "First usage"); await submit(h, "usage-form");
    await h.input("usage-input", "Replacement usage");
    release(response({ ...value, revision: 2, requirements: { ...value.requirements, usageItems: ["First usage"] } })); await h.flush();
    assert.equal(field(h, "usage-input").value, "Replacement usage");
    h.setFetch(async () => response({ ...value, revision: 3 }));
    await submit(h, "usage-form");
    assert.equal(field(h, "usage-input").value, "");
});

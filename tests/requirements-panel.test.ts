import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { decisionIsReady, type DecisionNode } from "../src/workflow.js";
import type { UiContextValue, UiState } from "../src/renderer/ui-context.js";
import { requirementDraftKey, requirementNodes, selectedRequirement, wholeGraphDefaults } from "../src/renderer/requirements-model.js";
import { buildDecisionGraphMermaid } from "../src/decision-diagram.js";

function decision(id: string, status: DecisionNode["status"] = "active"): DecisionNode {
    return {
        id, title: id, status, dependencies: [], answer: status === "answered" ? "A" : null,
        question: {
            id, text: `Choose ${id}`, rationale: "Choose deliberately.", choices: ["A", "B", "C"],
            recommended: "A", allowFreeText: true, answerPlaceholder: "",
        },
    };
}

function snapshot(nodes: DecisionNode[] = []): UiState {
    return {
        prototypeId: "requirements-test", generation: "generation-1", revision: 1,
        phase: "discovery", status: "",
        lifecycle: { currentStage: "requirements", completedStages: [], skippedStages: [], outputs: [], history: [] },
        requirements: { substage: nodes.length ? "dag" : "usage", usageItems: [], suggestions: [] },
        decisionGraph: { nodes }, question: null, processing: null, suggestionProcessing: null,
        provider: { canSubmitAnswers: true, extensionId: "user:tandem", source: "user" },
    } as UiState;
}

test("React Requirements freezes all unanswered recommendations without touching accepted answers", () => {
    const value = snapshot([decision("accepted", "answered"), decision("first"), {
        ...decision("later", "toAnswer"), dependencies: ["first"],
    }]);
    const plan = wholeGraphDefaults(value);
    assert.deepEqual(plan.body, {
        action: "apply-defaults", expectedRevision: 1, generation: "generation-1",
        defaults: [{ nodeId: "first", answer: "A" }, { nodeId: "later", answer: "A" }],
    });
    assert.match(plan.confirmation!, /ALL 2 unanswered/);
    value.decisionGraph.nodes[2].question!.recommended = "B";
    assert.equal(plan.body.defaults![1].answer, "A");
});

test("React Requirements retries only the saved default batch, while replacement needs fresh approval", () => {
    const value = snapshot([decision("first")]);
    value.processing = { status: "error", action: "apply-defaults", requestId: "saved-request" };
    assert.deepEqual(wholeGraphDefaults(value), {
        body: { action: "apply-defaults", expectedRevision: 1, generation: "generation-1", retryRequestId: "saved-request" },
        confirmation: null,
    });
    const replacement = wholeGraphDefaults(value, true);
    assert.equal(replacement.body.retryRequestId, undefined);
    assert.match(replacement.confirmation!, /first: A/);
    value.processing.requestId = "";
    assert.throws(() => wholeGraphDefaults(value), /no saved request ID/);
});

test("React Requirements skips non-curated and missing recommendations while freezing downstream defaults", () => {
    const value = snapshot([decision("first"), decision("blocked", "toAnswer")]);
    value.decisionGraph.nodes[1].question!.choices = ["A", "B"];
    const plan = wholeGraphDefaults(value);
    assert.deepEqual(plan.body.defaults, [{ nodeId: "first", answer: "A" }]);
    assert.match(plan.confirmation!, /1 question needs an explicit answer.*\nblocked/);
    assert.doesNotMatch(plan.confirmation!, /blocked: A/);
    value.decisionGraph.nodes[1].question = null;
    assert.deepEqual(wholeGraphDefaults(value).body.defaults, plan.body.defaults);
    value.decisionGraph.nodes[0].question!.recommended = null;
    assert.throws(() => wholeGraphDefaults(value), /No recommended answers are available/);
    assert.throws(() => wholeGraphDefaults(snapshot([decision("done", "answered")])), /No unanswered decisions/);
});

test("the DAG marks every unanswered non-default decision without losing status, edges or aliases", () => {
    const nodes = [decision("default"), decision("explicit"), decision("blocked", "toAnswer"), decision("done", "answered")];
    for (const node of nodes.slice(1)) node.question!.recommended = null;
    nodes[2].dependencies = ["explicit"];
    const graph = buildDecisionGraphMermaid(nodes);
    assert.match(graph.source, /Decision1\["explicit \(Explicit answer\)"\]/);
    assert.match(graph.source, /Decision2\["blocked \(Explicit answer\)"\]/);
    assert.doesNotMatch(graph.source, /(?:default|done) \(Explicit answer\)/);
    assert.match(graph.source, /class Decision1,Decision2 explicitAnswer/);
    assert.match(graph.source, /class Decision0,Decision1 active/);
    assert.match(graph.source, /class Decision2 toAnswer/);
    assert.match(graph.source, /Decision1 --> Decision2/);
    assert.equal(graph.aliases.get("Decision2"), nodes[2]);
});

test("React Requirements draft identity includes effort, question definition and accepted answer", () => {
    const value = snapshot([decision("q")]);
    const node = value.decisionGraph.nodes[0];
    const before = requirementDraftKey(value, node);
    const laterRevision = { ...value, revision: 9 };
    assert.equal(requirementDraftKey(laterRevision, node), before);
    assert.notEqual(requirementDraftKey(value, { ...node, question: { ...node.question!, recommended: "B" } }), before);
    assert.notEqual(requirementDraftKey(value, { ...node, answer: "A" }), before);
    assert.notEqual(requirementDraftKey({ ...value, generation: "new" }, node), before);
});

test("React Requirements follows unresolved decisions without overriding explicit read-only or active selection", () => {
    const nodes = [decision("first"), decision("second"), decision("blocked", "toAnswer"), decision("done", "answered")];
    assert.equal(selectedRequirement(nodes, "second", true)?.id, "second");
    assert.equal(selectedRequirement(nodes, "blocked", false)?.id, "blocked");
    assert.equal(selectedRequirement(nodes, "done", true)?.id, "first");
    assert.equal(selectedRequirement(nodes, "done", false)?.id, "done");
    assert.equal(selectedRequirement([decision("done", "answered"), decision("blocked", "toAnswer")], "done", true)?.id, "blocked");
    const value = snapshot();
    value.question = nodes[0].question;
    assert.deepEqual(requirementNodes(value), []);
    value.requirements.substage = "dag";
    assert.equal(requirementNodes(value)[0].id, "first");
});

test("answer readiness follows saved prerequisites, not the single active marker", () => {
    const first = decision("first");
    const explicit = { ...decision("explicit", "toAnswer"), question: { ...decision("explicit").question!, recommended: null } };
    const accepted = decision("accepted", "answered");
    const nodes = [first, explicit, accepted];
    assert.equal(decisionIsReady(explicit, nodes), true);
    assert.equal(decisionIsReady({ ...explicit, dependencies: ["accepted"] }, nodes), true);
    assert.equal(decisionIsReady({ ...explicit, dependencies: ["first"] }, nodes), false);
    assert.equal(decisionIsReady({ ...explicit, dependencies: ["missing"] }, nodes), false);
    assert.equal(decisionIsReady({ ...explicit, question: null }, nodes), false);
    assert.equal(decisionIsReady(accepted, nodes), false);
});

async function harness(initial: UiState) {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
        url: "http://localhost", pretendToBeVisual: true,
    });
    const values: Record<string, unknown> = {
        window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
        HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
        HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
        HTMLFormElement: dom.window.HTMLFormElement, HTMLButtonElement: dom.window.HTMLButtonElement,
        MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
        Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
        cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = new Map(Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { RequirementsPanel } = await import("../src/renderer/requirements-panel.js");
    const { DraftProvider, UiContext } = await import("../src/renderer/ui-context.js");
    const root = createRoot(dom.window.document.getElementById("root")!);
    const requests: { path: string; body: any }[] = [];
    const confirmations: string[] = [];
    const navigations: string[] = [];
    let value = initial;
    let post: (path: string, body: unknown) => Promise<unknown> = async () => ({});
    let confirm: () => Promise<boolean> = async () => true;
    const context = (): UiContextValue => ({
        state: value, pending: false,
        post: async <T>(path: string, body: unknown) => {
            requests.push({ path, body: structuredClone(body) });
            return await post(path, body) as T;
        },
        refresh: async () => {}, canEdit: () => true, guidance: () => "Use the installed Tandem provider.",
        confirm: async (message) => { confirmations.push(message); return confirm(); },
        browseStage: (stage) => { navigations.push(stage); },
        selectArtifact: () => {}, setBusy: () => {},
    });
    const render = async (next = value) => {
        value = next;
        await act(async () => {
            root.render(createElement(UiContext.Provider, { value: context() },
                createElement(DraftProvider, { key: `${value.prototypeId}:${value.generation}` },
                    createElement(RequirementsPanel))));
        });
    };
    const find = <T extends Element = HTMLElement>(selector: string): T => {
        const result = dom.window.document.querySelector<T>(selector);
        assert.ok(result, `Missing ${selector}`);
        return result;
    };
    const click = async (selector: string) => {
        await act(async () => find(selector).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    };
    const submit = async (selector: string) => {
        await act(async () => find(selector).dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    };
    const input = async (selector: string, text: string) => {
        await act(async () => {
            const element = find<HTMLTextAreaElement>(selector);
            Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(element, text);
            element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
    };
    await render();
    return {
        requests, confirmations, navigations, find, click, submit, input, render, act,
        document: dom.window.document,
        setPost(next: typeof post) { post = next; },
        setConfirm(next: typeof confirm) { confirm = next; },
        async close() {
            await act(async () => root.unmount());
            dom.window.close();
            for (const [name, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        },
    };
}

test("React Requirements retains usage drafts after errors and only clears the accepted version", async () => {
    const value = snapshot();
    const h = await harness(value);
    try {
        h.setPost(async () => { throw new Error("Try again"); });
        await h.input("#usage-input", "Use offline");
        await h.submit("#usage-form");
        assert.equal(h.find<HTMLTextAreaElement>("#usage-input").value, "Use offline");
        assert.match(h.find("#usage-message").textContent!, /Try again/);
        let finish!: (value: unknown) => void;
        h.setPost(() => new Promise((resolve) => { finish = resolve; }));
        await h.submit("#usage-form");
        await h.input("#usage-input", "Replacement draft");
        await h.act(async () => finish({}));
        assert.equal(h.find<HTMLTextAreaElement>("#usage-input").value, "Replacement draft");
        assert.deepEqual(h.requests[1].body, { questionId: "usage-intake", answer: "Use offline", action: "add-usage" });
    } finally { await h.close(); }
});

test("React Requirements keeps per-question drafts, errors, focus and caret through unrelated snapshots", async () => {
    const value = snapshot([decision("first"), decision("second")]);
    const h = await harness(value);
    try {
        await h.input('textarea[name="prototype-detail"]', "My custom answer");
        const field = h.find<HTMLTextAreaElement>('textarea[name="prototype-detail"]');
        await h.act(async () => {
            field.focus();
            field.setSelectionRange(3, 7);
        });
        await h.render({ ...value, revision: 2 });
        assert.equal(h.document.activeElement, field);
        assert.equal(field.selectionStart, 3);
        assert.equal(field.selectionEnd, 7);
        assert.equal(h.document.querySelector('[role="radio"][data-state="checked"]'), null);
        h.setPost(async () => { throw new Error("Question-specific failure"); });
        await h.submit("#question-host form");
        await h.click('[data-decision-id="second"]');
        assert.equal(h.find<HTMLTextAreaElement>('textarea[name="prototype-detail"]').value, "");
        assert.doesNotMatch(h.find("#question-host").textContent!, /Question-specific failure/);
        await h.click('[data-decision-id="first"]');
        assert.equal(h.find<HTMLTextAreaElement>('textarea[name="prototype-detail"]').value, "My custom answer");
        assert.match(h.find("#question-host").textContent!, /Question-specific failure/);
        await h.render({ ...value, revision: 3, decisionGraph: { nodes: [
            { ...value.decisionGraph.nodes[0], question: { ...value.decisionGraph.nodes[0].question!, text: "A revised question" } },
            value.decisionGraph.nodes[1],
        ] } });
        assert.equal(h.find<HTMLTextAreaElement>('textarea[name="prototype-detail"]').value, "");
        assert.doesNotMatch(h.find("#question-host").textContent!, /Question-specific failure/);
    } finally { await h.close(); }
});

test("React Requirements blocked decisions remain inspectable and previous stages cannot mutate", async () => {
    const value = snapshot([decision("first"), { ...decision("blocked", "toAnswer"), dependencies: ["first"] }]);
    const h = await harness(value);
    try {
        await h.click('[data-decision-id="blocked"]');
        assert.match(h.find("#question-host").textContent!, /Blocked until.*first/);
        assert.equal(h.find<HTMLButtonElement>(".send").disabled, true);
        await h.submit("#question-host form");
        assert.equal(h.requests.length, 0);
        await h.render({ ...value, lifecycle: { ...value.lifecycle, currentStage: "prototype" } });
        await h.click('[data-decision-id="first"]');
        assert.equal(h.find<HTMLButtonElement>(".send").disabled, true);
        assert.equal(h.find<HTMLButtonElement>(".all-recommended").disabled, true);
        await h.submit("#question-host form");
        assert.equal(h.requests.length, 0);
    } finally { await h.close(); }
});

test("React Requirements lets a selected explicit question answer when another question is active", async () => {
    const explicit = { ...decision("jurisdiction", "toAnswer"), dependencies: ["accepted"],
        question: { ...decision("jurisdiction").question!, recommended: null } };
    const value = snapshot([decision("first"), decision("accepted", "answered"), explicit]);
    const h = await harness(value);
    try {
        await h.click('[data-decision-id="jurisdiction"]');
        assert.match(h.find("#design-tree-current").textContent!, /Ready to answer · jurisdiction/);
        assert.equal(h.find<HTMLButtonElement>(".send").disabled, false);
        assert.equal(h.find<HTMLTextAreaElement>("#question-host textarea").disabled, false);
        assert.equal(h.document.querySelector('[role="radio"][data-state="checked"]'), null);
        assert.doesNotMatch(h.find("#question-host").textContent!, /Waiting for prerequisites|cannot answer it yet/);
        await h.input("#question-host textarea", "The shop operates in Washington, USA.");
        await h.submit("#question-host form");
        assert.deepEqual(h.requests[0].body, { questionId: "jurisdiction", answer: "The shop operates in Washington, USA.", action: "answer-decision" });
        assert.equal(h.requests.length, 1);
        await h.render({ ...value, revision: 2, decisionGraph: { nodes: [decision("first"), decision("accepted"), explicit] } });
        await h.click('[data-decision-id="jurisdiction"]');
        assert.equal(h.find<HTMLButtonElement>(".send").disabled, true);
        assert.match(h.find("#question-host").textContent!, /Blocked until.*accepted/);
        await h.submit("#question-host form");
        assert.equal(h.requests.length, 1, "a reopened prerequisite blocks submission");
    } finally { await h.close(); }
});

test("React Requirements treats domain IDs separately from Mermaid aliases and preserves change-answer payloads", async () => {
    const value = snapshot([decision("first"), decision("Decision0", "answered")]);
    const h = await harness(value);
    try {
        await h.click('[data-decision-id="Decision0"]');
        assert.match(h.find("#design-tree-current").textContent!, /Answered · Decision0/);
        await h.input('textarea[name="prototype-detail"]', "A revised answer");
        await h.submit("#question-host form");
        assert.deepEqual(h.requests[0].body, { questionId: "Decision0", answer: "A revised answer", action: "change-answer" });
        assert.match(h.find("#design-tree-current").textContent!, /Active · first/);
    } finally { await h.close(); }
});

test("React Requirements applies one frozen whole-graph request and never chains later recommendations", async () => {
    const value = snapshot([decision("first"), { ...decision("second", "toAnswer"), dependencies: ["first"] }]);
    const h = await harness(value);
    try {
        await h.click(".all-recommended");
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].body.action, "apply-defaults");
        assert.equal(h.requests[0].body.defaults.length, 2);
        assert.match(h.confirmations[0], /first: A\nsecond: A/);
        await h.render({ ...value, revision: 2, decisionGraph: { nodes: [decision("first", "answered"), decision("second")] } });
        assert.equal(h.requests.length, 1);
        assert.match(h.find("#design-tree-current").textContent!, /Active · second/);
    } finally { await h.close(); }
});

test("React Requirements marks explicit questions and focuses the next blocker after defaults settle", async () => {
    const explicit = { ...decision("explicit", "toAnswer"), dependencies: ["first"],
        question: { ...decision("explicit").question!, recommended: null } };
    const nextExplicit = { ...decision("next-explicit", "toAnswer"), dependencies: ["downstream"],
        question: { ...decision("next-explicit").question!, recommended: null } };
    const value = snapshot([decision("first"), explicit,
        { ...decision("downstream", "toAnswer"), dependencies: ["explicit"] }, nextExplicit]);
    const h = await harness(value);
    try {
        assert.equal(h.document.querySelectorAll('#decision-list [data-explicit-answer="true"]').length, 2);
        assert.match(h.find('[data-decision-id="explicit"]').textContent!, /Explicit answer/);
        assert.match(h.find('[aria-label="Decision status legend"]').textContent!, /Explicit answer/);
        await h.click('[data-decision-id="next-explicit"]');
        assert.match(h.find("#question-host").textContent!, /Whole-graph defaults will skip this question/);
        await h.click(".all-recommended");
        assert.deepEqual(h.requests[0].body.defaults, [{ nodeId: "first", answer: "A" }, { nodeId: "downstream", answer: "A" }]);
        assert.match(h.confirmations[0], /2 questions need an explicit answer/);
        assert.equal(h.requests.length, 1);
        await h.render({ ...value, revision: 2, processing: { action: "apply-defaults", status: "running" } });
        assert.equal(h.find<HTMLTextAreaElement>("#question-host textarea").disabled, true);
        await h.render({ ...value, revision: 3, processing: { action: "apply-defaults", status: "success" },
            decisionGraph: { nodes: [decision("first", "answered"), { ...explicit, status: "active" },
                { ...value.decisionGraph.nodes[2], answer: "A", status: "answered" }, nextExplicit] } });
        assert.match(h.find("#design-tree-current").textContent!, /Active · explicit/);
        assert.ok(h.document.activeElement === h.find("#question-host textarea"), "focus moves to the explicit answer field");
        assert.equal(h.find<HTMLButtonElement>(".all-recommended").disabled, true);
        assert.equal(h.document.querySelector('[role="radio"][data-state="checked"]'), null);
        assert.equal(h.requests.length, 1, "a missing default never triggers an automatic answer");
    } finally { await h.close(); }
});

test("React Requirements focuses the explicit question without selecting a choice when free text is disabled", async () => {
    const explicit = { ...decision("explicit", "toAnswer"), dependencies: ["first"],
        question: { ...decision("explicit").question!, recommended: null, allowFreeText: false } };
    const value = snapshot([decision("first"), explicit]);
    const h = await harness(value);
    try {
        await h.click(".all-recommended");
        await h.render({ ...value, revision: 3, processing: { action: "apply-defaults", status: "success" },
            decisionGraph: { nodes: [decision("first", "answered"), { ...explicit, status: "active" }] } });
        assert.equal(h.document.activeElement?.id, "decision-question-title");
        assert.equal(h.document.querySelector('[role="radio"][data-state="checked"]'), null);
        assert.equal(h.find('[data-decision-id="explicit"]').getAttribute("aria-pressed"), "true");
        assert.equal(h.requests.length, 1);
    } finally { await h.close(); }
});

test("React Requirements fences a confirmation across revision, provider and generation changes", async () => {
    const value = snapshot([decision("first")]);
    const h = await harness(value);
    try {
        let finish!: (accepted: boolean) => void;
        h.setConfirm(() => new Promise((resolve) => { finish = resolve; }));
        await h.click(".all-recommended");
        await h.render({ ...value, revision: 2 });
        await h.act(async () => finish(true));
        assert.equal(h.requests.length, 0);
        assert.match(h.find("#design-tree-status").textContent!, /changed while confirming/);

        await h.click(".all-recommended");
        await h.render({ ...value, revision: 2, provider: { ...value.provider, extensionId: "project:tandem" } });
        await h.render({ ...value, revision: 2 });
        await h.act(async () => finish(true));
        assert.equal(h.requests.length, 0, "an ownership round trip must invalidate old approval");

        await h.click(".all-recommended");
        await h.render({ ...value, generation: "generation-2" });
        await h.act(async () => finish(true));
        assert.equal(h.requests.length, 0);
        assert.doesNotMatch(h.find("#design-tree-status").textContent!, /changed while confirming/);
    } finally { await h.close(); }
});

test("React Requirements opens and focuses a generated DAG once, without submitting the selected default", async () => {
    const value = snapshot();
    const h = await harness(value);
    try {
        const ready = { ...value, revision: 2, requirements: { ...value.requirements, substage: "dag" as const },
            decisionGraph: { nodes: [decision("first")] } };
        await h.render(ready);
        assert.deepEqual(h.navigations, ["requirements"]);
        assert.equal(h.document.activeElement, h.find('[role="radio"][data-state="checked"]'));
        await h.input('textarea[name="prototype-detail"]', "Keep focus");
        const field = h.find<HTMLTextAreaElement>('textarea[name="prototype-detail"]');
        await h.act(async () => field.focus());
        await h.render({ ...ready, revision: 3 });
        assert.equal(h.document.activeElement, field);
        assert.deepEqual(h.navigations, ["requirements"]);
        assert.equal(h.requests.length, 0);
    } finally { await h.close(); }
});

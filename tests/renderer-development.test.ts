import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { reactHarness, state, response } from "./helpers/react-harness.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { projectDiscovery } from "../src/renderer/project-conversation.js";

function reviewFixture(value: ReturnType<typeof state>) {
    return { binding: "b".repeat(64), generation: value.generation, snapshotPath: value.lifecycle.outputs[0].path,
        snapshotHash: "c".repeat(64), snapshotRevision: 7, completedAt: value.updatedAt, workspaceRoot: "C:\\fixture-project",
        goal: "Synthetic keyboard-friendly counter", prototype: "Saved displayed source. Scripts will not run.",
        specification: "Counter increments and resets.", confirmed: ["Keyboard access"], assumed: ["In-memory data"],
        deferred: ["Synchronization"], decisions: ["Reset: preserve keyboard focus"] };
}

test("Discovery and Development artifact groups keep separate disclosure keys through live index updates", async t => {
    const h = await reactHarness(t, undefined, "development"), value = state("development");
    value.artifacts = [{ id: "old", title: "Original discovery Design", stage: "design", kind: "markdown",
        path: "old.md", language: "markdown", content: "Retained", mermaid: "" }];
    h.render(value); await h.flush();
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    const item = { id: "design:current", group: "Design", title: "Current Design", detail: "Current binding", binding: "binding-one" };
    const publish = async (items: object[], selected: string | null = null) => {
        h.window.dispatchEvent(new h.window.MessageEvent("message", { origin: "http://127.0.0.1:8765", source: frame.contentWindow,
            data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "outputs", status: "verified", reason: "", items, selected } }));
        await h.flush();
    };
    await publish([]);
    assert.equal(h.get("development-artifact-list").textContent, "Development");
    h.window.dispatchEvent(new h.window.MessageEvent("message", { origin: "http://127.0.0.1:8765", source: frame.contentWindow,
        data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "outputs", status: "unverified",
            reason: "Connection unavailable; saved outputs are not verified.", items: [] } }));
    await h.flush();
    assert.match(h.get("development-artifact-list").textContent!, /Connection unavailable; saved outputs are not verified/);
    await publish([item]);
    const discovery = h.get("artifact-group-discovery-design"), development = h.get("artifact-group-development-design");
    assert.equal(discovery.getAttribute("aria-expanded"), "false");
    assert.equal(development.getAttribute("aria-expanded"), "false");
    await h.click(discovery);
    assert.equal(discovery.getAttribute("aria-expanded"), "true");
    assert.equal(development.getAttribute("aria-expanded"), "false");
    development.focus();
    await publish([item, { ...item, id: "design:second", binding: "binding-two" }], item.id);
    assert.equal(h.get("artifact-group-development-design"), development);
    assert.equal(h.document.activeElement, development);
    assert.equal(development.getAttribute("aria-expanded"), "false");
    assert.match(development.getAttribute("aria-label")!, /2 items.*current selection.*new output/);
    assert.equal(discovery.getAttribute("aria-expanded"), "true");
    assert.equal(h.get("project-conversation-frame"), frame);
    assert.equal(h.requests.length, 0);
});

test("handoff presentation distinguishes exact admission, pending, uncertainty and new saved input without replay", async t => {
    const h = await reactHarness(t, undefined, "development");
    let value = state("development");
    const snapshotPath = ".tandem/efforts/fixture/stages/prototype-r7.json";
    const id = `handoff-${"a".repeat(64)}`;
    value.lifecycle.outputs = [{ stageId: "prototype", path: snapshotPath, completedAt: value.updatedAt }];
    value.development = { handoffId: id, requestId: id, snapshotPath };
    let admissionStatus = "admitted";
    let invalid = false;
    h.setFetch(async (path, options) => {
        if (path === "/api/development/handoff-review") return response(reviewFixture(value));
        if (path === "/api/development/handoff") return response({ generation: invalid ? "other" : value.generation,
            snapshotPath: value.lifecycle.outputs[0].path, handoffId: id,
            admission: { version: 1, handoffId: id, requestId: id, privateSessionId: "private", status: admissionStatus, message: "Fixture receipt" } });
        if (path === "/api/state") return response(value);
        assert.equal(path, "/api/development/continue");
        assert.equal(options.method, "POST");
        admissionStatus = "admitted";
        return response(value);
    });
    h.render(value); await h.flush();
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    h.window.dispatchEvent(new h.window.MessageEvent("message", { origin: "http://127.0.0.1:8765", source: frame.contentWindow,
        data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "status", status: "ready", active: true } }));
    await h.flush();
    assert.equal(h.document.querySelector("#continue-design"), null);
    assert.match(h.document.querySelector(".development-handoff-status")!.textContent!, /handoff admitted/);
    const mutations = () => h.requests.filter(request => request.options?.method === "POST");
    assert.equal(mutations().length, 0);
    admissionStatus = "sending";
    value = { ...value, revision: value.revision + 1 }; h.render(value); await h.flush();
    assert.equal(h.document.querySelector("#continue-design"), null);
    await h.click("check-design-handoff");
    assert.equal(mutations().length, 0, "Checking pending admission cannot send or reconcile work.");
    admissionStatus = "uncertain";
    value = { ...value, revision: value.revision + 1 }; h.render(value); await h.flush();
    assert.match(h.get("continue-design").textContent!, /Review handoff recovery/);
    assert.match(h.document.querySelector(".development-handoff-status")!.textContent!, /may submit only if not admitted/);
    invalid = true;
    value = { ...value, revision: value.revision + 1 }; h.render(value); await h.flush();
    assert.equal(h.document.querySelector("#continue-design"), null);
    assert.match(h.document.querySelector(".development-handoff-status [role=alert]")!.textContent!, /changed/);
    invalid = false; admissionStatus = "prepared";
    await h.click("check-design-handoff");
    assert.match(h.get("continue-design").textContent!, /Review saved handoff/);
    await h.click("continue-design");
    assert.equal(mutations().length, 0);
    await h.click("confirm-design-handoff");
    assert.equal(mutations().length, 1);
    assert.equal(h.document.querySelector("#continue-design"), null);
    value = { ...value, revision: value.revision + 1, lifecycle: { ...value.lifecycle,
        outputs: [{ ...value.lifecycle.outputs[0], path: ".tandem/efforts/fixture/stages/prototype-r8.json" }] } };
    h.render(value); await h.flush();
    assert.match(h.get("continue-design").textContent!, /updated Prototype/);
    assert.equal(mutations().length, 1, "A new saved input is an explicit action, not automatic admission.");
    h.render({ ...value, revision: value.revision + 1, preparation: { ...value.preparation, status: "running" } }); await h.flush();
    assert.equal(h.document.querySelector("#continue-design"), null);
    assert.equal(mutations().length, 1);
    assert.deepEqual(h.errors, []);
});

test("Prototype review cancel/Escape is read-only, changed input blocks confirmation, and double confirmation submits once", async t => {
    const h = await reactHarness(t);
    let value = state("development");
    value.lifecycle.outputs = [{ stageId: "prototype", path: ".tandem/efforts/fixture/stages/prototype-r7.json", completedAt: value.updatedAt }];
    const sent = Promise.withResolvers<Response>();
    h.setFetch(async (path, options) => {
        if (path === "/api/development/handoff-review") return response(reviewFixture(value));
        if (path === "/api/development/continue") {
            assert.equal(options.method, "POST");
            assert.equal(JSON.parse(String(options.body)).reviewBinding, "b".repeat(64));
            return sent.promise;
        }
        if (path === "/api/state") return response(value);
        if (path === "/api/development/handoff") return response({ generation: value.generation,
            snapshotPath: value.development?.snapshotPath, handoffId: value.development?.handoffId,
            admission: { status: "admitted", handoffId: value.development?.handoffId, requestId: value.development?.requestId } });
        throw new Error(`Unexpected ${path}`);
    });
    h.render(value); await h.flush();
    const posts = () => h.requests.filter(request => request.options.method === "POST");
    const trigger = h.get("review-prototype-handoff"); trigger.focus();
    await h.click(trigger);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Assumptions \(not confirmations\).*In-memory data.*Deferred work \(not requested\).*Synchronization/);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /C:\\fixture-project/);
    await h.click("cancel-design-handoff");
    assert.equal(posts().length, 0); assert.equal(h.presentationRequests.length, 0);
    assert.equal(h.document.activeElement, trigger);
    await h.click(trigger);
    await h.fire(h.document.querySelector('[role="dialog"]')!, "keydown", { key: "Escape", code: "Escape" });
    assert.equal(h.document.querySelector('[role="dialog"]'), null);
    assert.equal(posts().length, 0);
    await h.click(trigger);
    value = { ...value, revision: value.revision + 1, lifecycle: { ...value.lifecycle,
        outputs: [{ ...value.lifecycle.outputs[0], path: ".tandem/efforts/fixture/stages/prototype-r8.json" }] } };
    h.render(value); await h.flush();
    assert.equal(h.get<HTMLButtonElement>("confirm-design-handoff").disabled, true);
    assert.match(h.document.querySelector('[role="dialog"] [role="alert"]')!.textContent!, /changed/);
    await h.click("cancel-design-handoff");
    await h.click(trigger);
    const confirm = h.get("confirm-design-handoff");
    await h.click(confirm); await h.click(confirm);
    assert.equal(posts().length, 1);
    assert.equal(h.get("development-panel").hidden, false);
    assert.match(h.get("development-panel").textContent!, /Preparing the saved handoff/);
    value = { ...value, revision: value.revision + 1, development: {
        handoffId: `handoff-${"a".repeat(64)}`, requestId: `handoff-${"a".repeat(64)}`, snapshotPath: value.lifecycle.outputs[0].path } };
    sent.resolve(response(value)); await h.flush();
    assert.equal(h.document.querySelector("#continue-design"), null);
    assert.match(h.get("development-panel").textContent!, /Waiting for verified Development activity/);
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    const send = async (label: string, permissions = 0) => {
        h.window.dispatchEvent(new h.window.MessageEvent("message", { origin: "http://127.0.0.1:8765", source: frame.contentWindow,
            data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "status", status: "working", active: true,
                permissions, handoffActivity: [{ requestId: value.development!.requestId, label }] } }));
        await h.flush();
    };
    await send("Designer is reading and refining Design from the saved Prototype.", 1);
    assert.match(h.get("development-panel").textContent!, /Designer is reading.*Native permission is waiting/s);
    await send("Design ready from the saved Prototype. Questions: 2, including 1 blocking.");
    assert.match(h.get("development-panel").textContent!, /Design ready.*Questions: 2, including 1 blocking/s);
    assert.equal(posts().length, 1);
    assert.deepEqual(h.errors, []);
});

test("failed handoff startup surfaces the exact error without a blank view or automatic retry", async t => {
    const h = await reactHarness(t);
    const value = state("development");
    value.lifecycle.outputs = [{ stageId: "prototype", path: ".tandem/efforts/fixture/stages/prototype-r7.json", completedAt: value.updatedAt }];
    h.setFetch(async path => {
        if (path === "/api/development/handoff-review") return response(reviewFixture(value));
        if (path === "/api/development/continue") return response({ error: "Native session permission denied. Open the owning session to resolve access." }, 409);
        throw new Error(`Unexpected ${path}`);
    });
    h.render(value); await h.flush();
    await h.click("review-prototype-handoff"); await h.click("confirm-design-handoff");
    assert.match(h.get("development-panel").textContent!, /Native session permission denied.*Open the owning session/);
    assert.equal(h.requests.filter(request => request.options.method === "POST").length, 1);
    assert.ok(h.get("check-design-handoff"));
});

test("direct Development remains the current phase through startup, failure, ready and historical browsing", async t => {
    const h = await reactHarness(t, undefined, "development");
    h.render(state("prepare")); await h.flush();
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    for (const status of ["starting", "failed", "ready"]) {
        h.window.dispatchEvent(new h.window.MessageEvent("message", { origin: "http://127.0.0.1:8765", source: frame.contentWindow,
            data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "status", status, active: status === "ready" } }));
        await h.flush();
        assert.equal(h.get("development-tab").getAttribute("aria-current"), "step");
        assert.match(h.get("development-tab").getAttribute("aria-label")!, /Current phase/);
        assert.doesNotMatch(h.get("development-tab").textContent!, /Running/);
    }
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("development-tab").getAttribute("aria-current"), "step");
    assert.equal(h.get("preparation-tab").getAttribute("aria-current"), null);
    assert.equal(h.requests.length, 0);
});

test("advanced delivery has one accessible panel, retains drafts and preserves confirmation", async t => {
    const h = await reactHarness(t, undefined, "development");
    const value = state("development");
    value.lifecycle.outputs = [{ stageId: "prototype", path: ".tandem\\prototype-r1.json", completedAt: value.updatedAt }];
    h.render(value); await h.flush();
    await h.openProcess();
    const dialog = h.document.querySelector('[role="dialog"]')!;
    assert.ok(dialog);
    assert.match(dialog.textContent!, /Optional controls/);
    assert.equal(dialog.querySelectorAll(".process-controls").length, 1);
    assert.equal(dialog.querySelector(".process-controls > button.ledger-summary"), null);
    assert.equal(h.document.querySelectorAll("#handoff-approver").length, 1);
    await h.input("handoff-approver", "Preserved draft");
    const settings = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent?.includes("Process settings"))!;
    await h.click(settings);
    await h.click("save-process");
    assert.ok(h.document.querySelector('[role="alertdialog"]'));
    await h.confirm(false);
    assert.equal(h.requests.length, 0, "Opening or cancelling advanced controls cannot publish or configure.");
    await h.click("close-acceptance-delivery");
    assert.equal(h.document.querySelector('[role="dialog"]'), null);
    assert.equal(h.document.activeElement?.id, "project-settings");
    await h.openProcess();
    assert.equal(h.get<HTMLInputElement>("handoff-approver").value, "Preserved draft");
    await h.fire(h.document.querySelector('[role="dialog"]')!, "keydown", { key: "Escape", code: "Escape" });
    assert.equal(h.document.querySelector('[role="dialog"]'), null);
    assert.equal(h.document.activeElement?.id, "project-settings");
    assert.deepEqual(h.errors, []);
});

test("Development presentation cannot arm a competing discovery input and rejects foreign messages", async t => {
    const h = await reactHarness(t, undefined, "development"), value = state("requirements");
    value.requirements.substage = "usage";
    h.setFetch(async (path, options) => {
        assert.equal(path, "/api/answer");
        assert.deepEqual(JSON.parse(String(options.body)), { questionId: "usage-intake", action: "add-usage", answer: "A scoped usage" });
        return response(value);
    });
    h.render(value); await h.flush();
    assert.equal(h.get("development-tab").getAttribute("aria-label"), "Development, Current phase");
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    const key = projectDiscovery(value, false).key;
    const send = async (data: object, origin = "http://127.0.0.1:8765", source: Window | null = frame.contentWindow) => {
        h.window.dispatchEvent(new h.window.MessageEvent("message", { data: { protocol: "tandem-project/v1", channel: "fixture-project", ...data }, origin, source }));
        await h.flush();
    };
    const submission = { type: "discovery-send", id: "exact-request", key, text: "A scoped usage" };
    await send(submission, "http://127.0.0.1:9999");
    await send(submission, "http://127.0.0.1:8765", null);
    await send({ ...submission, channel: "foreign" });
    await send({ ...submission, id: "stale-request", key: "older-generation" });
    assert.equal(h.requests.length, 0);
    await send(submission); await send(submission);
    assert.equal(h.requests.length, 0, "Development cannot dispatch a competing Stage1 action.");
    assert.equal(h.get("project-conversation-frame"), frame);
    const discoveryStatus = h.store.getSnapshot().state.status;
    await send({ type: "status", status: "working", active: true, questions: 0, permissions: 0, confirmations: 0 });
    assert.equal(h.document.querySelector("#status"), null, "Global sidebar status prose is not duplicated.");
    assert.match(h.get("project-current-work").getAttribute("aria-label")!, /working/);
    assert.equal(h.store.getSnapshot().state.status, discoveryStatus, "Live status does not rewrite saved discovery evidence.");
});

test("fresh projects open Development directly without creating Stage1 state or a handoff", async t => {
    const h = await reactHarness(t, undefined, null);
    const value = state("prepare");
    value.goal = "";
    h.setFetch(async path => {
        assert.equal(path, "/api/development/open");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    h.render(value); await h.flush();
    assert.equal(h.requests.length, 0);
    await h.click("entry-development");
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    assert.equal(frame.src, "http://127.0.0.1:8765/?panel=workspace");
    assert.equal(h.document.querySelector("#reset-effort"), null, "Direct Development does not offer a discovery reset starter.");
    assert.equal(h.document.querySelector("#continue-design"), null);
    await h.openProcess();
    assert.ok(h.get("capture-development"), "Direct projects retain the explicit capture/delivery controls.");
    await h.click("close-acceptance-delivery");
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("studio-workspace").hidden, false);
    assert.equal(h.document.querySelector("#open-development"), null);
    assert.equal(h.document.querySelector("#start-goal"), null);
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("project-conversation-frame"), frame);
    assert.equal(h.requests.length, 0);
    assert.equal(h.entryRequests.filter(path => path === "/api/project-entry/open").length, 1);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prepare");
    assert.deepEqual(h.store.getSnapshot().state.lifecycle.completedStages, []);
    assert.deepEqual(h.errors, []);
});

test("composed reload is root-owned and rejects foreign, stale, active and unknown requests", async t => {
    const h = await reactHarness(t, undefined, "development");
    const value = { ...state("development"), provider: { canSubmitAnswers: true, canReload: true, extensionId: "user:tandem" } };
    h.render(value); await h.flush();
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame"), replies: Array<Record<string, unknown>> = [];
    frame.contentWindow!.postMessage = message => { replies.push(message); };
    const scope = JSON.stringify([value.prototypeId, value.generation, value.provider.extensionId]);
    const send = async (data: object, origin = "http://127.0.0.1:8765", source: Window | null = frame.contentWindow) => {
        h.window.dispatchEvent(new h.window.MessageEvent("message", { origin, source,
            data: { protocol: "tandem-project/v1", channel: "fixture-project", ...data } }));
        await h.flush();
    };
    h.setFetch(async path => { assert.equal(path, "/api/reload"); return response({ scheduled: true }); });
    const request = { type: "project-reload", id: "reload-one", scope };
    await send(request, "http://127.0.0.1:9999");
    await send(request, undefined, null);
    await send({ ...request, channel: "foreign" });
    await send({ ...request, scope: "old-owner" });
    assert.equal(h.requests.length, 0);
    await send({ type: "status", status: "working", active: true });
    await send(request);
    await send({ type: "status", status: "unknown", active: false, installationStatus: "unknown" });
    await send(request);
    assert.equal(h.requests.length, 0, "Private active/unknown status cannot become a quiet reload boundary.");
    await send({ type: "status", status: "closed", active: false, installationStatus: "closed" });
    await send(request);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].body, {});
    assert.ok(replies.some(reply => reply.type === "project-reload-result" && reply.id === request.id && reply.accepted === true));
    await send({ ...request, id: "second-click" });
    assert.equal(h.requests.length, 1, "Awaiting reload readback cannot submit a duplicate operation.");
    h.render({ ...value, revision: 2, provider: { ...value.provider, canReload: false } }); await h.flush();
    await send({ ...request, id: "unsupported" });
    assert.equal(h.requests.length, 1);
    assert.equal(h.document.querySelector(".topbar #reload-extension"), null);
});

test("Design availability defers to the current phase marker without hiding new output or attention", async t => {
    const h = await reactHarness(t, undefined, "development");
    h.render(state("development")); await h.flush();
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    const send = async (designRevision: string) => {
        h.window.dispatchEvent(new h.window.MessageEvent("message", {
            origin: "http://127.0.0.1:8765", source: frame.contentWindow,
            data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "status",
                status: "waiting-permission", active: true, designRevision, questions: 1, permissions: 2, confirmations: 1 },
        }));
        await h.flush();
    };
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    h.get("development-tab").focus();
    await send("first");
    assert.equal(h.get("development-tab").querySelector(".project-tab-name")?.textContent, "Development");
    assert.equal(h.get("development-tab").getAttribute("aria-label"), "Development, Current phase, Design available");
    assert.match(h.get("development-tab").getAttribute("title")!, /Design available/);
    assert.equal(h.get("development-tab").getAttribute("aria-current"), "step");
    assert.equal(h.get("development-tab").querySelectorAll(".current-phase").length, 1);
    assert.equal(h.get("development-tab").querySelector(".current-phase")?.getAttribute("title"), "Current phase");
    assert.equal(h.get("development-tab").querySelectorAll(".project-availability").length, 0);
    await send("first");
    assert.equal(h.document.activeElement?.id, "development-tab", "Polling does not move focus to the passive marker.");
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("preparation-tab").getAttribute("aria-selected"), "true");
    assert.equal(h.get("development-tab").getAttribute("aria-current"), "step");
    assert.equal(h.get("development-tab").querySelectorAll(".current-phase").length, 1);
    assert.equal(h.get("development-tab").querySelector(".project-availability"), null);
    await send("second");
    assert.equal(h.get("development-tab").querySelector(".project-availability"), null);
    assert.equal(h.get("development-tab").querySelectorAll(".current-phase").length, 1);
    assert.equal(h.get("development-tab").querySelector(".artifact-count")?.textContent, "New output");
    assert.equal(h.get("development-tab").getAttribute("aria-label"), "Development, Current phase, New Design output");
    assert.match(h.get("project-current-work").textContent!, /4 needs attention/);
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("development-tab").querySelector(".project-availability"), null);
    assert.equal(h.get("development-tab").querySelectorAll(".current-phase").length, 1);
    assert.equal(h.get("development-tab").getAttribute("aria-label"), "Development, Current phase, Design available");
    assert.equal(h.get("development-tab").querySelector(".artifact-count"), null);
    assert.equal(h.get("project-conversation-frame"), frame);
    assert.equal(h.requests.length, 0, "The marker never starts work, answers a question or grants approval.");
    h.setFetch(async path => {
        assert.equal(path, "/api/stage/reopen");
        return response(state("prepare", 2));
    });
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    await h.click("reopen-stage"); await h.confirm();
    assert.equal(h.get("preparation-tab").getAttribute("aria-current"), "step");
    assert.equal(h.get("development-tab").getAttribute("aria-current"), null);
    assert.equal(h.get("development-tab").querySelector(".current-phase"), null);
    assert.equal(h.get("development-tab").querySelectorAll(".project-availability").length, 1);
    assert.equal(h.get("development-tab").querySelector(".project-availability")?.getAttribute("title"), "Design available");
    assert.equal(h.get("development-tab").querySelector(".project-availability")?.getAttribute("aria-hidden"), "true");
    assert.equal(h.get("development-tab").getAttribute("aria-label"), "Development, Design available");
});

test("idle unfinished Stage1 can browse Development but active work and read-only ownership cannot open it", async t => {
    const h = await reactHarness(t);
    h.setFetch(async path => {
        assert.equal(path, "/api/development/open");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    const value = state("requirements");
    h.render({ ...value, preparation: { ...value.preparation, status: "running" } }); await h.flush();
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    assert.equal(h.requests.length, 0);
    assert.equal(h.get<HTMLButtonElement>("development-tab").disabled, true);
    h.render({ ...value, revision: 2, provider: { ...value.provider, canSubmitAnswers: false } }); await h.flush();
    assert.equal(h.requests.length, 0);
    assert.equal(h.get<HTMLButtonElement>("development-tab").disabled, true);
    h.render({ ...value, revision: 3 }); await h.flush();
    assert.equal(h.requests.length, 0, "Becoming idle while browsing must not start Development.");
    assert.equal(h.document.querySelector("#project-conversation-frame"), null);
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    await h.click("enter-development");
    assert.equal(h.requests.length, 1);
    assert.equal(h.document.querySelector("#continue-design"), null);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "requirements");
    assert.deepEqual(h.errors, []);
});

for (const stage of ["requirements", "prototype"] as const) test(`${stage} completion and later reopen show retained output without automatically opening Stage2`, async t => {
    const h = await reactHarness(t);
    const before = state(stage);
    if (stage === "requirements") before.prototypeApproach = { mode: "not-applicable", reason: "CLI input fixture." };
    h.render(before); await h.flush();
    const completed = { ...before, revision: 2, stage: "development" as const, lifecycle: {
        ...before.lifecycle, currentStage: "development" as const,
        completedStages: state("development").lifecycle.completedStages,
        outputs: [{ stageId: "prototype" as const, path: ".tandem/efforts/fixture/stages/prototype-r2.json", completedAt: before.updatedAt }],
    } };
    h.render(completed); await h.flush();
    assert.equal(h.get(stage === "prototype" ? "live-preview-panel" : "design-tree-panel").hidden, false,
        "Completing upstream work cannot activate the private surface.");
    assert.equal(h.requests.length, 0);
    const reopened = await reactHarness(t);
    reopened.setFetch(async path => {
        assert.equal(path, "/api/development/open");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    reopened.render(completed); await reopened.flush();
    assert.equal(reopened.get(stage === "prototype" ? "live-preview-panel" : "design-tree-panel").hidden, false,
        "Reopening lands on the latest relevant saved phase rather than an unrelated first artifact.");
    assert.equal(reopened.requests.length, 0);
    assert.equal(reopened.document.querySelector("#project-conversation-frame"), null, "Stage1 history does not require the Stage2 renderer.");
    await reopened.fire(reopened.get("development-tab"), "mousedown", { button: 0 });
    assert.equal(reopened.requests.length, 0, "Browsing Design must not initialize the runtime.");
    assert.ok(reopened.get("continue-design"));
    assert.equal(reopened.document.querySelector("#project-conversation-frame"), null);
});

test("Development mounts one isolated full workspace and navigation keeps its original frame", async t => {
    const h = await reactHarness(t, undefined, "development");
    h.setFetch(async path => {
        assert.equal(path, "/api/development/open", "Opening must not send a project request.");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    h.render(state("development"));
    await h.flush();
    assert.equal(h.get("development-tab").querySelector(".project-tab-name")?.textContent, "Development");
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    assert.equal(frame.src, "http://127.0.0.1:8765/?panel=workspace");
    assert.equal(h.get("studio-workspace").dataset.development, "true");
    assert.doesNotMatch(h.get("studio-workspace").textContent!, /Development: Design, planning/);
    assert.equal(h.document.querySelector('[data-stage-id="design"]'), null);
    assert.ok(h.get("project-artifact-library").contains(h.get("content-tab")));
    assert.equal(h.get("project-contents").querySelector("#content-tab"), null);
    await h.fire(h.get("content-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("content-tab").getAttribute("aria-selected"), "true");
    assert.equal(h.get("project-conversation-frame"), frame);
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    assert.ok(h.get("project-conversation-frame") === frame, "Unsent private state is retained with its iframe.");
    assert.equal(h.requests.length, 0);
    assert.equal(h.presentationRequests.length, 1);
    assert.deepEqual(h.errors, []);
});

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
    const server = createServer(handler);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}/`;
}

test("real React Development keeps handoff controls in view across long-status hover, keyboard focus and resize",
    { skip: !browserAvailable, timeout: 60_000 }, async t => {
        const value = state("development");
        const snapshotPath = ".tandem\\efforts\\fixture\\stages\\prototype-r7.json";
        value.lifecycle.outputs = [{ stageId: "prototype", path: snapshotPath, completedAt: value.updatedAt }];
        value.development = { handoffId: `handoff-${"a".repeat(64)}`, requestId: `handoff-${"a".repeat(64)}`, snapshotPath };
        value.status = "Tandem Development";
        const longStatus = "Design continuation needs attention. The exact handoff was retained: "
            + "Workflow: The saved local private session is unavailable; no replacement session was created. "
            + "Reserved private session be95789c-4bcf-4f23-833e-4b825697b4da; "
            + "handoff-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa. Select Retry runtime inside Development.";
        let snapshot = value;
        const requests: Array<{ path: string; body: unknown }> = [];
        const failures: string[] = [];
        let frameLoads = 0;
        const frameUrl = await serve(t, (_request, response) => {
            frameLoads++;
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end('<!doctype html><html><body><label>Unsent Development draft<textarea id="draft"></textarea></label></body></html>');
        });
        const [styles, hostStyles, bundle] = await Promise.all([
            build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
                bundle: true, write: false, logLevel: "silent" }),
            build({ entryPoints: [fileURLToPath(new URL("../src/browser/styles.css", import.meta.url))],
                bundle: true, write: false, logLevel: "silent" }),
            build({
                stdin: {
                    contents: `
                        import React from "react";
                        import {createRoot} from "react-dom/client";
                        import {flushSync} from "react-dom";
                        import {App} from "./app.js";
                        import {StudioStore} from "./state-store.js";
                        const store = new StudioStore();
                        store.accept(await (await fetch("/api/state")).json());
                        const root = createRoot(document.getElementById("root"));
                        flushSync(() => root.render(React.createElement(App, {store, version:"layout-fixture", connect:false})));
                        window.developmentFixture = {
                            accept(value) { flushSync(() => store.accept(value)); },
                            events: [],
                        };
                        for (const type of ["pointerover", "pointerout", "focusin", "keydown"]) {
                            document.addEventListener(type, event => window.developmentFixture.events.push({
                                type, trusted: event.isTrusted, id: event.target.id,
                            }), true);
                        }
                    `,
                    loader: "tsx", resolveDir: fileURLToPath(new URL("../src/renderer/", import.meta.url)),
                },
                bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
                loader: { ".png": "dataurl" },
                logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' },
            }),
        ]);
        const appUrl = await serve(t, (request, response) => {
            const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
            response.setHeader("Cache-Control", "no-store");
            if (path === "/host") {
                response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                response.end('<!doctype html><html><head><link rel="stylesheet" href="/host.css"></head>'
                    + '<body><div class="host-shell"><main class="host-main"><iframe src="/" title="Tandem application"></iframe></main></div></body></html>');
            } else if (path === "/host.css") {
                response.writeHead(200, { "Content-Type": "text/css" }); response.end(hostStyles.outputFiles[0].text);
            } else if (path === "/") {
                response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                response.end('<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head>'
                    + '<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
            } else if (path === "/styles.css") {
                response.writeHead(200, { "Content-Type": "text/css" }); response.end(styles.outputFiles[0].text);
            } else if (path === "/app.js") {
                response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bundle.outputFiles[0].text);
            } else if (path === "/api/state" && request.method === "GET") {
                response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(snapshot));
            } else if (path === "/api/development/handoff" && request.method === "GET") {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ generation: snapshot.generation, snapshotPath, handoffId: snapshot.development!.handoffId,
                    admission: { version: 1, handoffId: snapshot.development!.handoffId, requestId: snapshot.development!.requestId,
                        privateSessionId: null, status: "prepared", message: "Not submitted." } }));
            } else if (path === "/api/development/handoff-review" && request.method === "GET") {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify(reviewFixture(snapshot)));
            } else if (path === "/api/project-entry") {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ projectPath: "C:\\layout-fixture", startingPath: "development" }));
            } else if (path === "/api/project-entry/open") {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ developmentContext: true, developmentStarted: false }));
            } else if (path === "/api/development/preflight") {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ status: "ready", projectPath: "C:\\layout-fixture", initialize: false, message: "Fixture Git working copy is ready." }));
            } else if (request.method === "POST") {
                void (async () => {
                    const chunks: Buffer[] = [];
                    for await (const chunk of request) chunks.push(Buffer.from(chunk));
                    requests.push({ path, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
                    assert.ok(["/api/development/view", "/api/development/open", "/api/development/continue"].includes(path), `Unexpected mutation: ${path}`);
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify(path === "/api/development/view" ? { url: frameUrl, channel: "layout-fixture" } : path === "/api/development/open" ? { url: frameUrl } : snapshot));
                })().catch(error => {
                    failures.push(error.message);
                    if (!response.headersSent) response.writeHead(500);
                    response.end();
                });
            } else {
                response.writeHead(404); response.end();
            }
        });
        const browser = await openFixtureBrowser(t);
        const version = await browser.call("Browser.getVersion");
        t.diagnostic(`Actual browser: ${version.product}`);
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: appUrl });
        await browser.waitFor('Boolean(window.developmentFixture && document.querySelector("#project-conversation-frame")?.src)');
        await browser.waitFor('document.querySelector("#continue-design")?.disabled === false');
        await browser.evaluate('window.originalDevelopmentFrame = document.querySelector("#project-conversation-frame"); true');
        await browser.waitFor(`Boolean(document.querySelector("#project-conversation-frame")?.src === ${JSON.stringify(frameUrl + "?panel=workspace")})`);
        const settle = () => browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
        const move = async (selector: string, nearLeft = false) => {
            const point = await browser.evaluate(`(() => {
                const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                return { x: rect.left + ${nearLeft ? "16" : "rect.width / 2"}, y: rect.top + Math.min(16, rect.height / 2) };
            })()`);
            await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
            await settle();
            return point;
        };
        const click = async (selector: string) => {
            const point = await move(selector);
            await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
            await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
            await settle();
        };
        const tab = async () => {
            await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await settle();
        };
        const measure = async (step: string) => {
            const geometry = await browser.evaluate(`(() => {
                const bounds = selector => {
                    const element = document.querySelector(selector), rect = element.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
                        hit: hit === element || element.contains(hit) };
                };
                const guide = document.querySelector("#next-action-guide");
                return { viewport: innerWidth, app: bounds(".app"), workspace: bounds("#studio-workspace"),
                    iframe: bounds("#project-conversation-frame"), footer: bounds("#next-action-bar"),
                    button: bounds("#continue-design"),
                    guide: guide.textContent, guideTitle: guide.title, guideClipped: guide.scrollWidth > guide.clientWidth,
                    active: document.activeElement.id || document.activeElement.tagName,
                    frameRetained: window.originalDevelopmentFrame === document.querySelector("#project-conversation-frame") };
            })()`);
            t.diagnostic(JSON.stringify({ step, ...geometry }));
            return geometry;
        };
        const assertBounded = (geometry: Awaited<ReturnType<typeof measure>>) => {
            for (const part of ["app", "workspace", "footer"] as const) {
                assert.ok(Math.abs(geometry[part].width - geometry.viewport) <= 1, `${part} expanded: ${JSON.stringify(geometry)}`);
            }
            assert.ok(geometry.iframe.width > 0 && geometry.iframe.right <= geometry.viewport);
            for (const part of ["button"] as const) {
                assert.ok(geometry[part].left >= 0 && geometry[part].right <= geometry.viewport && geometry[part].hit,
                    `${part} is not visible and hit-testable: ${JSON.stringify(geometry)}`);
            }
            assert.equal(geometry.frameRetained, true);
        };
        await move("#project-conversation-frame", true);
        snapshot = { ...snapshot, revision: snapshot.revision + 1, status: longStatus };
        await browser.evaluate(`window.developmentFixture.accept(${JSON.stringify(snapshot)})`);
        await settle();
        const shortHelp = await measure("1280-pointer-over-iframe");
        await move(".development-toolbar > span", true);
        await browser.waitFor(`document.querySelector("#next-action-guide")?.textContent === ${JSON.stringify(longStatus)}`);
        const longHelp = await measure("1280-pointer-over-toolbar");
        await move("#project-conversation-frame", true);
        const restoredHelp = await measure("1280-pointer-back-over-iframe");
        for (const sample of [shortHelp, longHelp, restoredHelp]) assertBounded(sample);
        assert.equal(shortHelp.guide, "Private Development conversation");
        assert.equal(longHelp.guide, longStatus);
        assert.equal(longHelp.guideTitle, longStatus, "Ellipsis must not remove the full diagnostic.");
        assert.equal(longHelp.guideClipped, true);
        assert.equal(restoredHelp.guide, "Private Development conversation");

        const tree = await browser.call("Page.getFrameTree");
        const privateFrame = tree.frameTree.childFrames.find(frame => frame.frame.url === frameUrl + "?panel=workspace");
        assert.ok(privateFrame);
        const world = await browser.call("Page.createIsolatedWorld", { frameId: privateFrame.frame.id, worldName: "development-draft-fixture" });
        const inFrame = async (expression: string) => {
            const result = await browser.call("Runtime.evaluate", { contextId: world.executionContextId, expression, returnByValue: true });
            assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        await inFrame('document.querySelector("#draft").focus()');
        await browser.call("Input.insertText", { text: "Unsent private draft survives hover and navigation." });
        for (const width of [1280, 900, 640]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            if (width === 640) {
                // Stress translated-length copy in the fixture without changing product labels.
                await browser.evaluate(`document.querySelector("#continue-design").textContent = "Reconcile the retained Prototype handoff and continue Design";`);
            }
            await settle();
            await move("#project-conversation-frame", true);
            assertBounded(await measure(`${width}-iframe-hover`));
            await move("#continue-design");
            assertBounded(await measure(`${width}-button-hover`));
            await move(".development-toolbar > span", true);
            await browser.evaluate('document.querySelector("#development-panel").focus()');
            await tab();
            const focused = await measure(`${width}-keyboard-button`);
            assert.equal(focused.active, "continue-design");
            assertBounded(focused);
            assert.equal(await browser.evaluate('document.querySelector(".development-toolbar #acceptance-delivery")'), null);
        }
        assert.equal(requests.filter(request => request.path === "/api/development/continue").length, 0,
            "Hover, focus, resize and drafting must never submit a handoff.");
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await settle();
        await browser.evaluate('document.querySelector("#content-tab").scrollIntoView({block:"nearest"})');
        await click("#content-tab");
        assert.equal(await inFrame('document.querySelector("#draft").value'), "Unsent private draft survives hover and navigation.");
        await browser.evaluate('document.querySelector("#preparation-tab").scrollIntoView({block:"nearest"})');
        await click("#preparation-tab");
        await click("#development-tab");
        await browser.waitFor('document.querySelector("#development-panel")?.hidden === false');
        assert.equal(await inFrame('document.querySelector("#draft").value'), "Unsent private draft survives hover and navigation.");
        assert.equal(frameLoads, 1, "The private iframe must not remount or reload.");
        assertBounded(await measure("1280-return-from-upstream"));
        await click("#continue-design");
        await browser.waitFor('document.querySelector("#confirm-design-handoff")?.disabled === false');
        assert.equal(requests.filter(request => request.path === "/api/development/continue").length, 0);
        for (const [width, height] of [[640, 420], [390, 520]]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
            await browser.evaluate('document.querySelector("#confirm-design-handoff").scrollIntoView({block:"nearest"})');
            const geometry = await browser.evaluate(`(() => {
                const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect();
                const button = document.querySelector("#confirm-design-handoff").getBoundingClientRect();
                return { left: dialog.left, right: dialog.right, top: dialog.top, bottom: dialog.bottom,
                    buttonVisible: document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2)?.id === "confirm-design-handoff" };
            })()`);
            assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= height);
            assert.equal(geometry.buttonVisible, true);
        }
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.waitFor('!document.querySelector(\'[role="dialog"]\')');
        assert.equal(await browser.evaluate("document.activeElement.id"), "continue-design");
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await click("#continue-design");
        await browser.waitFor('document.querySelector("#confirm-design-handoff")?.disabled === false');
        await click("#confirm-design-handoff");
        await browser.waitFor('document.querySelector("#continue-design")?.disabled === false');
        assert.deepEqual(requests.filter(request => request.path === "/api/development/continue"), [{
            path: "/api/development/continue",
            body: { generation: value.generation, expectedRevision: snapshot.revision, snapshotPath, reviewBinding: "b".repeat(64) },
        }], "A deliberate hit-tested confirmation submits exactly once to the recording fixture endpoint.");
        assert.equal(requests.filter(request => request.path === "/api/development/open").length, 0);
        const events = await browser.evaluate("window.developmentFixture.events");
        for (const type of ["pointerover", "pointerout", "focusin", "keydown"]) {
            assert.ok(events.some(event => event.type === type && event.trusted), `No trusted ${type} event was exercised.`);
        }
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: new URL("host", appUrl).href });
        await browser.waitFor('Boolean(document.querySelector(".host-main > iframe")?.contentDocument?.querySelector("#project-conversation-frame"))');
        const hostTree = await browser.call("Page.getFrameTree");
        const appFrame = hostTree.frameTree.childFrames.find(frame => frame.frame.url === appUrl);
        assert.ok(appFrame);
        const appWorld = await browser.call("Page.createIsolatedWorld", { frameId: appFrame.frame.id, worldName: "host-layout-fixture" });
        const insideApp = async (expression: string) => {
            const result = await browser.call("Runtime.evaluate", { contextId: appWorld.executionContextId, expression, returnByValue: true });
            assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        const hostLayout = await browser.evaluate(`(() => {
            const host = document.querySelector(".host-main"), frame = host.querySelector("iframe");
            host.scrollLeft = host.scrollWidth - host.clientWidth;
            return { viewport: innerWidth, hostWidth: host.clientWidth, appWidth: frame.getBoundingClientRect().width,
                scrollLeft: host.scrollLeft, appLeft: frame.getBoundingClientRect().left };
        })()`);
        const nested = await insideApp(`(() => {
            const button = document.querySelector("#continue-design").getBoundingClientRect();
            return { viewport: innerWidth, workspaceWidth: document.querySelector("#studio-workspace").getBoundingClientRect().width,
                frameWidth: document.querySelector("#project-conversation-frame").getBoundingClientRect().width,
                footerWidth: document.querySelector("#next-action-bar").getBoundingClientRect().width,
                buttonRight: button.right, x: button.left + button.width / 2, y: button.top + button.height / 2 };
        })()`);
        t.diagnostic(JSON.stringify({ step: "640-host-retains-900-application-viewport", hostLayout, nested }));
        assert.equal(hostLayout.viewport, 640);
        assert.equal(hostLayout.appWidth, 900, "Keep the browser host's deliberate minimum application viewport.");
        assert.equal(hostLayout.scrollLeft, 260, "The original host remains horizontally scrollable.");
        assert.equal(nested.viewport, 900);
        assert.equal(nested.workspaceWidth, 900);
        assert.ok(nested.frameWidth > 0 && nested.frameWidth < 900);
        assert.equal(nested.footerWidth, 900);
        assert.ok(nested.buttonRight + hostLayout.appLeft <= hostLayout.viewport);
        await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: nested.x + hostLayout.appLeft, y: nested.y });
        assert.equal(requests.filter(request => request.path === "/api/development/continue").length, 1);
        assert.deepEqual(browser.exceptions, []);
        assert.deepEqual(failures, []);
    });

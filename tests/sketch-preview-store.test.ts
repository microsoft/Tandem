import assert from "node:assert/strict";
import { test } from "node:test";
import type { DslSketchDocument } from "../src/sketch.js";
import type { SketchPreview } from "../src/sketch-stream.js";
import { createDslScreen as createScreen } from "../src/renderer/sketch-editor.js";
import { addUi, buttonScreen } from "./helpers/ui-dsl-fixture.js";
import { StudioStore } from "../src/renderer/state-store.js";
import type { UiState } from "../src/renderer/ui-context.js";

function fixture() {
  const document: DslSketchDocument = { version: 2, screens: [], transitions: [] };
  document.screens.push(buttonScreen(createScreen(document, ["requirement"])));
  const state = {
    prototypeId: "preview-store", generation: "generation-1", revision: 3, updatedAt: "2026-09-20T00:00:00.000Z",
    lifecycle: { currentStage: "sketch", completedStages: [], skippedStages: [] },
    decisionGraph: { nodes: [{ id: "requirement", status: "answered", answer: "A screen" }] },
    sketch: { current: { id: "drawing-1" } },
    processing: { action: "revise-sketch", status: "running", requestId: "request-1", runId: "run-1",
      sketchRequest: { generation: "generation-1", requirementsDigest: "requirements-1", baseRevisionId: "drawing-1" } },
  } as unknown as UiState;
  const preview: SketchPreview = {
    prototypeId: state.prototypeId, generation: state.generation, requestId: "request-1", runId: "run-1",
    baseRevisionId: "drawing-1", requirementsDigest: "requirements-1", sequence: 1, document,
  };
  return { state, preview };
}

test("sketch previews publish consecutive SSE chunks at the same persisted revision and clear on success or cancellation", () => {
  for (const status of ["success", "cancelled"]) {
    const { state, preview } = fixture();
    const store = new StudioStore();
    let publications = 0;
    store.subscribe(() => publications++);
    store.accept(state);
    assert.equal(store.accept({ ...state, sketchPreview: preview }), true);
    const next = structuredClone(preview);
    next.sequence++;
    addUi(next.document.screens[0], "label", "Text", { text: "Updated" });
    assert.equal(store.accept({ ...state, sketchPreview: next }), true);
    assert.equal(store.getSnapshot().state!.revision, state.revision);
    assert.equal(Object.keys(store.getSnapshot().state!.sketchPreview!.document.screens[0].ui.nodes).length, 3);
    assert.equal(publications, 3);
    store.accept({ ...state, revision: 4, processing: { ...state.processing, status }, sketchPreview: null });
    assert.equal(store.getSnapshot().state!.sketchPreview, null);
    store.accept({ ...state, revision: 4, sketchPreview: next });
    assert.equal(store.getSnapshot().state!.sketchPreview, null, "late chunks cannot revive terminal work");
  }
});

test("sketch preview sequences are monotonic, including after an explicit same-revision clear", () => {
  const { state, preview } = fixture();
  const store = new StudioStore();
  store.accept({ ...state, sketchPreview: { ...preview, sequence: 2 } });
  for (const sequence of [1, 2]) {
    const older = structuredClone(preview);
    older.sequence = sequence;
    older.document.screens[0].title = "Older payload";
    assert.equal(store.accept({ ...state, sketchPreview: older }), false);
    assert.equal(store.getSnapshot().state!.sketchPreview!.document.screens[0].title, "Screen 1");
  }
  store.accept({ ...state, sketchPreview: { ...preview, extra: true, document: {} } });
  assert.equal(store.getSnapshot().state!.sketchPreview!.sequence, 2, "obsolete malformed chunks cannot remove a newer preview");
  assert.equal(store.getSnapshot().connectionError, "");
  assert.equal(store.accept({ ...state, sketchPreview: null }), true);
  assert.equal(store.getSnapshot().state!.sketchPreview, null);
  assert.equal(store.getSnapshot().state!.processing.status, "running");
  assert.equal(store.getSnapshot().state!.revision, state.revision);
  store.accept({ ...state, sketchPreview: { ...preview, sequence: 2 } });
  assert.equal(store.getSnapshot().state!.sketchPreview, null);
  store.accept({ ...state, sketchPreview: { ...preview, sequence: 3 } });
  assert.equal(store.getSnapshot().state!.sketchPreview, null, "even higher sequences cannot resurrect a cleared request");
  const next = structuredClone(state);
  next.revision++;
  next.processing.requestId = "request-2";
  store.accept({ ...next, sketchPreview: { ...preview, requestId: "request-2" } });
  assert.equal(store.getSnapshot().state!.sketchPreview!.sequence, 1, "a new request can start design again");
});

test("startup null snapshots allow the first preview but stale-identity null cannot clear current design", () => {
  const { state, preview } = fixture();
  const store = new StudioStore();
  store.accept({ ...state, sketchPreview: null });
  store.accept({ ...state, sketchPreview: null });
  store.accept({ ...state, sketchPreview: preview });
  assert.equal(store.getSnapshot().state!.sketchPreview!.sequence, 1);
  const obsolete = structuredClone(state);
  obsolete.processing.requestId = "obsolete-request";
  store.accept({ ...obsolete, sketchPreview: null });
  assert.equal(store.getSnapshot().state!.sketchPreview!.sequence, 1);
  store.accept({ ...state, sketchPreview: null });
  assert.equal(store.getSnapshot().state!.sketchPreview, null);
});

test("unrelated snapshots retain a preview only for the same active sketch identity", () => {
  for (const change of [
    (state: UiState) => { state.generation = "generation-2"; },
    (state: UiState) => { state.processing.requestId = "request-2"; },
    (state: UiState) => { state.processing.runId = "run-2"; },
    (state: UiState) => { state.processing.sketchRequest.requirementsDigest = "requirements-2"; },
    (state: UiState) => { state.processing.sketchRequest.baseRevisionId = null; },
    (state: UiState) => { state.sketch.current!.id = "drawing-2"; },
    (state: UiState) => { state.processing.sketchRequest.generation = "generation-2"; },
    (state: UiState) => { state.processing.action = "build-prototype"; },
    (state: UiState) => { state.processing.status = "success"; },
    (state: UiState) => { state.lifecycle.currentStage = "prototype"; },
  ]) {
    const { state, preview } = fixture();
    const store = new StudioStore();
    store.accept({ ...state, sketchPreview: preview });
    store.accept({ ...state, revision: 4, provider: { canSubmitAnswers: false } });
    assert.equal(store.getSnapshot().state!.sketchPreview!.sequence, 1);
    const next = structuredClone(state);
    next.revision = 5;
    change(next);
    store.accept(next);
    assert.equal(store.getSnapshot().state!.sketchPreview, null);
  }
});

test("failed generation retains the last valid preview through terminal updates, refresh and late chunks", () => {
  const { state, preview } = fixture();
  const store = new StudioStore();
  store.accept({ ...state, sketchPreview: preview });
  const failed = { ...state, revision: 4, processing: { ...state.processing, status: "error" } };
  store.accept({ ...failed, sketchPreview: null });
  assert.deepEqual(store.getSnapshot().state!.sketchPreview, preview);
  store.accept({ ...state, revision: 4, sketchPreview: { ...preview, sequence: 99 } });
  assert.deepEqual(store.getSnapshot().state!.sketchPreview, preview, "Late chunks cannot resume a stopped preview.");
  const reloaded = new StudioStore();
  reloaded.accept({ ...failed, sketchPreview: preview });
  assert.deepEqual(reloaded.getSnapshot().state!.sketchPreview, preview);
  reloaded.accept({ ...failed, revision: 5, processing: { ...failed.processing, requestId: "retry", runId: null, status: "running",
    sketchResume: { phase: "revision", preview } }, sketchPreview: preview });
  assert.deepEqual(reloaded.getSnapshot().state!.sketchPreview, preview, "Queued retry keeps the source preview before its new run ID exists.");
  reloaded.accept({ ...failed, revision: 6, processing: { ...failed.processing, requestId: "retry", status: "running" },
    sketchPreview: { ...preview, requestId: "retry", sequence: 0 } });
  assert.equal(reloaded.getSnapshot().state!.sketchPreview!.requestId, "retry");
  assert.equal(reloaded.getSnapshot().state!.sketchPreview!.sequence, 0);
});

test("replacement sketch requests reset the sequence and reject stale identities before validating their document", () => {
  const { state, preview } = fixture();
  const store = new StudioStore();
  store.accept({ ...state, sketchPreview: { ...preview, sequence: 20 } });
  const next = structuredClone(state);
  next.revision++;
  next.processing.requestId = "request-2";
  next.processing.runId = "run-2";
  store.accept({ ...next, sketchPreview: { ...preview, document: { broken: true } } });
  assert.equal(store.getSnapshot().state!.sketchPreview, null);
  assert.equal(store.getSnapshot().connectionError, "");
  store.accept({ ...next, sketchPreview: { ...preview, requestId: "request-2", runId: "run-2" } });
  assert.equal(store.getSnapshot().state!.sketchPreview!.sequence, 1);
  for (const field of ["prototypeId", "generation", "requestId", "runId", "baseRevisionId", "requirementsDigest"]) {
    store.accept({ ...next, sketchPreview: { ...preview, [field]: "obsolete", sequence: 200, document: {} } });
    assert.equal(store.getSnapshot().state!.sketchPreview!.requestId, "request-2");
    assert.equal(store.getSnapshot().connectionError, "");
  }
});

test("matching malformed previews are dropped with a connection error without rejecting saved state", () => {
  const { state, preview } = fixture();
  const malformed = [
    { ...preview, sequence: -1 }, { ...preview, sequence: 1.5 }, { ...preview, document: {} },
    { ...preview, extra: true }, { ...preview, runId: undefined },
    { ...preview, document: { ...preview.document, transitions: [{ id: "missing" }] } },
  ];
  for (const bad of malformed) {
    const store = new StudioStore();
    store.accept({ ...state, sketchPreview: preview });
    store.accept({ ...state, revision: 4, sketchPreview: { ...bad, sequence: bad.sequence === 1 ? 2 : bad.sequence } });
    assert.equal(store.getSnapshot().state!.sketchPreview, null);
    assert.equal(store.getSnapshot().state!.revision, 4);
    assert.equal(store.getSnapshot().state!.sketch.current!.id, "drawing-1");
    assert.match(store.getSnapshot().connectionError, /preview is invalid.*unchanged.*retry/);
    store.accept({ ...state, revision: 4 });
    assert.match(store.getSnapshot().connectionError, /preview is invalid/);
    store.accept({ ...state, revision: 4, sketchPreview: { ...preview, sequence: 3 } });
    assert.equal(store.getSnapshot().connectionError, "");
  }
  const unaccepted = structuredClone(preview);
  unaccepted.document.screens[0].decisionIds = ["unaccepted"];
  const store = new StudioStore();
  store.accept({ ...state, sketchPreview: unaccepted });
  assert.match(store.getSnapshot().connectionError, /preview is invalid/);
});

test("per-page progress survives preview transport while invalid or stale status payloads cannot replace it", () => {
  const { state, preview } = fixture();
  const screenId = preview.document.screens[0].id;
  const store = new StudioStore();
  store.accept({ ...state, sketchPreview: { ...preview, screenStatuses: { [screenId]: "processing" } } });
  store.accept({ ...state, sketchPreview: { ...preview, sequence: 2, screenStatuses: { [screenId]: "ready" } } });
  assert.deepEqual(store.getSnapshot().state!.sketchPreview!.screenStatuses, { [screenId]: "ready" });
  store.accept({ ...state, sketchPreview: { ...preview, screenStatuses: { [screenId]: "waiting" } } });
  assert.deepEqual(store.getSnapshot().state!.sketchPreview!.screenStatuses, { [screenId]: "ready" });
  for (const screenStatuses of [null, [], {}, { missing: "ready" }, { [screenId]: "approved" },
    { [screenId]: "processing", extra: "waiting" }]) {
    const invalid = new StudioStore();
    invalid.accept({ ...state, sketchPreview: { ...preview, screenStatuses } });
    assert.equal(invalid.getSnapshot().state!.sketchPreview, null);
    assert.match(invalid.getSnapshot().connectionError, /preview is invalid/);
  }
  const empty = structuredClone(preview);
  empty.document.screens[0].ui.nodes[empty.document.screens[0].ui.root].children = [];
  empty.document.screens[0].ui.nodes = { screen: empty.document.screens[0].ui.nodes.screen };
  const invalid = new StudioStore();
  invalid.accept({ ...state, sketchPreview: { ...empty, screenStatuses: { [screenId]: "ready" } } });
  assert.match(invalid.getSnapshot().connectionError, /preview is invalid/);
});

test("late HTTP snapshots cannot replace a newer SSE preview or erase it with stale null", async () => {
  for (const latePreview of ["older", "null", "missing"]) {
    const { state, preview } = fixture();
    let resolve!: (response: Response) => void;
    const store = new StudioStore(async () => new Promise<Response>((done) => { resolve = done; }));
    store.accept(state);
    const pending = store.refresh();
    store.accept({ ...state, sketchPreview: { ...preview, sequence: 2 } });
    const late = { ...state, ...(latePreview === "missing" ? {} : {
      sketchPreview: latePreview === "null" ? null : preview,
    }) };
    resolve(new Response(JSON.stringify(late)));
    await pending;
    assert.equal(store.getSnapshot().state!.sketchPreview!.sequence, 2, latePreview);
  }
});

test("same-revision null while still running survives delayed and fresh HTTP chunks with higher sequences", async () => {
  const { state, preview } = fixture();
  let resolve!: (response: Response) => void;
  const store = new StudioStore(async () => new Promise<Response>((done) => { resolve = done; }));
  store.accept({ ...state, sketchPreview: preview });
  const pending = store.refresh();
  store.accept({ ...state, sketchPreview: null });
  assert.equal(store.getSnapshot().state!.sketchPreview, null);
  const late = { ...state, sketchPreview: { ...preview, sequence: 50 } };
  resolve(new Response(JSON.stringify(late)));
  await pending;
  assert.equal(store.getSnapshot().state!.sketchPreview, null);
  const fresh = store.refresh();
  resolve(new Response(JSON.stringify(late)));
  await fresh;
  assert.equal(store.getSnapshot().state!.sketchPreview, null, "a later transport cannot reopen the cleared request");
  assert.equal(store.getSnapshot().state!.processing.status, "running");
  assert.equal(store.getSnapshot().state!.sketch.current!.id, "drawing-1");
});

test("reconnect GET can recover a starting generation preview without a saved revision", async () => {
  const { state, preview } = fixture();
  state.sketch.current = null;
  state.processing.status = "starting";
  state.processing.action = "generate-sketch";
  state.processing.sketchRequest.baseRevisionId = null;
  preview.baseRevisionId = null;
  const store = new StudioStore(async () => new Response(JSON.stringify({ ...state, sketchPreview: preview })));
  await store.refresh();
  assert.equal(store.getSnapshot().state!.sketch.current, null);
  assert.equal(Object.keys(store.getSnapshot().state!.sketchPreview!.document.screens[0].ui.nodes).length, 2);
});

test("late HTTP preview cannot resurrect a generation that SSE already replaced", async () => {
  const { state, preview } = fixture();
  let resolve!: (response: Response) => void;
  const store = new StudioStore(async () => new Promise<Response>((done) => { resolve = done; }));
  store.accept({ ...state, sketchPreview: preview });
  const pending = store.refresh();
  const next = structuredClone(state);
  next.revision++;
  next.generation = "generation-2";
  next.processing = null;
  store.accept(next);
  resolve(new Response(JSON.stringify({ ...state, sketchPreview: { ...preview, sequence: 10 } })));
  await pending;
  assert.equal(store.getSnapshot().state!.generation, "generation-2");
  assert.equal(store.getSnapshot().state!.sketchPreview, null);
});

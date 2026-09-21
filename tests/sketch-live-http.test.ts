import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { buildSketchLivePrompt } from "../src/planning-prompts.js";
import { sketchLiveContext } from "../src/renderer/sketch-live-context.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";
import type { UiState } from "../src/renderer/ui-context.js";

test("GPT-live tickets are same-origin, Sketch-only and never authenticate or persist credentials", async () => {
  const h = await extensionHarness();
  const entry = await h.api.startServer("live-http", "sample", "project:tandem", true);
  try {
    const state = await h.api.loadState("sample");
    const url = new URL("api/sketch/live/session", entry.url);
    const headers = { "Content-Type": "application/json", "X-Tandem-Speech": "1", Origin: url.origin };
    const request = (body = "{}", custom = headers) => fetch(url, { method: "POST", headers: custom, body });
    assert.equal((await request("{}", { ...headers, Origin: "https://unrelated.example" })).status, 403);
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await request('{"endpoint":"https://unrelated.example"}')).status, 400);
    const wrongStage = await request();
    assert.equal(wrongStage.status, 409, JSON.stringify(await wrongStage.json()));
    state.lifecycle.currentStage = "sketch";
    state.lifecycle.completedStages = ["prepare", "requirements"];
    state.prototypeApproach = { mode: "build", reason: "An app needs sketches." };
    await h.api.persistState(state);
    const path = join(h.root, ".tandem", "efforts", "sample", "state.json");
    const before = await readFile(path, "utf8");
    assert.equal((await request('{"context":["not-json"]}')).status, 400);
    const response = await request(JSON.stringify({ context: ['{"kind":"screen","id":"home"}'] }));
    const result = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(result.path, "/api/sketch/live/socket");
    assert.equal(typeof result.ticket, "string");
    assert.equal(h.speechTokenRequests(), 0, "selecting the provider cannot request Azure credentials");
    assert.equal(h.requests.length, 0, "starting voice is not a drawing or lifecycle action");
    assert.equal(await readFile(path, "utf8"), before);
    assert.ok(!JSON.stringify(result).includes("authorizationToken"));
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, extensions: {
      list: async () => ({ extensions: [{ id: "project:tandem", status: "running" }, { id: "user:tandem", status: "running" }] }),
    } } });
    assert.equal((await request()).status, 409, "read-only provider cannot obtain a connection");
  } finally {
    entry.live.close();
    clearInterval(entry.heartbeat);
    await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
    await h.close();
  }
});

test("live instructions preserve approval boundaries and scene context describes the editable selection", async () => {
  const h = await extensionHarness();
  try {
    const state = await h.api.loadState("sample");
    const document = sketchDocument();
    document.screens[0].shapes[0].text = "標籤".repeat(250);
    state.goal = "Goal\n".repeat(500);
    const messages = sketchLiveContext(state as UiState, document, "main", "primary-action");
    assert.ok(messages.every((message) => Buffer.byteLength(message, "utf8") <= 500));
    const context = messages.map((message) => JSON.parse(message));
    const shape = context.find((record) => record.kind === "shape");
    assert.equal(shape.selected, true);
    assert.equal(shape.id, "primary-action");
    Object.assign(document.screens[0].shapes[0], {
      kind: "path", curve: "catmull-rom", closed: true, tension: 0.5,
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 20 }],
    });
    const curved = sketchLiveContext(state as UiState, document, "main", "primary-action");
    assert.ok(curved.every((message) => Buffer.byteLength(message, "utf8") <= 500));
    const curve = curved.map((message) => JSON.parse(message)).find((record) => record.kind === "shape");
    assert.equal(curve.curve, "catmull-rom");
    assert.equal(curve.closed, true);
    assert.equal(curve.tension, 0.5);
    assert.equal(context[0].prototypeId, "sample");
    assert.match(context[0].approval, /Only the user/);
    const prompt = buildSketchLivePrompt();
    assert.ok(Buffer.byteLength(prompt) <= 16_384);
    assert.match(prompt, /Ordinary questions, brainstorming and backchannels are conversation, not edit requests/);
    assert.match(prompt, /Never claim a change is done/);
    assert.match(prompt, /Do not change accepted requirements, approve drawings, advance stages/);
  } finally { await h.close(); }
});

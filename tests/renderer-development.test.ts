import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, state, response } from "./helpers/react-harness.js";

test("Development mounts one isolated full workspace and navigation keeps its original frame", async t => {
    const h = await reactHarness(t);
    h.setFetch(async path => {
        assert.equal(path, "/api/development/open", "Opening must not send a project request.");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    h.render(state("development"));
    await h.flush();
    const frame = h.get<HTMLIFrameElement>("development-frame");
    assert.equal(frame.src, "http://127.0.0.1:8765/");
    assert.equal(h.get("studio-workspace").dataset.development, "true");
    assert.equal(h.get<HTMLButtonElement>("reset-effort").disabled, true);
    assert.equal(h.document.querySelector('[data-stage-id="design"]'), null);
    await h.click("preparation-tab");
    await h.click("development-tab");
    assert.ok(h.get("development-frame") === frame, "Unsent private state is retained with its iframe.");
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.errors, []);
});

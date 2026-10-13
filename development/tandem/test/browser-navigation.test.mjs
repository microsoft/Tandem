import assert from "node:assert/strict";
import test from "node:test";
import { openBrowserCanvas } from "../src/browser-navigation.mjs";
import { normalizeNavigationUrl } from "../public/link-navigation.js";

const browser = () => ({ extensionId: "host:browser", canvasId: "browser", inputSchema: {
  type: "object", properties: { url: { type: "string" },
    placement: { type: "object", properties: { focus: { type: "boolean" } } } },
} });
function host(canvases = [browser()]) {
  const calls = [];
  const session = { sessionId: "main", send: () => assert.fail("No agent turn"),
    rpc: { canvas: {
      list: async () => ({ canvases }),
      open: async input => { calls.push(input); return { ...input }; },
    } } };
  return { session, calls };
}

test("navigation URL validation preserves HTTP(S) address semantics and rejects credentials/schemes", () => {
  assert.equal(normalizeNavigationUrl("http://127.0.0.1:55741/?x=1#lamp"), "http://127.0.0.1:55741/?x=1#lamp");
  assert.equal(normalizeNavigationUrl("https://EXAMPLE.com"), "https://example.com/");
  for (const url of ["javascript:alert(1)", "file:///C:/secret", "data:text/html,hi", "ftp://example.com", "/relative",
    "https://user:pass@example.com/", "https://user@example.com/", " https://example.com", "https://example.com/\nnext", "x".repeat(8193), null]) {
    assert.throws(() => normalizeNavigationUrl(url), /HTTP|valid|credentials/);
  }
});

test("Host Browser navigation discovers the provider and opens/focuses a stable URL identity directly", async () => {
  const { session, calls } = host();
  const first = await openBrowserCanvas(session, "https://example.com", { focus: true });
  const second = await openBrowserCanvas(session, "https://example.com/", { focus: false });
  assert.match(first.instanceId, /^tandem-link-[a-f0-9]{24}$/);
  assert.equal(first.instanceId, second.instanceId, "Retries focus the same Host panel, never invent a second tab identity.");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].canvasId, "browser");
  assert.equal(calls[0].extensionId, "host:browser");
  assert.deepEqual(calls[0].input, { url: "https://example.com/", placement: { focus: true } });
  assert.deepEqual(calls[1].input.placement, { focus: false });
  const other = host();
  other.session.sessionId = "other-main";
  assert.notEqual((await openBrowserCanvas(other.session, "https://example.com")).instanceId, first.instanceId);
});

test("unavailable/ambiguous capabilities and failed or mismatched Host acknowledgements fail visibly", async () => {
  await assert.rejects(openBrowserCanvas({}, "https://example.com"), /unavailable/);
  await assert.rejects(openBrowserCanvas(host([]).session, "https://example.com"), /unavailable/);
  await assert.rejects(openBrowserCanvas(host([browser(), { ...browser(), extensionId: "other" }]).session, "https://example.com"), /More than one/);
  await assert.rejects(openBrowserCanvas(host([{ ...browser(), inputSchema: {} }]).session, "https://example.com"), /supported URL/);
  const foregroundOnly = browser(); delete foregroundOnly.inputSchema.properties.placement;
  await assert.rejects(openBrowserCanvas(host([foregroundOnly]).session, "https://example.com", { focus: false }), /background/);
  await assert.rejects(openBrowserCanvas(host().session, "https://example.com", { focus: "yes" }), /boolean/);
  const failed = host(); failed.session.rpc.canvas.open = async () => { throw new Error("Host refused navigation"); };
  await assert.rejects(openBrowserCanvas(failed.session, "https://example.com"), /Host refused/);
  const mismatch = host(); mismatch.session.rpc.canvas.open = async () => ({ instanceId: "another" });
  await assert.rejects(openBrowserCanvas(mismatch.session, "https://example.com"), /did not confirm/);
});

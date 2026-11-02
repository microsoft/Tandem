import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startWhiteboard } from "../server.mjs";
import { connect } from "./example.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (!values.out) throw new Error("Provide --out for this isolated native reconciliation proof.");
const out = values.out;
await mkdir(out, { recursive: true });
const record = (name, value) => writeFile(join(out, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
const owned = await startWhiteboard({ assetsRoot: fileURLToPath(new URL("../dist-native-sync/", import.meta.url)) });
let browser, completed = false;
const requests = [], errors = [];
try {
  const operation = await connect(owned.info.url, "default");
  const empty = await operation("read");
  const edited = await operation("edit", { expectedVersionId: empty.versionId, operations: [
    { op: "add", element: { id: "offset-path", type: "line", x: 200, y: 200, width: 100, height: 120,
      points: [[100, 50], [30, 0], [0, 120], [100, 50]], strokeWidth: 3, backgroundColor: "#e7d4be",
      customData: { keep: "source metadata" } } },
    { op: "add", element: { id: "fill-only", type: "ellipse", x: 420, y: 300, width: 70, height: 100,
      strokeWidth: 0, backgroundColor: "#1971c2" } },
  ] });
  assert.equal((await operation("read")).hasUnsealedChanges, true, "An agent edit without seal is genuinely pending.");
  const seal = await operation("seal", { expectedVersionId: edited.versionId });
  const v1 = await operation("read", { includeImage: true });
  assert.equal(v1.versionId, seal.versionId); assert.equal(v1.hasUnsealedChanges, false);
  browser = await chromium.launch({ headless: true,
    ...(process.platform === "win32" ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL ?? "msedge" } : {}) });
  async function open() {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/edit") requests.push({ frame: request.frame().url(), input: request.postDataJSON() });
    });
    await page.goto(owned.info.url);
    await expect(page.getByRole("combobox", { name: "Discussion topic" })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    return page;
  }
  const page = await open();
  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  await page.setViewportSize({ width: 1120, height: 910 });
  await page.waitForTimeout(500);
  assert.equal(requests.length, 0, "Mount/fonts/view-only fit/resize must not publish native normalization.");
  assert.equal(owned.topics.state("default").versionId, v1.versionId);
  assert.equal((await operation("read")).hasUnsealedChanges, false);
  const snapshot = await operation("snapshot", { target: v1.versionId });
  assert.equal(snapshot.versionId, v1.versionId);
  assert.deepEqual((await operation("read", { target: v1.versionId })).scene, v1.scene);

  const update = await operation("edit", { expectedVersionId: v1.versionId, operations: [
    { op: "update", id: "fill-only", set: { backgroundColor: "#2f9e44" } },
  ] });
  await operation("seal", { expectedVersionId: update.versionId });
  await expect(page.locator(".version")).toHaveAttribute("title", update.versionId);
  await page.waitForTimeout(500);
  assert.equal(requests.length, 0, "Already-open UI must not echo a remote agent update.");
  assert.equal((await operation("read")).hasUnsealedChanges, false);
  const topicResponse = await fetch(new URL("/topics", owned.info.url), { method: "POST",
    headers: { "Content-Type": "application/json", "x-whiteboard-instance": owned.info.instanceId },
    body: JSON.stringify({ name: "Independent native projection" }) });
  assert.equal(topicResponse.status, 201);
  const topic = await topicResponse.json(), second = await connect(owned.info.url, topic.topicId);
  const secondEmpty = await second("read");
  const secondEdit = await second("edit", { expectedVersionId: secondEmpty.versionId,
    operations: edited.scene.elements.map((element) => ({ op: "add", element })) });
  await second("seal", { expectedVersionId: secondEdit.versionId });
  const selector = page.getByRole("combobox", { name: "Discussion topic" });
  await selector.selectOption(topic.topicId);
  await expect(page.locator(".version")).toHaveAttribute("title", secondEdit.versionId);
  await page.waitForTimeout(300);
  assert.equal(requests.length, 0, "Switching topics must not submit another page's native projection.");
  assert.equal((await second("read")).hasUnsealedChanges, false);
  const addressed = await operation("snapshot", { target: update.versionId });
  assert.equal(addressed.topicId, "default", "A selected human topic must not redirect an exact agent snapshot.");
  await selector.selectOption("default");
  await expect(page.locator(".version")).toHaveAttribute("title", update.versionId);
  assert.equal(owned.topics.state("default").versionId, update.versionId);
  await page.getByRole("button", { name: "Reset to latest sealed", exact: true }).click();
  await expect(page.getByRole("status", { exact: true })).toHaveText("Sealed");
  assert.equal(owned.topics.state("default").versionId, update.versionId, "No-op reset compares authoritative content, not the native projection.");

  const peer = await open(), box = await peer.locator("canvas.interactive").boundingBox();
  await peer.keyboard.press("v");
  await peer.mouse.move(box.x + 290, box.y + 245); await peer.mouse.down();
  await peer.mouse.move(box.x + 320, box.y + 265, { steps: 12 }); await peer.mouse.up();
  await expect.poll(() => owned.topics.state("default").scene.elements.find(({ id }) => id === "offset-path").x).toBeCloseTo(330, 0);
  let state = owned.topics.state("default");
  const moved = state.scene.elements.find(({ id }) => id === "offset-path");
  const original = v1.scene.elements.find(({ id }) => id === "offset-path");
  assert.deepEqual(moved.points.map(([x, y]) => [x + moved.x, y + moved.y]),
    original.points.map(([x, y]) => [x + original.x + 30, y + original.y + 20]));
  assert.deepEqual(moved.customData, original.customData);
  assert.equal(state.scene.elements.find(({ id }) => id === "fill-only").strokeWidth, 0);
  assert.equal((await operation("read")).hasUnsealedChanges, true);
  await assert.rejects(operation("edit", { expectedVersionId: update.versionId, operations: [] }), (error) => error.status === 409);

  await expect(peer.getByRole("combobox", { name: "Discussion topic" })).toBeEnabled();
  await peer.mouse.click(box.x + 455, box.y + 350);
  await peer.getByRole("group", { name: "Stroke width", exact: true }).getByRole("radio").first().locator("..").click();
  await expect.poll(() => owned.topics.state("default").scene.elements.find(({ id }) => id === "fill-only").strokeWidth).toBe(1);
  await peer.keyboard.press("p");
  await peer.mouse.move(box.x + 650, box.y + 500); await peer.mouse.down();
  await peer.mouse.move(box.x + 710, box.y + 520, { steps: 10 }); await peer.mouse.up();
  await expect.poll(() => owned.topics.state("default").scene.elements.filter(({ type }) => type === "freedraw").length).toBe(1);
  await expect(peer.getByRole("combobox", { name: "Discussion topic" })).toBeEnabled();
  state = owned.topics.state("default");
  assert.equal(state.hasUnsealedChanges, true, "Real human geometry/stroke/ink must remain unsealed until explicit handoff.");
  await peer.getByRole("button", { name: "Seal version", exact: true }).click();
  await expect(peer.getByRole("status", { exact: true })).toHaveText("Sealed");
  const human = await operation("read", { compareTo: update.versionId, includeImage: true });
  assert.ok(human.changes.changed.some(({ id, fields }) => id === "fill-only" && fields.some(({ path }) => path === "strokeWidth")));
  assert.equal(human.changes.added.filter(({ type }) => type === "freedraw").length, 1);
  await record("human-native.png", Buffer.from(human.image.dataURL.split(",")[1], "base64"));
  await record("receipts.json", { instanceId: owned.info.instanceId, topicId: "default", empty, edited, seal, v1, update, human, requests });
  await record("proof.json", { explicitV1Seal: v1.versionId, unsealedAgentControl: true,
    untouchedMountFontsFitResizeAndSnapshotStayedSealed: true, remoteSealedV2StayedSealed: true,
    topicSwitchesAndAddressedSnapshotsIsolated: true, noOpResetUnchanged: true,
    humanGeometryWorldPointsPreserved: true, zeroStrokePreservedUntilRealUIEdit: true,
    realStrokeAndInkPendingProtected: true, staleAgentEditRejected: true, previousSealImmutable: true });
  assert.deepEqual((await operation("read", { target: v1.versionId })).scene, v1.scene);
  assert.deepEqual(errors, []);
  completed = true;
  console.log("Native reconciliation: isolated exact-seal/untouched UI, remote update and protected human edits passed.");
} finally {
  await browser?.close(); await owned.close();
  await record("cleanup.json", { completed, url: owned.info.url, instanceId: owned.info.instanceId, pid: owned.info.pid,
    ownedServiceAndBrowsersClosed: true, heldReviewsContacted: false, errors });
}

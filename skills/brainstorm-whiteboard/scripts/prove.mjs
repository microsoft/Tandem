import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startWhiteboard } from "../server.mjs";
import { connect, flowElements } from "./example.mjs";
import { sceneDiff } from "../shared/scene.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out;
if (out) await mkdir(out, { recursive: true });
const evidence = async (name, value) => {
  if (out) await writeFile(join(out, name), typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
};
// Always use a new bounded instance. This proof never accepts a public review URL.
const owned = await startWhiteboard({ assetsRoot: fileURLToPath(new URL("../dist-test/", import.meta.url)) });
const browser = await chromium.launch({ headless: true,
  ...(process.platform === "win32" ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL ?? "msedge" } : {}) });
let releasePeer = () => {};
try {
  const operation = await connect(owned.info.url);
  const baseline = await operation("read");
  assert.equal(baseline.scene.elements.length, 0);
  const firstEdit = await operation("edit", { expectedVersionId: baseline.versionId,
    operations: flowElements().map((element) => ({ op: "add", element })) });
  const seal1 = await operation("seal", { expectedVersionId: firstEdit.versionId });
  assert.equal(seal1.versionId, firstEdit.versionId);
  const v1 = await operation("read", { target: seal1.versionId, includeImage: true });
  await evidence("V1.json", v1);
  await evidence("V1.png", Buffer.from(v1.image.dataURL.split(",")[1], "base64"));
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(owned.info.url);
  await expect(page.getByRole("status", { exact: true })).toHaveText("Sealed");
  await page.waitForTimeout(200);
  if (owned.board.state().versionId !== firstEdit.versionId) {
    await evidence("opening-normalization.json", sceneDiff(v1.scene, owned.board.state().scene));
    throw new Error("Opening the native example unexpectedly changed working content; see opening-normalization.json.");
  }
  const canvas = page.locator("canvas.interactive");
  const box = await canvas.boundingBox();
  assert.ok(box);
  await page.mouse.dblclick(box.x + 490, box.y + 230);
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
  await page.locator("textarea.excalidraw-wysiwyg").fill("Review together");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status", { exact: true })).toHaveText("Unsealed changes");
  assert.equal(owned.board.state().scene.elements.find((element) => element.id === "label-2").text, "Review together");

  await page.getByRole("radio", { name: "Selection", exact: true }).locator("..").click();
  await canvas.click({ position: { x: 1100, y: 450 } });
  const beforeMove = owned.board.state().scene;
  const node = beforeMove.elements.find((element) => element.id === "node-2");
  await page.mouse.move(box.x + node.x + node.width - 15, box.y + node.y + node.height - 15);
  await page.mouse.down(); await page.mouse.move(box.x + node.x + node.width + 25, box.y + node.y + node.height + 15, { steps: 15 }); await page.mouse.up();
  await expect.poll(() => owned.board.state().scene.elements.find((element) => element.id === "node-2").x).toBeCloseTo(node.x + 40, 0);
  await expect(page.getByRole("status", { exact: true })).toHaveText("Unsealed changes");
  const moved = owned.board.state().scene;
  const movedNode = moved.elements.find((element) => element.id === "node-2");
  const oldLabel = beforeMove.elements.find((element) => element.id === "label-2");
  const movedLabel = moved.elements.find((element) => element.id === "label-2");
  assert.ok(Math.abs((movedLabel.x - oldLabel.x) - (movedNode.x - node.x)) < 1);
  assert.ok(Math.abs((movedLabel.y - oldLabel.y) - (movedNode.y - node.y)) < 1);
  assert.notDeepEqual(moved.elements.find((element) => element.id === "arrow-1").points,
    beforeMove.elements.find((element) => element.id === "arrow-1").points);

  // The actual native bottom-right resize handle, not a JSON geometry patch.
  await page.mouse.move(box.x + movedNode.x + movedNode.width + 4, box.y + movedNode.y + movedNode.height + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + movedNode.x + movedNode.width + 44, box.y + movedNode.y + movedNode.height + 29, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => owned.board.state().scene.elements.find((element) => element.id === "node-2").width).toBeGreaterThan(movedNode.width + 20);
  await expect(page.getByRole("status", { exact: true })).toHaveText("Unsealed changes");
  const resized = owned.board.state().scene;
  const resizedNode = resized.elements.find((element) => element.id === "node-2");
  const resizedLabel = resized.elements.find((element) => element.id === "label-2");
  assert.equal(resizedLabel.containerId, resizedNode.id);
  assert.ok(resizedLabel.x >= resizedNode.x && resizedLabel.x + resizedLabel.width <= resizedNode.x + resizedNode.width + 1);
  assert.notDeepEqual(resized.elements.find((element) => element.id === "arrow-2").points, moved.elements.find((element) => element.id === "arrow-2").points);
  for (const [index, arrow] of resized.elements.filter((element) => element.type === "arrow").entries()) {
    assert.equal(arrow.startBinding.elementId, `node-${index + 1}`);
    assert.equal(arrow.endBinding.elementId, `node-${index + 2}`);
  }

  await page.getByRole("radio", { name: "Draw", exact: true }).locator("..").click();
  await page.getByTestId("color-top-pick-#e03131").first().click();
  await page.mouse.move(box.x + 390, box.y + 420); await page.mouse.down();
  await page.mouse.move(box.x + 440, box.y + 390, { steps: 12 });
  await page.mouse.move(box.x + 510, box.y + 430, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => owned.board.state().scene.elements.filter((element) => element.type === "freedraw").length).toBe(1);
  await expect(page.getByRole("status", { exact: true })).toHaveText("Unsealed changes");
  const pending = await operation("read");
  assert.equal(pending.versionId, v1.versionId);
  assert.equal(pending.hasUnsealedChanges, true);
  assert.deepEqual(pending.scene, v1.scene);
  const inspected = await page.locator(".version").getAttribute("title");
  assert.equal(inspected, owned.board.state().versionId);
  await assert.rejects(operation("read", { target: inspected }), (error) => error.status === 404);
  await evidence("before-human-seal.json", pending);
  await page.getByRole("button", { name: "Seal version", exact: true }).click();
  await expect(page.getByRole("status", { exact: true })).toHaveText("Sealed");
  const v2 = await operation("read", { compareTo: v1.versionId, includeImage: true });
  assert.equal(v2.versionId, inspected);
  assert.equal(v2.hasUnsealedChanges, false);
  assert.equal(v2.image.versionId, v2.versionId);
  assert.ok(v2.changes.changed.find((entry) => entry.id === "label-2").fields.some((field) => field.path === "text" && field.after === "Review together"));
  assert.ok(v2.changes.changed.find((entry) => entry.id === "node-2").fields.some((field) => field.path === "width"));
  assert.equal(v2.changes.added.filter((element) => element.type === "freedraw").length, 1);
  assert.deepEqual((await operation("read", { target: v1.versionId })).scene, v1.scene);
  await evidence("V2.json", v2); await evidence("changes-V1-to-V2.json", v2.changes);
  await evidence("V2.png", Buffer.from(v2.image.dataURL.split(",")[1], "base64"));
  await page.screenshot({ path: out ? join(out, "human-ui-V2.png") : undefined });
  const redPixels = async (dataURL) => page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(data)).blob());
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 170 && pixels[i + 1] < 100 && pixels[i + 2] < 100) red++;
    bitmap.close(); return red;
  }, dataURL);
  assert.equal(await redPixels(v1.image.dataURL), 0);
  assert.ok(await redPixels(v2.image.dataURL) > 50);
  const persistence = await page.evaluate(async () => ({
    localKeys: Object.keys(localStorage), sessionKeys: Object.keys(sessionStorage),
    databases: (await indexedDB.databases()).map((database) => database.name),
  }));
  assert.deepEqual(persistence, { localKeys: [], sessionKeys: [], databases: [] });
  await evidence("storage-check.json", persistence);

  await page.getByRole("radio", { name: "Selection", exact: true }).locator("..").click();
  await canvas.click({ position: { x: 1000, y: 480 } });
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.keyboard.down("Space"); await page.mouse.move(box.x + 1000, box.y + 450); await page.mouse.down();
  await page.mouse.move(box.x + 1040, box.y + 470, { steps: 10 }); await page.mouse.up(); await page.keyboard.up("Space");
  await page.waitForTimeout(250);
  assert.equal(owned.board.state().versionId, v2.versionId);
  assert.equal((await operation("read")).hasUnsealedChanges, false);

  const capturedImage = operation("read", { target: v1.versionId, includeImage: true });
  const later = await operation("edit", { expectedVersionId: v2.versionId,
    operations: [{ op: "update", id: "node-1", set: { backgroundColor: "#e03131" } }] });
  const exactOldImage = await capturedImage;
  assert.equal(exactOldImage.versionId, v1.versionId);
  assert.equal(exactOldImage.image.dataURL, v1.image.dataURL);
  await assert.rejects(operation("edit", { expectedVersionId: v2.versionId, operations: [{ op: "remove", id: "label-1" }] }), (error) => error.status === 409);
  const preserved = structuredClone(owned.board.state());
  await assert.rejects(operation("edit", { expectedVersionId: later.versionId, operations: [
    { op: "update", id: "label-1", set: { text: "Must not commit" } }, { op: "remove", id: "missing" },
  ] }), (error) => error.status === 422);
  assert.deepEqual(owned.board.state(), preserved);

  const peer = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  peer.on("pageerror", (error) => pageErrors.push(error.message));
  await peer.goto(owned.info.url);
  await expect(peer.locator(".version")).toHaveAttribute("title", later.versionId);
  let arrived = false;
  const gate = new Promise((done) => { releasePeer = done; });
  await peer.route("**/edit", async (route) => { arrived = true; await gate; await route.continue(); });
  const peerBox = await peer.locator("canvas.interactive").boundingBox();
  await peer.mouse.dblclick(peerBox.x + resizedLabel.x + resizedLabel.width / 2, peerBox.y + resizedLabel.y + resizedLabel.height / 2);
  await expect(peer.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
  await peer.locator("textarea.excalidraw-wysiwyg").fill("Local pending peer edit");
  await peer.keyboard.press("Escape");
  await expect.poll(() => arrived).toBe(true);
  await operation("edit", { expectedVersionId: later.versionId, operations: [{ op: "update", id: "node-1", set: { strokeColor: "#1971c2" } }] });
  releasePeer();
  await expect(peer.getByRole("status", { exact: true })).toHaveText("Local conflict");
  const localDownload = peer.waitForEvent("download");
  await peer.getByRole("button", { name: "Download local edits", exact: true }).click();
  const download = await localDownload;
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const localCopy = JSON.parse(await readFile(path, "utf8"));
  assert.ok(localCopy.elements.some((element) => element.originalText === "Local pending peer edit"));
  assert.notEqual(owned.board.state().scene.elements.find((element) => element.id === "label-2").text, "Local pending peer edit");
  assert.deepEqual((await operation("read", { target: v1.versionId })).scene, v1.scene);
  assert.deepEqual((await operation("read", { target: v2.versionId })).scene, v2.scene);
  assert.deepEqual(pageErrors, []);
  const report = {
    isolatedUrl: owned.info.url, heldReviewsContacted: false, memoryOnly: true,
    baseline: baseline.versionId, V1: v1.versionId, V2: v2.versionId,
    nativeTextEditorReached: true, explicitShapeLabels: true, nodeMoveResizeCarriesLabelAndConnectors: true,
    beforeSealLatestWasV1WithPending: true, humanSealKeptWorkingId: true, V1Immutable: true,
    cameraSelectionOnlyNoVersionChange: true, imageMatchedCapturedSealDuringLaterEdit: true,
    staleAndAtomicBatchesRejected: true, localPeerConflictPreserved: true, semanticInterpretation: false,
    noBrowserDocumentPersistenceObserved: true,
  };
  await evidence("proof.json", report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  releasePeer();
  await browser.close();
  await owned.close();
}

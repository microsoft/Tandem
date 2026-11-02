import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startWhiteboard } from "../server.mjs";
import { connect } from "./example.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out;
if (out) await mkdir(out, { recursive: true });
const evidence = async (name, value) => {
  if (out) await writeFile(join(out, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
};
const owned = await startWhiteboard({ assetsRoot: fileURLToPath(new URL("../dist-controls/", import.meta.url)) });
let browser;
let releaseRender = () => {};
try {
  const operation = await connect(owned.info.url);
  const baseline = await operation("read");
  const emptySnapshot = await operation("snapshot");
  assert.equal(emptySnapshot.versionId, baseline.versionId);
  assert.equal(emptySnapshot.image.versionId, baseline.versionId);
  assert.equal(emptySnapshot.hasUnsealedChanges, false);
  const emptyState = owned.board.state();
  assert.equal(emptyState.sealedCount, 1);
  assert.equal(emptyState.scene.elements.length, 0);

  const draw = await operation("edit", { expectedVersionId: baseline.versionId, operations: [
    { op: "add", element: { id: "visible", type: "rectangle", x: 80, y: 180, width: 240, height: 140,
      backgroundColor: "#70a1ff", fillStyle: "solid" } },
    { op: "add", element: { id: "offscreen", type: "rectangle", x: 1800, y: 700, width: 240, height: 140,
      backgroundColor: "#68cfa2", fillStyle: "solid" } },
    { op: "add", element: { id: "ink", type: "freedraw", x: 400, y: 400, width: 160, height: 50,
      strokeColor: "#e03131", strokeWidth: 4, points: [[0, 0], [80, 50], [160, 0]] } },
  ] });
  await operation("seal", { expectedVersionId: draw.versionId });
  const v1 = await operation("read");
  browser = await chromium.launch({ headless: true,
    ...(process.platform === "win32" ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL ?? "msedge" } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(owned.info.url);
  await expect(page.getByRole("status", { exact: true })).toHaveText("Sealed");
  const canvas = await page.locator("canvas.interactive").boundingBox();
  await page.mouse.click(canvas.x + 180, canvas.y + 250);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForTimeout(100);
  const before = owned.board.state();
  const selectedSnapshot = await operation("snapshot");
  assert.equal(selectedSnapshot.versionId, v1.versionId);
  assert.equal(selectedSnapshot.image.versionId, v1.versionId);
  assert.ok(selectedSnapshot.image.width > 1900);
  assert.deepEqual(owned.board.state(), before);
  const pixelCounts = await page.evaluate(async (dataURL) => {
    const bitmap = await createImageBitmap(await (await fetch(dataURL)).blob());
    const output = document.createElement("canvas"); output.width = bitmap.width; output.height = bitmap.height;
    const context = output.getContext("2d"); context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, output.width, output.height).data;
    const counts = { visible: 0, offscreen: 0, ink: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 112 && pixels[i + 1] === 161 && pixels[i + 2] === 255) counts.visible++;
      if (pixels[i] === 104 && pixels[i + 1] === 207 && pixels[i + 2] === 162) counts.offscreen++;
      if (pixels[i] > 170 && pixels[i + 1] < 100 && pixels[i + 2] < 100) counts.ink++;
    }
    bitmap.close(); return counts;
  }, selectedSnapshot.image.dataURL);
  assert.ok(pixelCounts.visible > 10_000 && pixelCounts.offscreen > 10_000 && pixelCounts.ink > 100);
  const readImage = await operation("read", { target: v1.versionId, includeImage: true });
  assert.equal(readImage.image.dataURL, selectedSnapshot.image.dataURL);
  const renderOld = operation("snapshot", { target: v1.versionId });
  const newer = await operation("edit", { expectedVersionId: v1.versionId,
    operations: [{ op: "update", id: "visible", set: { backgroundColor: "#e03131" } }] });
  const capturedOld = await renderOld;
  assert.equal(capturedOld.versionId, v1.versionId);
  assert.equal(capturedOld.image.dataURL, selectedSnapshot.image.dataURL);
  const pending = await operation("snapshot");
  assert.equal(pending.versionId, v1.versionId);
  assert.equal(pending.hasUnsealedChanges, true);
  assert.equal(pending.image.dataURL, selectedSnapshot.image.dataURL);
  assert.equal(owned.board.state().versionId, newer.versionId);
  assert.equal(owned.board.state().sealedCount, before.sealedCount);
  await assert.rejects(operation("snapshot", { target: newer.versionId }), (error) => error.status === 404);
  await assert.rejects(operation("snapshot", { target: "missing" }), (error) => error.status === 404);
  await assert.rejects(operation("snapshot", { target: "live" }), (error) => error.status === 404);
  await assert.rejects(operation("snapshot", { target: null }), (error) => error.status === 400);
  await assert.rejects(operation("snapshot", { target: "latest", includeImage: true }), (error) => error.status === 400);

  // Delay only this test server's captured render response to force a later seal mid-snapshot.
  let renderWaiting = false;
  const renderGate = new Promise((done) => { releaseRender = done; });
  const holdCapture = (request, response) => {
    if (!request.url.startsWith("/render-job/")) return;
    owned.server.removeListener("request", holdCapture);
    const end = response.end;
    response.end = (...args) => {
      renderWaiting = true;
      void renderGate.then(() => end.apply(response, args));
      return response;
    };
  };
  owned.server.prependListener("request", holdCapture);
  const latestCapturedOnce = operation("snapshot");
  await expect.poll(() => renderWaiting).toBe(true);
  await operation("seal", { expectedVersionId: newer.versionId });
  releaseRender();
  const priorImage = await latestCapturedOnce;
  assert.equal(priorImage.versionId, v1.versionId);
  assert.equal(priorImage.image.versionId, v1.versionId);
  assert.equal(priorImage.image.dataURL, selectedSnapshot.image.dataURL);
  assert.equal(priorImage.hasUnsealedChanges, true);
  const v2Snapshot = await operation("snapshot");
  assert.equal(v2Snapshot.versionId, newer.versionId);
  assert.notEqual(v2Snapshot.image.dataURL, priorImage.image.dataURL);
  assert.equal((await operation("snapshot", { target: v1.versionId })).image.dataURL, selectedSnapshot.image.dataURL);
  const beforeCLI = owned.board.state();
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./whiteboard.mjs", import.meta.url)), "snapshot", "--url", owned.info.url,
  ], { encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024 });
  const cli = JSON.parse(stdout);
  assert.equal(cli.versionId, newer.versionId);
  assert.equal(cli.image.dataURL, v2Snapshot.image.dataURL);
  assert.deepEqual(owned.board.state(), beforeCLI);
  const exactArg = JSON.stringify({ target: v1.versionId });
  const exactCLI = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./whiteboard.mjs", import.meta.url)), "snapshot", "--url", owned.info.url, "--json", exactArg,
  ], { encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(JSON.parse(exactCLI.stdout).image.dataURL, selectedSnapshot.image.dataURL);
  await evidence("whole-diagram.png", Buffer.from(selectedSnapshot.image.dataURL.split(",")[1], "base64"));
  await evidence("latest-while-pending.json", pending);
  await evidence("proof.json", {
    isolatedUrl: owned.info.url, heldReviewContacted: false, temporaryServiceAndBrowsersClosedInFinally: true,
    emptySnapshot: true, defaultsLatestSeal: true, exactSealsRepeatable: true, pendingFlagNotDraft: true,
    missingUnsealedLiveTargetsFail: true, noImplicitSealOrMutation: true, readIncludeImageCompatible: true,
    offscreenUnselectedShapesAndInkIncluded: true, pixels: pixelCounts,
    oldSealPNGUnchangedDuringLaterEdits: true, cliDefaultAndExactTargetPassed: true,
    defaultLatestCapturedOnceDuringLaterSeal: true,
    dimensions: { width: selectedSnapshot.image.width, height: selectedSnapshot.image.height },
    baseline: baseline.versionId, V1: v1.versionId, V2: newer.versionId,
  });
  console.log("Snapshot: isolated whole-diagram API/CLI checks passed.");
} finally {
  releaseRender();
  await browser?.close();
  await owned.close();
}

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startWhiteboard } from "../server.mjs";
import { connect, flowElements } from "./example.mjs";
import { fingerprint } from "../shared/scene.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out;
if (out) await mkdir(out, { recursive: true });
const evidence = async (name, value) => {
  if (out) await writeFile(join(out, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
};
// Only this temporary store/server is exercised; a review URL cannot be supplied.
const owned = await startWhiteboard({ assetsRoot: fileURLToPath(new URL("../dist-controls/", import.meta.url)) });
let browser;
const releases = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.platform === "win32" ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL ?? "msedge" } : {}) });
  const operation = await connect(owned.info.url);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ready = async () => {
    await expect(page.locator(".version")).toHaveAttribute("title", owned.board.state().versionId);
    await expect(page.getByRole("button", { name: "Reset to latest sealed", exact: true })).toBeEnabled();
  };
  const reset = page.getByRole("button", { name: "Reset to latest sealed", exact: true });
  const fit = page.getByRole("button", { name: "Fit diagram", exact: true });
  const canvas = page.locator("canvas.interactive");
  await page.goto(owned.info.url);
  await ready();
  const empty = owned.board.state();
  await fit.click();
  await expect(page.locator(".whiteboard > footer")).toContainText("empty");
  assert.deepEqual(owned.board.state(), empty);
  await reset.click();
  await ready();
  assert.deepEqual(owned.board.state(), empty);
  await operation("edit", { expectedVersionId: empty.versionId, operations: [{
    op: "add", element: { id: "scratch", type: "text", x: 90, y: 170, width: 150, height: 23, text: "Not sealed" },
  }] });
  await ready();
  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Discard unsealed changes/);
    await dialog.accept();
  });
  await reset.click();
  await expect.poll(() => owned.board.state().scene.elements.length).toBe(0);
  await ready();
  assert.notEqual(owned.board.state().versionId, empty.versionId);
  assert.equal(owned.board.state().hasUnsealedChanges, true);
  assert.deepEqual(owned.board.read({ target: empty.versionId }).scene, empty.scene);

  const draw = await operation("edit", { expectedVersionId: owned.board.state().versionId,
    operations: flowElements().map((element) => ({ op: "add", element })) });
  await operation("seal", { expectedVersionId: draw.versionId });
  const v1 = await operation("read");
  await ready();
  await operation("edit", { expectedVersionId: v1.versionId, operations: [
    { op: "update", id: "node-2", set: { customData: { scratch: true }, backgroundColor: "#e03131" } },
    { op: "add", element: { id: "draft-note", type: "text", x: 200, y: 400, width: 180, height: 23, text: "Unsaved note" } },
  ] });
  await ready();
  const beforeCancel = owned.board.state();
  const beforeView = await page.locator("canvas.static").screenshot();
  page.once("dialog", (dialog) => dialog.dismiss());
  await reset.click();
  await ready();
  assert.deepEqual(owned.board.state(), beforeCancel);
  assert.deepEqual(await page.locator("canvas.static").screenshot(), beforeView);
  page.once("dialog", (dialog) => dialog.accept());
  await reset.click();
  await expect.poll(() => fingerprint(owned.board.state().scene)).toBe(fingerprint(v1.scene));
  await ready();
  const restored = owned.board.state();
  assert.notEqual(restored.versionId, beforeCancel.versionId);
  assert.notEqual(restored.versionId, v1.versionId);
  assert.equal(restored.hasUnsealedChanges, true);
  assert.equal(restored.latestSealedVersionId, v1.versionId);
  assert.equal(restored.sealedCount, beforeCancel.sealedCount);
  assert.deepEqual((await operation("read", { target: v1.versionId })).scene, v1.scene);
  await reset.click(); await ready();
  assert.equal(owned.board.state().versionId, restored.versionId);

  await operation("seal", { expectedVersionId: restored.versionId });
  const laterSeal = await operation("read");
  const laterDraft = await operation("edit", { expectedVersionId: laterSeal.versionId,
    operations: [{ op: "update", id: "label-2", set: { text: "A newer draft" } }] });
  await ready();
  let intercepted = false, release;
  const gate = new Promise((done) => { release = done; releases.push(done); });
  await page.route("**/edit", async (route) => {
    if (route.request().postDataJSON().expectedLatestSealedVersionId) { intercepted = true; await gate; }
    await route.continue();
  });
  page.once("dialog", (dialog) => dialog.accept());
  const resetting = reset.click();
  await expect.poll(() => intercepted).toBe(true);
  await operation("seal", { expectedVersionId: laterDraft.versionId });
  const peerSealed = owned.board.state();
  release(); await resetting;
  await expect(page.getByRole("alert")).toContainText("Latest sealed version changed");
  await ready();
  assert.deepEqual(owned.board.state(), peerSealed);
  await page.unroute("**/edit");

  await operation("edit", { expectedVersionId: peerSealed.versionId,
    operations: [{ op: "update", id: "node-1", set: { backgroundColor: "#fff3bf" } }] });
  await ready();
  let duringConfirm;
  page.once("dialog", async (dialog) => {
    await operation("edit", { expectedVersionId: owned.board.state().versionId,
      operations: [{ op: "update", id: "node-3", set: { backgroundColor: "#a5d8ff" } }] });
    duringConfirm = owned.board.state();
    await dialog.accept();
  });
  await reset.click();
  await expect(page.getByRole("alert")).toContainText("Working version changed");
  await ready();
  assert.deepEqual(owned.board.state(), duringConfirm);
  assert.deepEqual((await operation("read", { target: laterSeal.versionId })).scene, laterSeal.scene);
  assert.deepEqual((await operation("read", { target: v1.versionId })).scene, v1.scene);

  // A sending native edit cannot be silently discarded by clicking Reset.
  await page.reload(); await ready();
  let sending = false, resume;
  const sendingGate = new Promise((done) => { resume = done; releases.push(done); });
  await page.route("**/edit", async (route) => { sending = true; await sendingGate; await route.continue(); });
  const box = await canvas.boundingBox();
  await page.mouse.dblclick(box.x + 490, box.y + 230);
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
  await page.locator("textarea.excalidraw-wysiwyg").fill("Native pending edit");
  await page.keyboard.press("Escape");
  await expect.poll(() => sending).toBe(true);
  await expect(reset).toBeDisabled();
  resume();
  await expect.poll(() => owned.board.state().scene.elements.find((element) => element.id === "label-2").text).toBe("Native pending edit");
  await ready(); await page.unroute("**/edit");

  // Fit must include distant shapes, standalone text and ink, not only a selected item.
  const spread = [
    { id: "left", type: "rectangle", x: -1100, y: -400, width: 240, height: 160, backgroundColor: "#70a1ff", fillStyle: "solid" },
    { id: "right", type: "rectangle", x: 1800, y: 800, width: 240, height: 160, backgroundColor: "#68cfa2", fillStyle: "solid" },
    { id: "far-text", type: "text", x: 2000, y: -500, width: 270, height: 37, fontSize: 32, text: "Include all text", strokeColor: "#b400b4", fontFamily: 2 },
    { id: "far-ink", type: "freedraw", x: 0, y: 1400, width: 800, height: 200, points: [[0, 0], [400, 200], [800, 0]], strokeColor: "#e03131", strokeWidth: 3 },
  ];
  const wide = await operation("edit", { expectedVersionId: owned.board.state().versionId,
    operations: spread.map((element) => ({ op: "add", element })) });
  await operation("seal", { expectedVersionId: wide.versionId });
  await ready();
  const beforeFit = owned.board.state();
  async function pixels() {
    return page.locator("canvas.static").evaluate((canvas) => {
      const { width, height } = canvas, ctx = canvas.getContext("2d"), data = ctx.getImageData(0, 0, width, height).data;
      const targets = { left: [112, 161, 255], right: [104, 207, 162], text: [180, 0, 180], ink: [224, 49, 49] };
      return Object.fromEntries(Object.entries(targets).map(([name, rgb]) => {
        const found = { count: 0, x1: width, y1: height, x2: -1, y2: -1, width, height };
        for (let i = 0; i < data.length; i += 4) {
          const matches = name === "text"
            ? data[i] > data[i + 1] + 40 && data[i + 2] > data[i + 1] + 40 && data[i + 1] < 180
            : name === "ink"
              ? data[i] > data[i + 1] + 65 && data[i] > data[i + 2] + 65
              : rgb.every((value, channel) => data[i + channel] === value);
          if (!matches) continue;
          const x = (i / 4) % width, y = Math.floor(i / 4 / width);
          found.count++; found.x1 = Math.min(found.x1, x); found.y1 = Math.min(found.y1, y);
          found.x2 = Math.max(found.x2, x); found.y2 = Math.max(found.y2, y);
        }
        return [name, found];
      }));
    });
  }
  await fit.click();
  await expect.poll(async () => (await pixels()).left.count).toBeGreaterThan(100);
  const firstFit = await pixels();
  await page.getByRole("radio", { name: "Selection", exact: true }).locator("..").click();
  const selectionBox = await canvas.boundingBox();
  await page.mouse.click(selectionBox.x + (firstFit.left.x1 + firstFit.left.x2) / 2,
    selectionBox.y + (firstFit.left.y1 + firstFit.left.y2) / 2);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await fit.click();
  await expect.poll(async () => (await pixels()).right.count).toBeGreaterThan(100);
  await page.waitForTimeout(100);
  const fitted = await pixels();
  await evidence("fit-pixels.json", fitted);
  if (out) await page.screenshot({ path: join(out, "whole-diagram-fit.png") });
  for (const [name, visible] of Object.entries(fitted)) {
    assert.ok(visible.count > 10, `${name} was not rendered in the fitted viewport.`);
    assert.ok(visible.x1 > 16 && visible.y1 > 60 && visible.x2 < visible.width - 16 && visible.y2 < visible.height - 30, `${name} lost viewport padding.`);
  }
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  assert.deepEqual(owned.board.state(), beforeFit);
  assert.deepEqual((await operation("read", { target: wide.versionId })).scene, wide.scene);
  await page.setViewportSize({ width: 360, height: 740 });
  for (const name of ["Fit diagram", "Reset to latest sealed", "Seal version"]) {
    const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 360, `Header overflows at ${name}.`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (out) await page.screenshot({ path: join(out, "narrow-header.png") });
  assert.deepEqual(errors, []);
  await evidence("proof.json", {
    isolatedUrl: owned.info.url, heldReviewContacted: false, assets: "dist-controls",
    freshEmptyFitAndResetNoOp: true, resetToEmptySeal: true, cancelPreservedContentVersionAndCanvas: true,
    resetRestoredExactCanonicalContent: true, removedOptionalMetadata: true, oldSealsImmutable: true,
    changedResetNewWorkingIdAndUnsealed: true, repeatedResetNoOp: true,
    newerSealSameWorkingIdRejected: true, contentChangeDuringConfirmationRejected: true,
    sendingEditResetDisabled: true, wholeDiagramFitIncludingTextAndInk: true,
    fitPreservedSelectionContentVersionAndSeals: true, narrowHeaderFits: true,
    temporaryServiceAndBrowsersClosedInFinally: true,
  });
  console.log("Reset/fit controls: isolated real-browser checks passed.");
} finally {
  for (const release of releases) release();
  await browser?.close();
  await owned.close();
}

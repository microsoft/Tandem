import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startWhiteboard } from "../server.mjs";
import { connect, flowElements } from "./example.mjs";
import { canonicalScene, fingerprint } from "../shared/scene.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out;
if (out) await mkdir(out, { recursive: true });
const evidence = async (name, value) => {
  if (out) await writeFile(join(out, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
};
const owned = await startWhiteboard({ assetsRoot: fileURLToPath(new URL("../dist-topics/", import.meta.url)) });
let browser;
const releases = [];
try {
  const defaultOperation = await connect(owned.info.url);
  const defaultBefore = owned.board.state();
  browser = await chromium.launch({ headless: true,
    ...(process.platform === "win32" ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL ?? "msedge" } : {}) });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(owned.info.url);
  const selector = page.getByRole("combobox", { name: "Discussion topic" });
  const ready = async (id) => {
    await expect(selector).toHaveValue(id);
    await expect(page.locator(".version")).toHaveAttribute("title", owned.topics.state(id).versionId);
    await expect(selector).toBeEnabled();
  };
  await ready("default");
  page.once("dialog", (dialog) => dialog.accept("Architecture"));
  await page.getByRole("button", { name: "New topic", exact: true }).click();
  await expect(selector.locator("option", { hasText: "Architecture" })).toHaveCount(1);
  await expect(selector).toHaveValue("default");
  const a = owned.topics.list().topics.find((topic) => topic.name === "Architecture");
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./whiteboard.mjs", import.meta.url)), "create-topic", "--url", owned.info.url,
    "--json", JSON.stringify({ name: "Branching flow" }),
  ], { encoding: "utf8", timeout: 10_000 });
  const b = JSON.parse(stdout);
  const listed = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./whiteboard.mjs", import.meta.url)), "topics", "--url", owned.info.url,
  ], { encoding: "utf8", timeout: 10_000 });
  assert.equal(JSON.parse(listed.stdout).topics.length, 3);
  await expect(selector.locator("option", { hasText: "Branching flow" })).toHaveCount(1);
  const opA = await connect(owned.info.url, a.topicId), opB = await connect(owned.info.url, b.topicId);
  const baselineA = await opA("read"), baselineB = await opB("read");
  const drawA = await opA("edit", { expectedVersionId: baselineA.versionId,
    operations: flowElements().map((element) => ({ op: "add", element })) });
  await opA("seal", { expectedVersionId: drawA.versionId });
  const v1A = await opA("read");
  const drawB = await opB("edit", { expectedVersionId: baselineB.versionId,
    operations: flowElements().map((element) => ({ op: "add", element: {
      ...element, x: element.x + 600, y: element.y + 250,
      ...(element.type === "text" ? { text: `B ${element.text}` } : {}),
      ...(element.type === "rectangle" ? { backgroundColor: "#fff3bf" } : {}),
    } })) });
  await opB("seal", { expectedVersionId: drawB.versionId });
  const v1B = await opB("read");
  const bBefore = owned.topics.state(b.topicId);
  await selector.selectOption(a.topicId); await ready(a.topicId);
  assert.equal((await defaultOperation("read")).topicId, "default");
  assert.deepEqual(owned.board.state(), defaultBefore);
  const canvas = page.locator("canvas.interactive");
  let box = await canvas.boundingBox();
  await page.mouse.dblclick(box.x + 490, box.y + 230);
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
  await expect(selector).toBeDisabled();
  await page.locator("textarea.excalidraw-wysiwyg").fill("A human draft");
  await page.keyboard.press("Escape");
  await expect.poll(() => owned.topics.state(a.topicId).scene.elements.find((element) => element.id === "label-2").text).toBe("A human draft");
  await ready(a.topicId);
  const draftA = owned.topics.state(a.topicId);
  assert.equal((await opA("read")).versionId, v1A.versionId);
  assert.equal((await opA("read")).hasUnsealedChanges, true);
  assert.equal((await opB("read")).hasUnsealedChanges, false);
  await selector.selectOption(b.topicId); await ready(b.topicId);
  assert.deepEqual(owned.topics.state(b.topicId), bBefore);
  await selector.selectOption(a.topicId); await ready(a.topicId);
  assert.deepEqual(owned.topics.state(a.topicId), draftA);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Seal version", exact: true }).click();
  await expect(page.getByRole("status", { exact: true })).toHaveText("Sealed");
  const v2A = await opA("read", { compareTo: v1A.versionId });
  assert.equal(v2A.topicId, a.topicId);
  assert.equal(v2A.versionId, draftA.versionId);
  assert.ok(v2A.changes.changed.some((change) => change.id === "label-2" && change.fields.some((field) => field.path === "text" && field.after === "A human draft")));
  assert.deepEqual(owned.topics.state(b.topicId), bBefore);
  await assert.rejects(opB("read", { target: v2A.versionId }), (error) => error.status === 404);
  await assert.rejects(opB("read", { compareTo: v1A.versionId }), (error) => error.status === 404);
  await assert.rejects(opB("seal", { expectedVersionId: v2A.versionId }), (error) => error.status === 409);
  await assert.rejects(opA("edit", { expectedVersionId: v1A.versionId, operations: [] }), (error) => error.status === 409);
  const invalid = await connect(owned.info.url, "missing");
  await assert.rejects(invalid("read"), (error) => error.status === 404);
  const imageA = await opA("snapshot"), imageB = await opB("snapshot");
  assert.equal(imageA.topicId, a.topicId); assert.equal(imageA.image.topicId, a.topicId);
  assert.equal(imageB.topicId, b.topicId); assert.equal(imageB.image.topicId, b.topicId);
  assert.notEqual(imageA.image.dataURL, imageB.image.dataURL);
  await evidence("topic-A.png", Buffer.from(imageA.image.dataURL.split(",")[1], "base64"));
  await evidence("topic-B.png", Buffer.from(imageB.image.dataURL.split(",")[1], "base64"));
  await evidence("topic-A-diff.json", v2A);

  // An explicit A API edit must not follow the human's selection of B.
  await selector.selectOption(b.topicId); await ready(b.topicId);
  const aLater = await opA("edit", { expectedVersionId: v2A.versionId,
    operations: [{ op: "update", id: "node-1", set: { backgroundColor: "#a5d8ff" } }] });
  await page.waitForTimeout(100);
  await expect(selector).toHaveValue(b.topicId);
  await expect(page.locator(".version")).toHaveAttribute("title", v1B.versionId);
  assert.deepEqual(owned.topics.state(b.topicId), bBefore);
  assert.equal((await opA("snapshot")).versionId, v2A.versionId);
  assert.equal((await opA("snapshot")).hasUnsealedChanges, true);
  assert.equal((await opB("snapshot")).image.dataURL, imageB.image.dataURL);
  const explicitCLI = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./whiteboard.mjs", import.meta.url)), "read", "--url", owned.info.url, "--topic", a.topicId,
  ], { encoding: "utf8", timeout: 10_000 });
  assert.equal(JSON.parse(explicitCLI.stdout).topicId, a.topicId);
  assert.equal((await defaultOperation("read")).topicId, "default");
  assert.deepEqual(owned.board.state(), defaultBefore);

  // Reset/Fit operate on selected B only; A's pending drawing and all its seals stay untouched.
  await opB("edit", { expectedVersionId: v1B.versionId,
    operations: [{ op: "update", id: "label-2", set: { text: "B unsealed change" } }] });
  await ready(b.topicId);
  const beforeResetA = owned.topics.state(a.topicId);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset to latest sealed", exact: true }).click();
  await expect.poll(() => fingerprint(owned.topics.state(b.topicId).scene)).toBe(fingerprint(v1B.scene));
  await ready(b.topicId);
  assert.deepEqual(owned.topics.state(a.topicId), beforeResetA);
  assert.equal(owned.topics.state(b.topicId).hasUnsealedChanges, true);
  const beforeFitA = owned.topics.state(a.topicId), beforeFitB = owned.topics.state(b.topicId);
  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  await page.waitForTimeout(100);
  assert.deepEqual(owned.topics.state(a.topicId), beforeFitA);
  assert.deepEqual(owned.topics.state(b.topicId), beforeFitB);
  await page.getByTestId("main-menu-trigger").click();
  await expect(page.getByRole("button", { name: "Download explicit local copy", exact: true })).toBeVisible();
  const localExport = page.waitForEvent("download").catch(() => null);
  await page.getByRole("button", { name: "Download explicit local copy", exact: true }).click();
  const downloaded = await localExport;
  assert.ok(downloaded, "Expected the explicit native canvas download.");
  const localPath = await downloaded.path();
  const localScene = JSON.parse(await readFile(localPath, "utf8"));
  assert.deepEqual(canonicalScene(localScene), beforeFitB.scene);
  if (out) await page.screenshot({ path: join(out, "selected-topic-B.png") });

  // The pending UI request is explicitly scoped to A and switching is held until acknowledgement.
  await selector.selectOption(a.topicId); await ready(a.topicId);
  let intercepted = false, release, sentTopicId;
  const gate = new Promise((done) => { release = done; releases.push(done); });
  await page.route("**/edit", async (route) => {
    sentTopicId = route.request().postDataJSON().topicId;
    intercepted = true; await gate; await route.continue();
  });
  box = await canvas.boundingBox();
  await page.mouse.dblclick(box.x + 490, box.y + 230);
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
  await page.locator("textarea.excalidraw-wysiwyg").fill("A queued edit");
  await page.keyboard.press("Escape");
  await expect.poll(() => intercepted).toBe(true);
  assert.equal(sentTopicId, a.topicId);
  await expect(selector).toBeDisabled();
  await expect(page.getByRole("button", { name: "New topic", exact: true })).toBeDisabled();
  assert.equal(owned.topics.state(a.topicId).versionId, aLater.versionId);
  const bDuringARequest = owned.topics.state(b.topicId);
  release();
  await expect.poll(() => owned.topics.state(a.topicId).scene.elements.find((element) => element.id === "label-2").text).toBe("A queued edit");
  await ready(a.topicId); await page.unroute("**/edit");
  await selector.selectOption(b.topicId); await ready(b.topicId);
  assert.deepEqual(owned.topics.state(b.topicId), bDuringARequest);
  await selector.selectOption(a.topicId); await ready(a.topicId);
  assert.equal(owned.topics.state(a.topicId).scene.elements.find((element) => element.id === "label-2").text, "A queued edit");

  // Conflicted unsent input cannot disappear behind a topic switch either.
  let reached = false, continueConflict;
  const conflictGate = new Promise((done) => { continueConflict = done; releases.push(done); });
  await page.route("**/edit", async (route) => { reached = true; await conflictGate; await route.continue(); });
  box = await canvas.boundingBox();
  await page.mouse.dblclick(box.x + 490, box.y + 230);
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
  await page.locator("textarea.excalidraw-wysiwyg").fill("A local conflict must stay");
  await page.keyboard.press("Escape");
  await expect.poll(() => reached).toBe(true);
  await opA("edit", { expectedVersionId: owned.topics.state(a.topicId).versionId,
    operations: [{ op: "update", id: "node-1", set: { strokeColor: "#1971c2" } }] });
  continueConflict();
  await expect(page.getByRole("status", { exact: true })).toHaveText("Local conflict");
  await expect(selector).toBeDisabled();
  await expect(page.getByRole("button", { name: "New topic", exact: true })).toBeDisabled();
  const pendingExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download local edits", exact: true }).click();
  const pendingCopy = JSON.parse(await readFile(await (await pendingExport).path(), "utf8"));
  assert.ok(pendingCopy.elements.some((element) => element.originalText === "A local conflict must stay"));
  assert.deepEqual(owned.topics.state(b.topicId), bDuringARequest);
  assert.deepEqual((await opA("read", { target: v1A.versionId })).scene, v1A.scene);
  assert.deepEqual((await opB("read", { target: v1B.versionId })).scene, v1B.scene);
  assert.deepEqual(errors, []);
  await evidence("proof.json", {
    isolatedUrl: owned.info.url, heldReviewContacted: false, temporaryServiceAndBrowsersClosedInFinally: true,
    topics: [a, b], originalDefaultUnchanged: true, uiCreateAndCliListCreateRead: true,
    sameElementIdsIndependentAcrossTopics: true, workingDraftSwitchRoundTripPreserved: true,
    topicScopedSealsPendingDiffsAndSnapshots: true, crossTopicVersionsRejected: true,
    explicitAWriteWhileHumanSelectsBStayedInA: true, omittedTopicAlwaysFixedDefault: true,
    selectedTopicOnlyResetAndFit: true, pendingAndConflictedSwitchBlockedWithoutDiscard: true,
    nativeUndoDoesNotCrossTopicBoundary: true, noSourceFilesOrPersistence: true,
  });
  console.log("Named topics: isolated API/CLI/browser checks passed.");
} finally {
  for (const release of releases) release();
  await browser?.close();
  await owned.close();
}

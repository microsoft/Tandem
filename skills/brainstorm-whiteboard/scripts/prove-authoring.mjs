import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startWhiteboard } from "../server.mjs";
import { connect } from "./example.mjs";
import { recipes } from "./cookbook.mjs";
import { addLabeledBox } from "../shared/authoring.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out;
if (!out) throw new Error("Provide --out for this bounded authoring proof's explicit request/image evidence.");
await mkdir(out, { recursive: true });
const record = (name, value) => writeFile(join(out, name), Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
const owned = await startWhiteboard({ assetsRoot: fileURLToPath(new URL("../dist-authoring/", import.meta.url)) });
let browser;
try {
  const headers = { "Content-Type": "application/json", "x-whiteboard-instance": owned.info.instanceId };
  async function topic(name) {
    const response = await fetch(new URL("/topics", owned.info.url), { method: "POST", headers, body: JSON.stringify({ name }) });
    assert.equal(response.status, 201); return response.json();
  }
  async function apply(operation, name) {
    const current = await operation("read");
    assert.equal(current.hasUnsealedChanges, false);
    const request = { expectedVersionId: current.versionId, operations: recipes[name](current.scene) };
    const result = await operation("edit", request);
    await operation("seal", { expectedVersionId: result.versionId });
    return result;
  }
  const branch = await topic("Native branching composition"), branchAPI = await connect(owned.info.url, branch.topicId);
  const branchEdit = await apply(branchAPI, "branch");
  assert.equal(branchEdit.effects.added.length, 11);
  const branchRead = await branchAPI("read", { target: branchEdit.versionId, includeImage: true });
  assert.equal(branchRead.hasUnsealedChanges, false);
  assert.equal(branchRead.scene.elements.find(({ id }) => id === "branch-review-changes").startBinding.elementId, "branch-review");
  await record("branch-read.json", branchRead);
  await record("branch.png", Buffer.from(branchRead.image.dataURL.split(",")[1], "base64"));
  const flow = await topic("Cookbook operations"), flowAPI = await connect(owned.info.url, flow.topicId);
  const initialFlow = await flowAPI("read");
  const seeded = await flowAPI("edit", { expectedVersionId: initialFlow.versionId, operations: [
    { op: "add", element: { id: "peer-ink", type: "freedraw", x: 100, y: 460, width: 120, height: 20,
      points: [[0, 0], [60, 20], [120, 0]], customData: { human: { note: "Keep" } } } },
  ] });
  await flowAPI("seal", { expectedVersionId: seeded.versionId });
  const peerInk = seeded.scene.elements.find((element) => element.id === "peer-ink");
  const flowFirst = await apply(flowAPI, "flow");
  const flowOriginal = await flowAPI("read");
  const inserted = await apply(flowAPI, "insert");
  assert.equal(inserted.effects.added.length, 3);
  assert.equal(inserted.scene.elements.find((element) => element.id === "request-decision").endBinding.elementId, "review");
  const renamed = await apply(flowAPI, "rename");
  assert.equal(renamed.scene.elements.find((element) => element.id === "review-label").text, "Discuss together");
  const moved = await apply(flowAPI, "move");
  assert.equal(moved.effects.added.length, 0); assert.equal(moved.effects.removed.length, 0);
  assert.ok(moved.effects.changed.some((change) => change.id === "request-decision" && change.fields.some((field) => field.path === "points")));
  const removed = await apply(flowAPI, "remove");
  assert.equal(removed.effects.removed.length, 4);
  assert.deepEqual(removed.scene.elements.find((element) => element.id === "peer-ink"), peerInk);
  assert.deepEqual((await flowAPI("read", { target: flowOriginal.versionId })).scene, flowOriginal.scene);
  const flowDiff = await flowAPI("read", { compareTo: flowFirst.versionId });
  await record("flow-recipe-effects.json", { inserted: inserted.effects, renamed: renamed.effects, moved: moved.effects, removed: removed.effects });
  await record("flow-final-read.json", flowDiff);

  const ux = await topic("Native UX cookbook"), uxAPI = await connect(owned.info.url, ux.topicId);
  const empty = await uxAPI("read");
  const user = await uxAPI("edit", { expectedVersionId: empty.versionId, operations: [
    { op: "add", element: { id: "peer-note", type: "text", x: 80, y: 820, width: 600, height: 23,
      text: "Human input remains here; the sketch is not a website.", customData: { human: { note: "Preserve exact metadata" } } } },
  ] });
  const unknown = await uxAPI("edit", { expectedVersionId: user.versionId, operations: addLabeledBox(user.scene,
    { id: "peer-new", labelId: "peer-new-label", text: "new", x: 900, y: 820, width: 200, height: 70, fill: "#ffd8a8" }) });
  await uxAPI("seal", { expectedVersionId: unknown.versionId });
  const current = await uxAPI("read");
  await record("ux-current.json", current);
  const recipeRequest = join(out, "ux-create-request.json");
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./cookbook.mjs", import.meta.url)), "ux", "--read", join(out, "ux-current.json"), "--out", recipeRequest,
  ], { encoding: "utf8", timeout: 10_000 });
  const emitted = JSON.parse(await readFile(recipeRequest, "utf8"));
  assert.equal(emitted.topicId, ux.topicId); assert.equal(emitted.expectedVersionId, current.versionId);
  const created = await uxAPI("edit", emitted);
  assert.equal(created.effects.added.length, 15);
  await uxAPI("seal", { expectedVersionId: created.versionId });
  const uxFirst = await uxAPI("read", { includeImage: true });
  await record("ux-before.png", Buffer.from(uxFirst.image.dataURL.split(",")[1], "base64"));
  const originalUserIds = new Set(["peer-note", "peer-new", "peer-new-label"]);
  const preservedUser = uxFirst.scene.elements.filter((element) => originalUserIds.has(element.id));
  assert.ok(uxFirst.scene.elements.filter((element) => element.type === "text" && element.id.startsWith("ux-")).every((element) => element.containerId));

  browser = await chromium.launch({ headless: true,
    ...(process.platform === "win32" ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL ?? "msedge" } : {}) });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(owned.info.url);
  const selector = page.getByRole("combobox", { name: "Discussion topic" });
  await expect(selector).toBeEnabled();
  await selector.selectOption(ux.topicId);
  await expect(page.locator(".version")).toHaveAttribute("title", owned.topics.state(ux.topicId).versionId);
  await expect(selector).toBeEnabled();
  let box = await page.locator("canvas.interactive").boundingBox();
  const name = owned.topics.state(ux.topicId).scene.elements.find((element) => element.id === "ux-name");
  await page.mouse.dblclick(box.x + name.x + name.width / 2, box.y + name.y + name.height / 2);
  await expect(page.locator("textarea.excalidraw-wysiwyg")).toBeVisible();
  await page.locator("textarea.excalidraw-wysiwyg").fill("Display name\nAda");
  await page.keyboard.press("Escape");
  await expect.poll(() => owned.topics.state(ux.topicId).scene.elements.find((element) => element.id === "ux-name-label").text).toBe("Display name\nAda");
  await expect(selector).toBeEnabled();
  await page.getByRole("radio", { name: "Selection", exact: true }).locator("..").click();
  await page.locator("canvas.interactive").click({ position: { x: 1270, y: 950 } });
  const beforeMove = owned.topics.state(ux.topicId).scene;
  const button = beforeMove.elements.find((element) => element.id === "ux-primary");
  await page.mouse.move(box.x + button.x + button.width - 15, box.y + button.y + button.height - 15);
  await page.mouse.down(); await page.mouse.move(box.x + button.x + button.width + 5, box.y + button.y + button.height - 40, { steps: 15 }); await page.mouse.up();
  await expect.poll(() => owned.topics.state(ux.topicId).scene.elements.find((element) => element.id === "ux-primary").x).toBeCloseTo(button.x + 20, 0);
  await expect(selector).toBeEnabled();
  const afterMove = owned.topics.state(ux.topicId).scene;
  assert.equal(afterMove.elements.find((element) => element.id === "ux-primary-label").containerId, "ux-primary");
  assert.notDeepEqual(afterMove.elements.find((element) => element.id === "ux-save-preview").points,
    beforeMove.elements.find((element) => element.id === "ux-save-preview").points);
  await page.getByRole("radio", { name: "Draw", exact: true }).locator("..").click();
  await page.getByTestId("color-top-pick-#e03131").first().click();
  await page.mouse.move(box.x + 700, box.y + 560); await page.mouse.down();
  await page.mouse.move(box.x + 760, box.y + 585, { steps: 12 }); await page.mouse.move(box.x + 820, box.y + 550, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => owned.topics.state(ux.topicId).scene.elements.filter((element) => element.type === "freedraw").length).toBe(1);
  await expect(selector).toBeEnabled();
  const beforeHumanSeal = await uxAPI("read");
  assert.equal(beforeHumanSeal.versionId, uxFirst.versionId);
  assert.equal(beforeHumanSeal.hasUnsealedChanges, true);
  await page.getByRole("button", { name: "Seal version", exact: true }).click();
  await expect(page.getByRole("status", { exact: true })).toHaveText("Sealed");
  const human = await uxAPI("read", { compareTo: uxFirst.versionId, includeImage: true });
  const ink = human.scene.elements.find((element) => element.type === "freedraw");
  assert.ok(human.changes.changed.some((change) => change.id === "ux-name-label"));
  assert.ok(human.changes.changed.some((change) => change.id === "ux-primary"));
  assert.deepEqual(human.scene.elements.filter((element) => originalUserIds.has(element.id)), preservedUser);
  const request = { topicId: ux.topicId, expectedVersionId: human.versionId, operations: recipes["ux-edit"](human.scene) };
  await record("ux-refinement-request.json", request);
  const refined = await uxAPI("edit", request);
  await uxAPI("seal", { expectedVersionId: refined.versionId });
  const result = await uxAPI("read", { compareTo: human.versionId, includeImage: true });
  assert.equal(refined.effects.added.length, 0); assert.equal(refined.effects.removed.length, 0);
  assert.equal(result.scene.elements.find((element) => element.id === "ux-primary-label").text, "Save settings");
  assert.equal(result.scene.elements.find((element) => element.id === "ux-name-label").text, "Display name\nAda");
  assert.deepEqual(result.scene.elements.find((element) => element.id === ink.id), ink);
  assert.deepEqual(result.scene.elements.filter((element) => originalUserIds.has(element.id)), preservedUser);
  assert.deepEqual((await uxAPI("read", { target: uxFirst.versionId })).scene, uxFirst.scene);
  await assert.rejects(uxAPI("edit", request), (error) => error.status === 409);
  await expect(page.locator(".version")).toHaveAttribute("title", owned.topics.state(ux.topicId).versionId);
  await record("ux-after.png", Buffer.from(result.image.dataURL.split(",")[1], "base64"));
  await record("human-visual-read.json", human);
  await record("ux-refined-read.json", result);
  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  await page.screenshot({ path: join(out, "ux-editor.png") });
  const pixels = await page.evaluate(async (dataURL) => {
    const bitmap = await createImageBitmap(await (await fetch(dataURL)).blob());
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 170 && data[i + 1] < 110 && data[i + 2] < 110) red++;
      if (data[i] < 100 && data[i + 1] < 120 && data[i + 2] < 150) dark++;
    }
    return { red, dark, width: bitmap.width, height: bitmap.height };
  }, result.image.dataURL);
  assert.ok(pixels.red > 50 && pixels.dark > 5000);
  assert.deepEqual(errors, []);
  await record("proof.json", {
    isolatedUrl: owned.info.url, heldReviewsContacted: false, temporaryServiceAndBrowsersClosedInFinally: true,
    flowRecipeOperationsTested: ["create", "insert/rewire", "rename same label ID", "move/resize bound geometry", "explicit node deletion"],
    actualCookbookCLIPayloadExecuted: true, nativeUXObjectsAdded: 15, nativeUXTextEditorReached: true,
    nativeBranchRecipeAddedElevenObjectsWithTwoOutcomes: true, exactBranchSealRendered: branchRead.versionId,
    humanNameAndButtonMoveAndInkRead: true, ambiguousNewBoxPreservedNotInterpreted: true,
    agentRefinementPreservedHumanEditsAndUnrelatedMetadata: true,
    boundConnectorMovedWithHumanButton: true, stableIDsAndImmutablePriorSeals: true, staleRecipeRejected: true,
    images: { before: "ux-before.png", after: "ux-after.png", editor: "ux-editor.png" }, pixels,
    dependencies: "Prepared only canonical source after missing tsc; existing package lock/dependency versions unchanged.",
  });
  console.log("Agent authoring reference/cookbook: isolated store/API/native UX proof passed.");
} finally {
  await browser?.close();
  await owned.close();
}

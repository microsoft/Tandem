import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createBoard } from "../shared/store.mjs";
import { operationsBetween } from "../shared/scene.mjs";
import { addLabeledBox, connectNodes, deleteNode, moveResizeNode, renameLabel } from "../shared/authoring.mjs";

// Stage native batches locally for composition; only the returned operations reach the real board.
function batch(scene, steps) {
  const draft = createBoard();
  draft.edit({ expectedVersionId: draft.state().versionId, operations: scene.elements.map((element) => ({ op: "add", element })) });
  for (const step of steps) {
    const current = draft.state();
    draft.edit({ expectedVersionId: current.versionId, operations: step(current.scene) });
  }
  return operationsBetween(scene, draft.state().scene);
}
export const recipes = {
  flow(scene) {
    return batch(scene, [
      (s) => addLabeledBox(s, { id: "request", labelId: "request-label", text: "Request", x: 80, y: 180, width: 220, height: 110 }),
      (s) => addLabeledBox(s, { id: "decision", labelId: "decision-label", text: "Decide", x: 700, y: 180, width: 220, height: 110 }),
      (s) => connectNodes(s, { id: "request-decision", fromId: "request", toId: "decision" }),
    ]);
  },
  insert(scene) {
    return batch(scene, [
      (s) => addLabeledBox(s, { id: "review", labelId: "review-label", text: "Review", x: 390, y: 180, width: 220, height: 110 }),
      (s) => connectNodes(s, { id: "request-decision", fromId: "request", toId: "review" }),
      (s) => connectNodes(s, { id: "review-decision", fromId: "review", toId: "decision" }),
    ]);
  },
  rename(scene) { return renameLabel(scene, "review-label", "Discuss together"); },
  move(scene) { return moveResizeNode(scene, "review", { x: 390, y: 340, width: 250, height: 130 }); },
  remove(scene) { return deleteNode(scene, "review"); },
  ux(scene) {
    const specifications = [
      { id: "ux-screen", labelId: "ux-title", text: "Settings / rough UX sketch", x: 50, y: 60, width: 1130, height: 700, fill: "#f8f9fa", fontSize: 24, align: "left", vertical: "top" },
      { id: "ux-nav", labelId: "ux-nav-label", text: "Workspace\n\nGeneral\nTeam\nNotifications", x: 80, y: 150, width: 220, height: 550, fill: "#edf3fb", align: "left", vertical: "top" },
      { id: "ux-name", labelId: "ux-name-label", text: "Display name\nSam", x: 340, y: 170, width: 450, height: 100, fill: "#ffffff", align: "left" },
      { id: "ux-email", labelId: "ux-email-label", text: "Email\nsam@example.test", x: 340, y: 300, width: 450, height: 100, fill: "#ffffff", align: "left" },
      { id: "ux-notify", labelId: "ux-notify-label", text: "Notifications\n[ ] Email me updates", x: 340, y: 430, width: 450, height: 100, fill: "#ffffff", align: "left" },
      { id: "ux-primary", labelId: "ux-primary-label", text: "Save", x: 360, y: 610, width: 250, height: 70, fill: "#d3ebda" },
      { id: "ux-preview", labelId: "ux-preview-label", text: "Preview\n\nChanges shown here", x: 850, y: 420, width: 270, height: 250, fill: "#fff3bf" },
    ];
    return batch(scene, [
      ...specifications.map((specification) => (s) => addLabeledBox(s, specification)),
      (s) => connectNodes(s, { id: "ux-save-preview", fromId: "ux-primary", toId: "ux-preview" }),
    ]);
  },
  "ux-edit"(scene) {
    const node = scene.elements.find((element) => element.id === "ux-primary");
    if (!node) throw new Error("Read the existing UX sketch before refining ux-primary.");
    return batch(scene, [
      (s) => renameLabel(s, "ux-primary-label", "Save settings"),
      (s) => moveResizeNode(s, "ux-primary", { x: node.x + 30, y: node.y, width: node.width + 40, height: node.height + 10 }),
    ]);
  },
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { read: { type: "string" }, out: { type: "string" } } });
    const recipe = Object.hasOwn(recipes, positionals[0]) ? recipes[positionals[0]] : null;
    if (typeof recipe !== "function" || !values.read) throw new Error("Use flow|insert|rename|move|remove|ux|ux-edit --read <current-read.json> [--out edit.json].");
    const current = JSON.parse((await readFile(values.read, "utf8")).replace(/^\uFEFF/, ""));
    if (typeof current.topicId !== "string" || typeof current.versionId !== "string" || current.sealed !== true || current.hasUnsealedChanges) {
      throw new Error("Use a fresh sealed read with topicId/versionId and no pending work; do not replace a stale precondition.");
    }
    const request = { topicId: current.topicId, expectedVersionId: current.versionId, operations: recipe(current.scene) };
    const text = JSON.stringify(request, null, 2);
    if (values.out) await writeFile(values.out, `${text}\n`, "utf8");
    else console.log(text);
  } catch (error) { console.error(`Cookbook: ${error.message}`); process.exitCode = 1; }
}

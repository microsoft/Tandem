import { parseArgs } from "node:util";
import { CONNECTOR_META } from "../shared/authoring.mjs";
export function flowElements() {
  const elements = [];
  for (const [index, title] of ["Idea", "Discuss", "Refine"].entries()) {
    const x = 80 + index * 310;
    elements.push({ id: `node-${index + 1}`, type: "rectangle", x, y: 180, width: 200, height: 100,
      backgroundColor: index === 2 ? "#d3ebda" : "#dbe4ff", fillStyle: "solid", roughness: 0,
      boundElements: [{ id: `label-${index + 1}`, type: "text" },
        ...(index ? [{ id: `arrow-${index}`, type: "arrow" }] : []),
        ...(index < 2 ? [{ id: `arrow-${index + 1}`, type: "arrow" }] : [])] });
    elements.push({ id: `label-${index + 1}`, type: "text", x: x + 10, y: 218.5, width: 180, height: 23,
      text: title, fontSize: 20, fontFamily: 2, lineHeight: 1.15, textAlign: "center", verticalAlign: "middle",
      autoResize: false, containerId: `node-${index + 1}` });
    if (index < 2) elements.push({ id: `arrow-${index + 1}`, type: "arrow", x: x + 208.5, y: 230, width: 93, height: 0,
      points: [[0, 0], [93, 0]], endArrowhead: "arrow", roughness: 0,
      startBinding: { elementId: `node-${index + 1}`, focus: 0, gap: 8 },
      endBinding: { elementId: `node-${index + 2}`, focus: 0, gap: 8 },
      customData: { [CONNECTOR_META]: { version: 1, fromId: `node-${index + 1}`, toId: `node-${index + 2}`,
        fromSide: "right", toSide: "left" } } });
  }
  return elements;
}
export async function connect(url, topicId) {
  const health = await (await fetch(new URL("/health", url))).json();
  if (health.service !== "optional-whiteboard/v1") throw new Error("Wrong prototype service.");
  return async (operation, input = {}) => {
    const response = await fetch(new URL(`/${operation}`, url), {
      method: "POST", headers: { "Content-Type": "application/json", "x-whiteboard-instance": health.instanceId },
      body: JSON.stringify(topicId === undefined ? input : { ...input, topicId }),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${result.error}`), { status: response.status, result });
    return result;
  };
}
if (process.argv[1]?.endsWith("example.mjs")) {
  try {
    const { values } = parseArgs({ options: { url: { type: "string" }, topic: { type: "string" } } });
    const operation = await connect(values.url, values.topic);
    const baseline = await operation("read");
    if (baseline.scene.elements.length || baseline.hasUnsealedChanges) throw new Error("Example requires a fresh empty board; nothing was replaced.");
    const edit = await operation("edit", { expectedVersionId: baseline.versionId,
      operations: flowElements().map((element) => ({ op: "add", element })) });
    const sealed = await operation("seal", { expectedVersionId: edit.versionId });
    console.log(JSON.stringify({ topicId: sealed.topicId, baseline: baseline.versionId, V1: sealed.versionId, elements: edit.scene.elements.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

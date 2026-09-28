import assert from "node:assert/strict";
import ts from "typescript";
import { createHumanTask } from "../../src/human-loop-task.mjs";
import { sharedDesign } from "./shared-design-fixture.mjs";
import { requireCondition } from "../../runtime-src/domain/workflow/validation.ts";
import { isPriorityAnswer } from "../../runtime-src/domain/human-loop/model.ts";

export function sourceTree(source) {
  return ts.createSourceFile("source.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

export function findNode(tree, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1, "Expected exactly one bounded source node");
  return matches[0];
}

export function contextMethod(source) {
  return findNode(sourceTree(source), (node) => ts.isMethodDeclaration(node) && node.name.getText() === "#context");
}

export function wrapperExpression(source) {
  const send = findNode(sourceTree(source), node => ts.isMethodDeclaration(node) && node.name.getText() === "#send");
  return findNode(send, (node) => ts.isPropertyAssignment(node) && node.name.getText() === "prompt"
    && node.parent.properties?.some(property => property.name?.getText() === "agentMode")).initializer;
}

export function evaluateWrapper(source, packet, humanLoopPrompts) {
  return new Function("packet", "humanLoopPrompts", `return ${wrapperExpression(source).getText()};`)(packet, humanLoopPrompts);
}

export function contextHarness(source, { designReferenceCatalog, designGenerationContract, humanLoopPrompts }) {
  // Compile only the production private method, preserving its private receiver and body.
  return new Function("designReferenceCatalog", "designGenerationContract", "humanLoopPrompts", "requireCondition", "isPriorityAnswer", `
    return class {
      #designer;
      #contextProvider;
      constructor(designer, contextProvider) { this.#designer = designer; this.#contextProvider = contextProvider; }
      ${contextMethod(source).getText()}
      context(...args) { return this.#context(...args); }
    };
  `)(designReferenceCatalog, designGenerationContract, humanLoopPrompts, requireCondition, isPriorityAnswer);
}

export async function promptCases(source, dependencies) {
  const Harness = contextHarness(source, dependencies);
  const before = { id: "snapshot", digest: "b".repeat(64) };
  const absentDesign = { revisionId: null, digest: null };
  const design = { binding: { revisionId: "design", digest: "a".repeat(64) }, content: sharedDesign() };
  const original = { id: "original", message: "Original exact request.\nPreserve existing work.", answers: null };
  const request = { id: "current", message: "Exact answer batch.\nKeep all constraints.", answers: {
    answers: [{ questionId: "question", sourceResultId: "result" }],
  } };
  const later = { id: "later", message: "Later exact constraint.", answers: null };
  for (const record of [original, request, later]) Object.assign(record, {
    blockingAnswerRefs: [], questionGatesReleased: false, status: record === request ? "active" : "completed",
  });
  const cycle = { id: "cycle", phase: "waiting-input", originRequestId: original.id,
    originRequestIds: [original.id, later.id], baseline: before, acceptance: { authority: "host" },
    plan: { tasks: [{ id: "internal", scope: ["app.js"] }] } };
  const state = { requests: [original, request, later], activeBatchRequestIds: [request.id, later.id],
    cycles: [cycle], handoffs: [{ result: { summary: "Exact prior outcome." } }],
    questions: [{ id: "question", state: "answered", answerRequestId: request.id,
      source: { cycleId: cycle.id, resultId: "result", requestId: original.id, requestIds: [original.id] } },
      { id: "other", state: "resolved", source: { cycleId: "other", resultId: "old" } }] };
  const result = [];
  for (const [name, role, internalTaskId] of [
    ["router", "router", null], ["designer", "designer", null], ["planner", "planner", null],
    ["implementer-task", "implementer", "internal"], ["implementer-aggregate", "implementer", null],
    ["reviewer", "reviewer", null], ["agent", "agent", null],
  ]) {
    for (const variant of ["bound", "unbound", ...(role === "designer" ? ["custom-generation"] : [])]) {
      const bound = variant !== "unbound";
      const harness = new Harness(variant === "custom-generation" ? { generation: () => ({ exact: "Custom generation contract" }) } : {});
      const context = await harness.context(role, bound ? request : original, bound ? cycle : null, internalTaskId,
        before, bound ? design : { binding: absentDesign, content: null }, state);
      const packet = createHumanTask({ id: "task", dispatchId: "dispatch", sessionId: "private", requestId: "current",
        role, cycleId: bound ? cycle.id : null, internalTaskId, design: bound ? design.binding : absentDesign, before }, context);
      result.push({ name: `${name}:${variant}`, packet });
    }
  }
  return result;
}

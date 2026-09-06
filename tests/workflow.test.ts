import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAuthoritativeAnswer, hasActiveWork, invalidateArtifacts, validateDecisionGraph, type DecisionNode } from "../src/workflow.js";

function node(id: string, answer: string | null = null, dependencies: string[] = []): DecisionNode {
    return { id, answer, dependencies, title: id, question: {
        id, text: id, rationale: "", choices: ["a", "b", "c"], recommended: "a",
        allowFreeText: true, answerPlaceholder: "",
    }, status: answer ? "answered" : "toAnswer" };
}

test("only the user's submitted answer may change", () => {
    const current = { nodes: [node("a"), node("b", null, ["a"])] };
    assert.throws(() => applyAuthoritativeAnswer(current, { nodes: [node("b", "invented")] }, "a", "user", false), /omitted/);
    assert.throws(() => applyAuthoritativeAnswer(current, { nodes: [node("a"), node("b", "invented", ["a"])] }, "a", "user", false), /did not submit/);
    const next = applyAuthoritativeAnswer(current, current, "a", "user", false);
    assert.equal(next.nodes[0].answer, "user");
    assert.equal(next.nodes[1].answer, null);
    assert.equal(current.nodes[0].answer, null);
});

test("changing a decision clears descendants but retains independent answers", () => {
    const current = { nodes: [node("a", "old"), node("b", "old child", ["a"]), node("c", "independent")] };
    const next = applyAuthoritativeAnswer(current, current, "a", "new", true);
    assert.deepEqual(next.nodes.map((item) => item.answer), ["new", null, "independent"]);
    assert.throws(() => validateDecisionGraph({ nodes: [node("a", null, ["missing"])] }), /Unknown/);
    assert.throws(() => validateDecisionGraph({ nodes: [node("a", null, ["b"]), node("b", null, ["a"])] }), /cycle/);
});

test("all background activity participates in ownership and reset guards", () => {
    assert.equal(hasActiveWork({ preparation: { status: "starting" } }), true);
    assert.equal(hasActiveWork({ preparation: { status: "running" } }), true);
    assert.equal(hasActiveWork({ testing: { status: "running" } }), true);
    assert.equal(hasActiveWork({ designReview: { threads: [{ status: "queued" }] } }), true);
    assert.equal(hasActiveWork({ suggestionProcessing: { status: "running" } }), true);
    assert.equal(hasActiveWork({ implementation: { status: "completed" } }), false);
    const artifacts = ["requirements", "prototype", "design"].map((stage) => ({
        id: stage, title: stage, kind: stage, stage, path: "", content: "", mermaid: "", language: "markdown", reviewStatus: "current",
    }));
    const output = invalidateArtifacts(artifacts as Parameters<typeof invalidateArtifacts>[0], "prototype");
    assert.deepEqual(output.map((artifact) => artifact.reviewStatus), ["current", "stale", "stale"]);
});

import type { TandemState } from "../types.js";
import { curatedDefault, type DecisionNode } from "../workflow.js";

export function requirementNodes(state: Pick<TandemState, "requirements" | "decisionGraph" | "question">): DecisionNode[] {
    if (state.requirements?.substage === "usage") return [];
    if (state.decisionGraph?.nodes?.length) return state.decisionGraph.nodes;
    return state.question ? [{
        id: state.question.id,
        title: state.question.text,
        dependencies: [],
        question: state.question,
        answer: null,
        status: "active",
    }] : [];
}

export function selectedRequirement(nodes: DecisionNode[], selectedId: string | null, followActive: boolean): DecisionNode | null {
    const selected = nodes.find((node) => node.id === selectedId);
    const active = nodes.find((node) => node.status === "active");
    if (selected && (!followActive || selected.status === "active")) return selected;
    return active || nodes.find((node) => !node.answer) || selected
        || nodes.find((node) => node.status === "answered") || nodes[0] || null;
}

export function requirementDraftKey(state: Pick<TandemState, "prototypeId" | "generation">, node: DecisionNode): string {
    return JSON.stringify(["requirements", state.prototypeId, state.generation, node.id, node.question, node.answer]);
}

interface DefaultRequest {
    action: "apply-defaults";
    expectedRevision: number;
    generation: string;
    retryRequestId?: string;
    defaults?: { nodeId: string; answer: string }[];
}

export function wholeGraphDefaults(
    state: Pick<TandemState, "revision" | "generation" | "decisionGraph" | "processing">,
    useCurrentSnapshot = false,
): { body: DefaultRequest; confirmation: string | null } {
    const body: DefaultRequest = {
        action: "apply-defaults",
        expectedRevision: state.revision,
        generation: state.generation,
    };
    const retry = !useCurrentSnapshot
        && state.processing?.action === "apply-defaults" && state.processing.status === "error";
    if (retry) {
        if (!state.processing.requestId || typeof state.processing.requestId !== "string") {
            throw new Error("The failed batch has no saved request ID. Review current whole-graph defaults to approve a new batch.");
        }
        return { body: { ...body, retryRequestId: state.processing.requestId }, confirmation: null };
    }
    const unanswered = (state.decisionGraph?.nodes || []).filter((node) => !node.answer);
    if (!unanswered.length) throw new Error("No unanswered decisions are waiting for whole-graph defaults.");
    const defaults = unanswered.flatMap((node) => {
        const answer = curatedDefault(node.question);
        return answer ? [{ nodeId: node.id, answer }] : [];
    });
    if (!defaults.length) throw new Error("No recommended answers are available. Answer the remaining questions explicitly.");
    const explicit = unanswered.filter((node) => !curatedDefault(node.question));
    return {
        body: { ...body, defaults },
        confirmation: `Use whole-graph defaults for ALL ${defaults.length} unanswered decisions with recommendations?\n\n`
            + defaults.map((item) => `${unanswered.find((node) => node.id === item.nodeId)!.title}: ${item.answer}`).join("\n")
            + (explicit.length ? `\n\n${explicit.length} ${explicit.length === 1 ? "question needs" : "questions need"} an explicit answer and will remain unanswered:\n`
                + explicit.map((node) => node.title).join("\n")
                + "\nAfter reconciliation, continue with the next blocking question." : "")
            + "\n\nOne semantic review checks compatibility. Changed decisions require review; new recommendations are not automatically selected.",
    };
}

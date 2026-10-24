import { createHash } from "node:crypto";
import type { DecisionGraph, DecisionQuestion } from "./workflow.js";
import type { PrototypeApproach, TandemState } from "./types.js";
import type { RequirementsResearch } from "./requirements-research.js";
import { applyAuthoritativeAnswer, curatedDefault, decisionDescendants, normalizeDecisionId, validateDecisionGraph } from "./workflow.js";
export { curatedDefault } from "./workflow.js";

export interface DefaultSelection { nodeId: string; answer: string }
export interface DefaultBatch {
    version: 1;
    generation: string;
    revision: number;
    inputDigest: string;
    defaults: DefaultSelection[];
}
export interface RequirementsChangeSet {
    version: 1;
    conflicts: { nodeId: string; reason: string }[];
    questions: { nodeId: string; title: string; question: DecisionQuestion }[];
    assumptions: { add: string[]; remove: string[] };
    deferred: { add: string[]; remove: string[] };
    prototypeApproach: PrototypeApproach | null;
}

const text = (maxLength: number, minLength = 1) => ({ type: "string", minLength, maxLength });
const array = (items: Record<string, any>, maxItems = 50) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, any>) => ({
    type: "object", additionalProperties: false, properties, required: Object.keys(properties),
});
const listPatch = object({ add: array(text(2000)), remove: array(text(2000)) });
const replacementQuestionSchema = object({
    id: text(120), text: text(2000), rationale: text(1200, 0),
    choices: { ...array(text(2000), 5), minItems: 3, uniqueItems: true },
    recommended: { anyOf: [text(2000), { type: "null" }] },
    allowFreeText: { type: "boolean", const: true }, answerPlaceholder: text(200, 0),
});
const resolvedApproachSchema = object({
    mode: { type: "string", enum: ["build", "validate-existing", "not-applicable"] }, reason: text(1200),
});
export const requirementsChangeSetSchema = object({
    version: { type: "integer", const: 1 },
    conflicts: array(object({ nodeId: text(120), reason: text(1200) })),
    questions: array(object({
        nodeId: text(120), title: text(240),
        question: replacementQuestionSchema,
    })),
    assumptions: listPatch,
    deferred: listPatch,
    prototypeApproach: { anyOf: [
        { type: "null" },
        resolvedApproachSchema,
    ] },
});
const defaultBatchSchema = object({
    version: { type: "integer", const: 1 }, generation: text(200),
    revision: { type: "integer", minimum: 0 }, inputDigest: text(64),
    defaults: { ...array(object({ nodeId: text(120), answer: text(4000) })), minItems: 1 },
});

// The SDK's structured output is not a persistence trust boundary.
export function validateRequirementsValue(value: unknown, schema: any, path = "reconciliation"): void {
    if (schema.anyOf) {
        if (value === null && schema.anyOf.some((item: any) => item.type === "null")) return;
        return validateRequirementsValue(value, schema.anyOf.find((item: any) => item.type !== "null"), path);
    }
    if (schema.const !== undefined && value !== schema.const) throw new Error(`${path} has an invalid value.`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} has an invalid value.`);
    if (schema.type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
        const record = value as Record<string, unknown>;
        if (Object.keys(record).some((key) => !Object.hasOwn(schema.properties, key)) ||
            schema.required.some((key: string) => !Object.hasOwn(record, key))) throw new Error(`${path} has missing or unexpected fields.`);
        for (const [key, child] of Object.entries(schema.properties)) validateRequirementsValue(record[key], child, `${path}.${key}`);
    } else if (schema.type === "array") {
        if (!Array.isArray(value) || value.length > schema.maxItems || value.length < (schema.minItems || 0)) {
            throw new Error(`${path} has an invalid number of entries.`);
        }
        if (schema.uniqueItems && new Set(value).size !== value.length) throw new Error(`${path} must contain distinct entries.`);
        value.forEach((item, index) => validateRequirementsValue(item, schema.items, `${path}[${index}]`));
    } else if (schema.type === "string") {
        if (typeof value !== "string" || value.length < schema.minLength || value.length > schema.maxLength ||
            (schema.minLength && !value.trim())) throw new Error(`${path} must contain valid text.`);
    } else if (schema.type === "integer") {
        if (!Number.isSafeInteger(value) || Number(value) < (schema.minimum ?? 0)) throw new Error(`${path} must be an integer.`);
    } else if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
}

export function readDefaultBatch(value: unknown): DefaultBatch {
    validateRequirementsValue(value, defaultBatchSchema, "default batch");
    const batch = value as DefaultBatch;
    if (new Set(batch.defaults.map((item) => item.nodeId)).size !== batch.defaults.length) {
        throw new Error("The default batch contains duplicate decisions.");
    }
    return { ...batch, defaults: batch.defaults.map((item) => ({ ...item })) };
}

export function reconciliationInput(state: Pick<TandemState,
    "goal" | "requirements" | "decisionGraph" | "prototypeApproach" | "assumed" | "deferred">) {
    return {
        goal: state.goal, requirements: state.requirements, prototypeApproach: state.prototypeApproach,
        assumed: state.assumed, deferred: state.deferred,
        decisionGraph: { nodes: state.decisionGraph.nodes.map(({ status: _status, ...node }) => node) },
    };
}

type RequirementsInputs = Parameters<typeof reconciliationInput>[0];

export interface RequirementsDecisionUpdate {
    id: string;
    title: string;
    dependencies: string[];
    question: DecisionQuestion;
}

export interface RequirementsDagChanges {
    nodes: RequirementsDecisionUpdate[];
    assumed: string[];
    deferred: string[];
}

export interface RequirementsAnswerChanges {
    upsert: RequirementsDecisionUpdate[];
    assumptions: { add: string[]; remove: string[] };
    deferred: { add: string[]; remove: string[] };
    prototypeApproach: PrototypeApproach | null;
}

const decisionUpdateSchema = object({
    id: text(120), title: text(240),
    dependencies: { ...array(text(120), 20), uniqueItems: true },
    question: replacementQuestionSchema,
});
export const requirementsDagChangesSchema = object({
    nodes: { ...array(decisionUpdateSchema), minItems: 1 },
    assumed: array(text(2000)), deferred: array(text(2000)),
});
export const requirementsAnswerChangesSchema = object({
    upsert: array(decisionUpdateSchema),
    assumptions: listPatch, deferred: listPatch,
    prototypeApproach: { anyOf: [{ type: "null" }, resolvedApproachSchema] },
});
export const requirementsDagResultSchema = object({
    kind: { type: "string", const: "requirements-dag" }, generation: text(200),
    researchDigest: text(64, 64), changes: requirementsDagChangesSchema,
});
export const requirementsAnswerResultSchema = object({
    kind: { type: "string", const: "requirements-answer" }, generation: text(200),
    inputDigest: text(64, 64), changes: requirementsAnswerChangesSchema,
});

export function requirementsPromptContext(state: RequirementsInputs, questionId?: string) {
    const descendants = questionId ? decisionDescendants(state.decisionGraph, questionId) : null;
    const research = state.requirements.research;
    return {
        goal: state.goal, usageItems: state.requirements.usageItems,
        prototypeApproach: state.prototypeApproach, assumed: state.assumed, deferred: state.deferred,
        research: research ? { summary: research.summary, checks: research.checks, sources: research.sources } : null,
        decisions: state.decisionGraph.nodes.map(node => ({
            id: node.id, title: node.title, dependencies: node.dependencies, answer: node.answer,
            ...(node.review ? { review: node.review } : {}),
            question: descendants === null || node.id === questionId || descendants.has(node.id)
                ? node.question : node.question ? {
                    id: node.question.id, text: node.question.text, rationale: node.question.rationale,
                } : null,
        })),
    };
}

function validateReplacementQuestion(nodeId: string, question: DecisionQuestion): void {
    if (question.id !== nodeId || (question.recommended !== null && !curatedDefault(question))) {
        throw new Error(`Reconciliation returned an invalid question for "${nodeId}".`);
    }
    if (new Set(question.choices.map(choice => choice.toLowerCase())).size !== question.choices.length) {
        throw new Error("Reconciliation choices must be distinct.");
    }
}

function validateDecisionUpdates(nodes: RequirementsDecisionUpdate[]): void {
    if (new Set(nodes.map(node => node.id)).size !== nodes.length) throw new Error("Decision IDs must be unique.");
    for (const node of nodes) {
        if (normalizeDecisionId(node.id) !== node.id ||
            node.dependencies.some(id => normalizeDecisionId(id) !== id)) {
            throw new Error("Decision IDs and dependencies must use their exact stable identifiers.");
        }
        validateReplacementQuestion(node.id, node.question);
    }
}

export function readRequirementsDagChanges(value: unknown): RequirementsDagChanges {
    validateRequirementsValue(value, requirementsDagChangesSchema, "requirements DAG");
    const changes = value as RequirementsDagChanges;
    validateDecisionUpdates(changes.nodes);
    validateDecisionGraph({ nodes: changes.nodes.map(node => ({ ...node, answer: null, status: "toAnswer" })) });
    return changes;
}

export function applyRequirementsAnswerChanges(
    state: RequirementsInputs,
    value: unknown,
    questionId: string,
    answer: string,
    changingAnswer: boolean,
): Pick<TandemState, "decisionGraph" | "prototypeApproach" | "assumed" | "deferred"> {
    validateRequirementsValue(value, requirementsAnswerChangesSchema, "requirements answer");
    const changes = value as RequirementsAnswerChanges;
    validateDecisionUpdates(changes.upsert);
    const existing = new Set(state.decisionGraph.nodes.map(node => node.id));
    const descendants = decisionDescendants(state.decisionGraph, questionId);
    const updates = new Map(changes.upsert.map(node => [node.id, node]));
    for (const node of changes.upsert) {
        if (existing.has(node.id) && !descendants.has(node.id)) {
            throw new Error(`Reconciliation cannot rewrite the submitted or independent decision "${node.id}".`);
        }
    }
    const proposed: DecisionGraph = { nodes: [
        ...state.decisionGraph.nodes.map(node => ({ ...node, ...updates.get(node.id) })),
        ...changes.upsert.filter(node => !existing.has(node.id)).map(node => ({
            ...node, answer: null, status: "toAnswer" as const,
        })),
    ] };
    if (proposed.nodes.length > 50) throw new Error("The requirements graph exceeds the 50-decision limit.");
    const decisionGraph = applyAuthoritativeAnswer(state.decisionGraph, proposed, questionId, answer, changingAnswer);
    for (const node of decisionGraph.nodes) if (node.answer) node.review = null;
    let prototypeApproach = state.prototypeApproach;
    if (questionId === "prototype-approach") {
        if (!changes.prototypeApproach) throw new Error("The prototype-approach answer did not resolve the interface-validation mode.");
        prototypeApproach = changes.prototypeApproach;
    } else if (changes.prototypeApproach) {
        throw new Error("Reconciliation cannot change an unsubmitted prototype approach.");
    }
    return {
        decisionGraph, prototypeApproach,
        assumed: patchSemanticList(state.assumed, changes.assumptions),
        deferred: patchSemanticList(state.deferred, changes.deferred),
    };
}

export function requirementsInputDigest(state: Parameters<typeof reconciliationInput>[0]): string {
    return createHash("sha256").update(JSON.stringify(reconciliationInput(state))).digest("hex");
}

export function requirementsResearchDigest(research: RequirementsResearch): string {
    return createHash("sha256").update(JSON.stringify(research)).digest("hex");
}

export function requirementsAnswerDigest(
    state: RequirementsInputs, questionId: string, answer: string, changingAnswer: boolean,
): string {
    return createHash("sha256").update(JSON.stringify({
        inputs: reconciliationInput(state), questionId, answer, changingAnswer,
    })).digest("hex");
}

export function validateChangeSet(value: unknown, graph: DecisionGraph): RequirementsChangeSet {
    validateRequirementsValue(value, requirementsChangeSetSchema);
    const result = value as RequirementsChangeSet;
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const entries of [result.conflicts, result.questions]) {
        if (new Set(entries.map((entry) => entry.nodeId)).size !== entries.length ||
            entries.some((entry) => !ids.has(entry.nodeId))) throw new Error("Reconciliation references duplicate or unknown decisions.");
    }
    for (const entry of result.questions) {
        validateReplacementQuestion(entry.nodeId, entry.question);
    }
    for (const conflict of result.conflicts) {
        if (!result.questions.some((entry) => entry.nodeId === conflict.nodeId)) {
            throw new Error(`The conflict at "${conflict.nodeId}" needs an explicit review question.`);
        }
    }
    return result;
}

export function patchSemanticList(current: string[], patch: { add: string[]; remove: string[] }): string[] {
    if (patch.remove.some((entry) => !current.includes(entry)) ||
        patch.add.some((entry) => patch.remove.includes(entry))) throw new Error("The semantic list patch does not match its inputs.");
    const next = [...new Set([...current.filter((entry) => !patch.remove.includes(entry)), ...patch.add])];
    if (next.length > 50) throw new Error("The semantic list patch exceeds the 50-entry limit.");
    return next;
}

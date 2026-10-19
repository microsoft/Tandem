import { createHash } from "node:crypto";
import type { DecisionGraph, DecisionQuestion } from "./workflow.js";
import type { PrototypeApproach, TandemState } from "./types.js";
import { curatedDefault } from "./workflow.js";
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
export const requirementsChangeSetSchema = object({
    version: { type: "integer", const: 1 },
    conflicts: array(object({ nodeId: text(120), reason: text(1200) })),
    questions: array(object({
        nodeId: text(120), title: text(240),
        question: object({
            id: text(120), text: text(2000), rationale: text(1200, 0),
            choices: { ...array(text(2000), 5), minItems: 3, uniqueItems: true },
            recommended: { anyOf: [text(2000), { type: "null" }] },
            allowFreeText: { type: "boolean", const: true }, answerPlaceholder: text(200, 0),
        }),
    })),
    assumptions: listPatch,
    deferred: listPatch,
    prototypeApproach: { anyOf: [
        { type: "null" },
        object({ mode: { type: "string", enum: ["build", "validate-existing", "not-applicable"] }, reason: text(1200) }),
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

export function requirementsInputDigest(state: Parameters<typeof reconciliationInput>[0]): string {
    return createHash("sha256").update(JSON.stringify(reconciliationInput(state))).digest("hex");
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
        if (entry.question.id !== entry.nodeId || (entry.question.recommended !== null && !curatedDefault(entry.question))) {
            throw new Error(`Reconciliation returned an invalid question for "${entry.nodeId}".`);
        }
        if (new Set(entry.question.choices.map((choice) => choice.toLowerCase())).size !== entry.question.choices.length) {
            throw new Error("Reconciliation choices must be distinct.");
        }
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

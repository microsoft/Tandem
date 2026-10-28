import type { PreparationCheck, PreparationSource, TandemState } from "./types.js";
import type { JsonValue } from "./agent-runner.js";

export interface ResearchAnalysis {
    summary: string;
    checks: PreparationCheck[];
    sources: PreparationSource[];
}

export interface RequirementsResearchInput {
    goal: string;
    usageItems: string[];
    preparation: ResearchAnalysis;
}

export interface RequirementsResearch extends ResearchAnalysis {
    generation: string;
    requestId: string;
    runId: string;
    input: RequirementsResearchInput;
    completedAt: string;
}

const text = (maxLength: number, minLength = 1) => ({ type: "string", minLength, maxLength });
const array = <T extends JsonValue>(items: T, maxItems: number, minItems = 0) => ({ type: "array", items, minItems, maxItems });
const object = <T extends Record<string, JsonValue>>(properties: T) => ({
    type: "object", additionalProperties: false, properties, required: Object.keys(properties),
});

export const researchCheckSchema = object({
    label: text(120),
    status: { type: "string", enum: ["ready", "missing", "deferred"] },
    detail: text(500, 0),
});
export const researchSourceSchema = object({
    title: text(160), url: text(1000), purpose: text(500, 0),
});
export const researchAnalysisSchema = object({
    summary: text(4000), checks: array(researchCheckSchema, 10), sources: array(researchSourceSchema, 20),
});
export const requirementsResearchSchema = object({
    ...researchAnalysisSchema.properties,
    generation: text(200), requestId: text(200), runId: text(200), completedAt: text(100),
    input: object({
        goal: text(4000),
        usageItems: array(text(500), 30, 1),
        preparation: object({
            summary: text(2000, 0), checks: array(researchCheckSchema, 20), sources: array(researchSourceSchema, 20),
        }),
    }),
});

export function requirementsResearchInput(state: Pick<TandemState, "goal" | "requirements" | "preparation">): RequirementsResearchInput {
    return {
        goal: state.goal,
        usageItems: [...state.requirements.usageItems],
        preparation: {
            summary: state.preparation.summary,
            checks: state.preparation.checks.map(check => ({ ...check })),
            sources: state.preparation.sources.map(source => ({ ...source })),
        },
    };
}

export function requirementsResearchIsCurrent(
    state: Pick<TandemState, "generation" | "goal" | "requirements" | "preparation">,
    research = state.requirements.research,
): boolean {
    return Boolean(research && research.generation === state.generation
        && JSON.stringify(research.input) === JSON.stringify(requirementsResearchInput(state)));
}

export function assertResearchSourceUrls(sources: PreparationSource[]): void {
    for (const source of sources) {
        let url: URL;
        try { url = new URL(source.url); }
        catch { throw new Error(`Research returned an invalid source URL for "${source.title}".`); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
            throw new Error(`Research source "${source.title}" must use an HTTP(S) URL without credentials.`);
        }
    }
}

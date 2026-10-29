import type { PrototypeFlow } from "./prototype-flow.js";

export type PrototypeSubstage = "prototype" | "visual";
export type PrototypeMilestone = PrototypeSubstage | "structure" | "interaction";

export function prototypeSubstage(milestone: PrototypeMilestone): PrototypeSubstage {
    return milestone === "visual" ? "visual" : "prototype";
}

export const prototypeMilestoneLabels: Record<PrototypeMilestone, string> = {
    prototype: "Prototype",
    structure: "Prototype",
    interaction: "Prototype",
    visual: "Visual exploration",
};

export function prototypeMilestoneReady(flow: PrototypeFlow | null | undefined, milestone: PrototypeSubstage): boolean {
    return Boolean(flow?.checkpoints.some(item => item.status === "ready" && !item.visualDismissedAt &&
        (milestone === "prototype" ? item.milestone === "prototype" || item.milestone === "interaction" : item.milestone === "visual")));
}

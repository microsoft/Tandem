import { requiresExplicitAnswer, type DecisionNode } from "./workflow.js";

export function escapeMermaidLabel(value: string) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "'").replace(/\r?\n/g, " ");
}

export function buildDecisionGraphMermaid(nodes: DecisionNode[]) {
    const aliases = new Map<string, DecisionNode>();
    const lines = ["flowchart LR"];
    nodes.forEach((node, index) => {
        aliases.set(`Decision${index}`, node);
        const label = `${node.title}${requiresExplicitAnswer(node) ? " (Explicit answer)" : ""}`;
        lines.push(`  Decision${index}["${escapeMermaidLabel(label)}"]`);
    });
    nodes.forEach((node, index) => {
        for (const dependency of node.dependencies) {
            const parent = nodes.findIndex((candidate) => candidate.id === dependency);
            if (parent >= 0) lines.push(`  Decision${parent} --> Decision${index}`);
        }
    });
    lines.push(
        "  classDef answered fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328",
        "  classDef active fill:#ddf4ff,stroke:#0969da,stroke-width:3px,color:#1f2328",
        "  classDef toAnswer fill:#fff8c5,stroke:#bf8700,stroke-width:2px,color:#1f2328",
        "  classDef explicitAnswer stroke:#9a6700,stroke-width:3px,stroke-dasharray:6 3",
    );
    for (const status of ["answered", "active", "toAnswer"]) {
        const members = nodes.flatMap((node, index) => node.status === status ? [`Decision${index}`] : []);
        if (members.length) lines.push(`  class ${members.join(",")} ${status}`);
    }
    const explicit = nodes.flatMap((node, index) => requiresExplicitAnswer(node) ? [`Decision${index}`] : []);
    if (explicit.length) lines.push(`  class ${explicit.join(",")} explicitAnswer`);
    return { source: lines.join("\n"), aliases };
}

import { win32 } from "node:path";

export function executionId(value: unknown): string {
    if (typeof value !== "string") throw new Error("Execution IDs must be strings.");
    const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id || id.length > 120) throw new Error("Execution IDs must contain 1–120 valid characters.");
    return id;
}

export function executionGraph(value: unknown): Record<string, any>[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 30) {
        throw new Error("An execution graph must contain at most 30 items.");
    }
    const ids = new Set<string>();
    const items = value.map((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            throw new Error("Every execution item must be an object.");
        }
        const id = executionId(candidate.id);
        if (ids.has(id)) throw new Error(`Execution IDs collide after normalization: ${id}.`);
        ids.add(id);
        if (!Array.isArray(candidate.dependencies)) throw new Error(`Missing dependencies for ${id}.`);
        const dependencies = [...new Set<string>(candidate.dependencies.map(executionId))];
        return { ...candidate, id, dependencies };
    });
    for (const item of items) {
        for (const dependency of item.dependencies) {
            if (dependency === item.id || !ids.has(dependency)) {
                throw new Error(`Invalid dependency ${dependency} for ${item.id}.`);
            }
        }
    }
    const complete = new Set<string>();
    while (complete.size < items.length) {
        const ready = items.filter((item) => !complete.has(item.id) &&
            item.dependencies.every((dependency: string) => complete.has(dependency)));
        if (!ready.length) throw new Error("The execution dependency graph contains a cycle.");
        ready.forEach((item) => complete.add(item.id));
    }
    return items;
}

export function ownershipPath(value: string): string {
    const path = value.trim().replace(/\//g, "\\");
    if (!path || /[*?[\]{}]/.test(path)) return "*";
    if (win32.isAbsolute(path) || path.includes(":")) {
        throw new Error(`Owned paths must be workspace-relative: ${value}.`);
    }
    const trimmed = path.split("\\").map((part) => {
        const segment = part.trimEnd();
        return segment === "." || segment === ".." ? segment : segment.replace(/[ .]+$/, "");
    }).join("\\");
    const normalized = win32.normalize(trimmed).replace(/\\+$/, "").toLowerCase();
    if (normalized === ".." || normalized.startsWith("..\\")) {
        throw new Error(`Owned paths cannot escape the workspace: ${value}.`);
    }
    return normalized === "." || !normalized ? "*" : normalized;
}

export function ownershipConflicts(left: string[], right: string[]): boolean {
    const a = left.length ? left.map(ownershipPath) : ["*"];
    const b = right.length ? right.map(ownershipPath) : ["*"];
    return a.some((x) => b.some((y) =>
        x === "*" || y === "*" || x === y || x.startsWith(`${y}\\`) || y.startsWith(`${x}\\`)));
}

export function ownershipContains(scopes: string[], path: string): boolean {
    const candidate = ownershipPath(path);
    if (candidate === "*") return false;
    return (scopes.length ? scopes : ["*"]).map(ownershipPath)
        .some((scope) => scope === "*" || candidate === scope || candidate.startsWith(`${scope}\\`));
}

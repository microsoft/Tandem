export interface StageEffort {
    desired: string | null;
    actual: string | null;
    model: string | null;
    supported: string[];
    status: string;
    error: string | null;
}
export interface ProjectEffort { desired: string | null; stage1: StageEffort; stage2: StageEffort; changing: boolean }
export class ProjectEffortError extends Error {
    constructor(message: string, readonly settings?: ProjectEffort) { super(message); }
}

export async function requestProjectEffort(effort?: string): Promise<ProjectEffort> {
    const response = await fetch("/api/settings/project-effort", effort === undefined ? { cache: "no-store" } : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effort }),
    });
    const value = await response.json();
    if (!response.ok) throw new ProjectEffortError(value.error || "Project effort is unavailable.", value.settings);
    return value;
}

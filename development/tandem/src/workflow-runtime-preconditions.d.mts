import type { PolicySnapshot } from "../runtime-src/domain/workflow/policy.js";

export function requireIgnoredApplicationState(options: {
    repositoryRoot: string;
    targetWorktreePath: string;
    policy: PolicySnapshot;
}): Promise<void>;

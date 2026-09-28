import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { ensureMaterializedDirectories } from "./accepted-artifacts.js";
import { ProjectStoreError } from "./project-store.js";

/** Only upstream mutation and explicit request admission, never native role settlement. */
export class DevelopmentTransition {
    private readonly scope = new AsyncLocalStorage<{ active: boolean; assertOwned(): void }>();
    constructor(private readonly workspaceRoot: string) {}
    async run<T>(operation: () => Promise<T>): Promise<T> {
        const inherited = this.scope.getStore();
        if (inherited?.active) { inherited.assertOwned(); return operation(); }
        const directory = join(this.workspaceRoot, ".tandem", "locks");
        await ensureMaterializedDirectories(directory, true);
        let compromised: Error | undefined;
        const assertOwned = () => {
            if (compromised) throw new ProjectStoreError("development_transition_lost",
                "Upstream/admission ownership changed. Reconcile the exact saved request; no new identity was created.", 409, { cause: compromised });
        };
        const release = await lockfile.lock(join(directory, "development-transition"), {
            realpath: false, stale: 30_000, update: 5_000,
            retries: { retries: 600, minTimeout: 100, maxTimeout: 100, factor: 1 },
            onCompromised: error => { compromised = error; },
        });
        const scope = { active: true, assertOwned };
        try {
            return await this.scope.run(scope, async () => {
                assertOwned();
                const result = await operation();
                assertOwned();
                return result;
            });
        } finally {
            scope.active = false;
            if (!compromised) await release();
        }
    }
}

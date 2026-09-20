import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { readJsonFile, writeJsonAtomically } from "../project-store.js";
import { resolveSharedProjectRoot } from "../workspace-root.js";

interface DesktopSessionRecord {
    version: 1;
    workspace: string;
    sessionId: string;
}

function isSessionRecord(value: unknown, workspace: string): value is DesktopSessionRecord {
    return value !== null && typeof value === "object" && "version" in value && value.version === 1 &&
        "workspace" in value && value.workspace === workspace && "sessionId" in value &&
        typeof value.sessionId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.sessionId);
}

export async function claimDesktopWorkspace(folder: string, onCompromised: (error: Error) => void) {
    const workspace = await realpath(resolve(folder));
    if (!(await stat(workspace)).isDirectory()) throw new Error("Choose a workspace folder.");
    const identity = process.platform === "win32" ? workspace.toLowerCase() : workspace;
    const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    const directory = join(resolveSharedProjectRoot(workspace), ".tandem", "desktop", key);
    await mkdir(directory, { recursive: true });
    let compromised = false;
    const release = await lockfile.lock(directory, {
        stale: 30_000, update: 5_000, retries: 0,
        onCompromised(error) { compromised = true; onCompromised(error); },
    }).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
            throw new Error("This workspace is already open in another Tandem desktop window. Close it there before retrying.");
        }
        throw error;
    });
    try {
        const recordPath = join(directory, "session.json");
        const existing = await readJsonFile(recordPath);
        let record: DesktopSessionRecord;
        if (existing === undefined) {
            record = { version: 1, workspace: identity, sessionId: randomUUID() };
        } else {
            if (!isSessionRecord(existing, identity)) {
                throw new Error(`Invalid desktop session identity in ${recordPath}. Repair the file before retrying; it has been preserved.`);
            }
            record = existing;
        }
        return {
            workspace,
            sessionId: record.sessionId,
            resume: existing !== undefined,
            async save() {
                if (compromised) throw new Error("Desktop workspace ownership was lost.");
                await writeJsonAtomically(recordPath, record);
            },
            async release() { if (!compromised) await release(); },
        };
    } catch (error) {
        if (!compromised) await release();
        throw error;
    }
}

import { join } from "node:path";
import { readJsonFile, writeJsonAtomically } from "./project-store.js";

const levels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export interface MainEffortStatus {
    desired: string | null;
    actual: string | null;
    model: string | null;
    supported: string[];
    status: "unset" | "pending" | "applied" | "error";
    error: string | null;
}
interface MainEffortSession {
    rpc: {
        model: {
            getCurrent(): Promise<{ modelId?: string; reasoningEffort?: string }>;
            list(): Promise<{ list: unknown[] }>;
            setReasoningEffort(input: { reasoningEffort: string }): Promise<unknown>;
        };
        metadata: {
            isProcessing(): Promise<{ processing: boolean }>;
            activity(): Promise<{ hasActiveWork: boolean }>;
        };
    };
}

/** Foreground-session settings only. Development owns its separate implementation. */
export class MainSessionEffort {
    private readonly path: string;
    private error: string | null = null;
    private changing = false;
    constructor(root: string, private readonly session: () => MainEffortSession) {
        this.path = join(root, ".tandem", "desktop", "reasoning-effort.json");
    }
    async desired(): Promise<string | null> {
        const saved = await readJsonFile(this.path);
        if (saved === undefined) return null;
        if (!record(saved) || saved.schemaVersion !== "main-session-effort/v1"
            || Object.keys(saved).sort().join() !== "desired,schemaVersion"
            || typeof saved.desired !== "string" || !levels.includes(saved.desired)) {
            throw new Error("Saved main-session effort is invalid; no default was substituted.");
        }
        return saved.desired;
    }
    private async readCurrent() {
        const native = await this.session().rpc.model.getCurrent();
        if (!record(native) || native.modelId !== undefined && (typeof native.modelId !== "string"
            || !native.modelId.trim() || native.modelId.trim() !== native.modelId || native.modelId.length > 200)
            || native.reasoningEffort !== undefined && (typeof native.reasoningEffort !== "string" || !levels.includes(native.reasoningEffort))) {
            throw new Error("Main-session model/effort readback is invalid; no default was substituted.");
        }
        return native;
    }
    private async current() {
        const native = await this.readCurrent();
        if (!native.modelId) return { model: null, actual: native.reasoningEffort ?? null, supported: [...levels] };
        const { list } = await this.session().rpc.model.list();
        if (!Array.isArray(list)) throw new Error("The main model catalog is invalid.");
        const model = list.find(value => record(value) && value.id === native.modelId);
        if (!record(model)) throw new Error("The selected main model is unavailable in the authenticated catalog.");
        const advertised = model.supportedReasoningEfforts ?? [];
        if (!Array.isArray(advertised)) throw new Error("The main model advertised invalid effort levels.");
        const supported: string[] = [];
        for (const value of advertised) {
            if (typeof value !== "string" || !levels.includes(value) || supported.includes(value)) throw new Error("The main model advertised invalid effort levels.");
            supported.push(value);
        }
        return { model: native.modelId, actual: native.reasoningEffort ?? null, supported };
    }
    private async idle() {
        const [processing, activity] = await Promise.all([
            this.session().rpc.metadata.isProcessing(), this.session().rpc.metadata.activity(),
        ]);
        if (processing.processing !== false || activity.hasActiveWork !== false) {
            throw new Error("Main-session effort changes require idle native work.");
        }
    }
    async validate(effort: string): Promise<void> {
        await this.desired();
        if (!levels.includes(effort)) throw new Error("Invalid main-session reasoning effort.");
        if (this.changing) throw new Error("A main-session effort change is already in progress.");
        await this.idle();
        const actual = await this.current();
        if (actual.model && !actual.supported.includes(effort)) throw new Error("The main model does not advertise this reasoning effort.");
    }
    async select(effort: string): Promise<MainEffortStatus> {
        await this.validate(effort);
        if (this.changing) throw new Error("A main-session effort change is already in progress.");
        this.changing = true;
        try {
            await writeJsonAtomically(this.path, { schemaVersion: "main-session-effort/v1", desired: effort });
            this.error = null;
            await this.applySaved();
        } catch (error) {
            this.error = error instanceof Error ? error.message : "Main effort could not be applied.";
            throw error;
        } finally { this.changing = false; }
        return this.status();
    }
    async applySaved(): Promise<void> {
        const desired = await this.desired();
        if (desired === null) return;
        const current = await this.current();
        if (!current.model) return;
        if (!current.supported.includes(desired)) throw new Error("Saved effort is not supported by the selected main model.");
        if (current.actual !== desired) {
            await this.idle();
            await this.session().rpc.model.setReasoningEffort({ reasoningEffort: desired });
        }
        const actual = await this.readCurrent();
        if (actual.modelId !== current.model || actual.reasoningEffort !== desired) throw new Error("Main-session effort readback did not match; no substitute was accepted.");
        this.error = null;
    }
    async assertApplied(): Promise<void> {
        const desired = await this.desired();
        if (desired === null) return;
        const actual = await this.readCurrent();
        if (this.changing || !actual.modelId || actual.reasoningEffort !== desired) throw new Error("Apply the selected project effort to the main session before starting Stage1 work.");
    }
    async status(): Promise<MainEffortStatus> {
        const desired = await this.desired();
        try {
            const current = await this.current();
            const error = this.error || (desired !== null && current.model && !current.supported.includes(desired)
                ? "The main model does not support the saved project effort." : null);
            return { ...current, desired, status: error ? "error" : desired === null ? "unset" : current.model && current.actual === desired ? "applied" : "pending", error };
        } catch (error) {
            return { desired, actual: null, model: null, supported: [], status: "error",
                error: error instanceof Error ? error.message : "Main effort readback is unavailable." };
        }
    }
}

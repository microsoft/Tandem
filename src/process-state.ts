import { executionDigest } from "./execution.js";
import { ProjectStoreError } from "./project-store.js";
import { validateAcceptanceRecords, type AcceptanceRecord } from "./accepted-artifacts.js";
import type { LifecycleStageId, TandemState } from "./types.js";
import { lifecycleStages } from "./workflow.js";
import { ownershipPath } from "./scheduling.js";

export type ProcessBlock = "handoff" | "status" | "intake";
export type AdapterId = "local" | "github";

export interface VerificationCheck {
    id: string;
    program: string;
    args: string[];
    afterWorkItems: string[];
    stage: "implementation" | "test";
    timeoutSeconds: number;
}

export interface ProcessSettings {
    adapters: Record<ProcessBlock, AdapterId>;
    githubRepository: string;
    autoStartImplementation: boolean;
    autoStartTests: boolean;
    verification: {
        enabled: boolean;
        independentReview: boolean;
        checks: VerificationCheck[];
        protectedPaths: string[];
    };
}

export interface ProcessReceipt {
    id: string;
    adapter: AdapterId;
    block: ProcessBlock;
    reference: string;
    recordedAt: string;
    inputHash: string;
    summary: string;
    followupId?: string;
}

export interface ProcessEvent {
    id: string;
    stage: LifecycleStageId;
    kind: "ready" | "accepted" | "scheduled" | "reopened" | "configuration" | "handoff" | "intake";
    at: string;
    detail: string;
}

export interface ProcessState {
    version: 1;
    settings: ProcessSettings;
    acceptances: AcceptanceRecord[];
    receipts: ProcessReceipt[];
    events: ProcessEvent[];
    source: { adapter: AdapterId; reference: string; parentEffortId: string | null } | null;
    deliveryDraft: { id: string; body: string; sourceFingerprint: string; acceptanceIds: string[] } | null;
    runs: { runId: string; kind: "implementation" | "testing"; activeMs: number; nanoAiu: number; models: string[] }[];
    meteringError: string;
    message: string;
}

export function processError(message: string): never {
    throw new ProjectStoreError("process_invalid", message, 422);
}

export function objectValue(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return processError("Expected a process object.");
    return value as Record<string, unknown>;
}

export function textValue(value: unknown, name: string, max = 2000, allowEmpty = false): string {
    if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
        return processError(`Invalid ${name}.`);
    }
    return value;
}

function booleanValue(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") return processError(`Invalid ${name}.`);
    return value;
}

export function adapterId(value: unknown): AdapterId {
    if (value !== "local" && value !== "github") return processError("Select a registered Local or GitHub adapter.");
    return value;
}

function listValue(value: unknown, name: string, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max) return processError(`Invalid ${name}.`);
    return value;
}

export function defaultProcessSettings(): ProcessSettings {
    return {
        adapters: { handoff: "local", status: "local", intake: "local" },
        githubRepository: "",
        autoStartImplementation: false,
        autoStartTests: false,
        verification: { enabled: false, independentReview: true, checks: [], protectedPaths: [] },
    };
}

export function normalizeProcessSettings(value: unknown): ProcessSettings {
    const source = objectValue(value);
    const adapters = objectValue(source.adapters);
    const verification = objectValue(source.verification);
    const githubRepository = textValue(source.githubRepository, "GitHub repository", 200, true).trim();
    if (githubRepository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository)) {
        return processError("GitHub repository must be owner/repo.");
    }
    const checks = listValue(verification.checks, "verification checks", 30).map((value): VerificationCheck => {
        const check = objectValue(value);
        const id = textValue(check.id, "check ID", 80);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return processError("Check IDs must be lowercase slugs.");
        const program = textValue(check.program, "executable", 500);
        if (/[\r\n\0]/.test(program)) return processError("Executable contains invalid characters.");
        const args = listValue(check.args, "command arguments", 50).map((arg) => textValue(arg, "argument", 2000, true));
        if (args.some((arg) => arg.includes("\0"))) return processError("Command argument contains a null character.");
        const afterWorkItems = listValue(check.afterWorkItems, "check prerequisites", 30)
            .map((id) => textValue(id, "work item ID", 120));
        if (check.stage !== "implementation" && check.stage !== "test") return processError("Invalid verification stage.");
        if (!Number.isSafeInteger(check.timeoutSeconds) || Number(check.timeoutSeconds) < 1 ||
            Number(check.timeoutSeconds) > 3600) return processError("Check timeout must be 1-3600 seconds.");
        return { id, program, args, afterWorkItems, stage: check.stage, timeoutSeconds: Number(check.timeoutSeconds) };
    });
    if (new Set(checks.map((check) => check.id)).size !== checks.length) return processError("Check IDs must be unique.");
    const enabled = booleanValue(verification.enabled, "verification setting");
    const protectedPaths = listValue(verification.protectedPaths ?? [], "protected paths", 50)
        .map((path) => textValue(path, "protected path", 500));
    protectedPaths.forEach(ownershipPath);
    if (enabled && !checks.some((check) => check.stage === "test")) {
        return processError("Evidence-driven verification requires at least one final Test command.");
    }
    return {
        adapters: { handoff: adapterId(adapters.handoff), status: adapterId(adapters.status), intake: adapterId(adapters.intake) },
        githubRepository,
        autoStartImplementation: booleanValue(source.autoStartImplementation, "implementation automation"),
        autoStartTests: booleanValue(source.autoStartTests, "test automation"),
        verification: {
            enabled,
            independentReview: booleanValue(verification.independentReview, "independent review"),
            checks,
            protectedPaths,
        },
    };
}

export function createProcessState(): ProcessState {
    return { version: 1, settings: defaultProcessSettings(), acceptances: [], receipts: [], events: [], source: null, deliveryDraft: null,
        runs: [], meteringError: "", message: "" };
}

export function normalizeProcessState(value: unknown): ProcessState {
    if (value === undefined) return createProcessState();
    const source = objectValue(value);
    if (source.version !== 1) return processError("Unsupported process state version. The saved state is preserved.");
    const events = listValue(source.events, "process events", 5000).map((value): ProcessEvent => {
        const event = objectValue(value);
        const stage = lifecycleStages.find((stage) => stage.id === event.stage)?.id;
        const kind = event.kind as ProcessEvent["kind"];
        if (!stage || !["ready", "accepted", "scheduled", "reopened", "configuration", "handoff", "intake"].includes(kind)) {
            return processError("Invalid process event.");
        }
        return { id: textValue(event.id, "event ID"), stage, kind,
            at: textValue(event.at, "event time"), detail: textValue(event.detail, "event detail", 4000, true) };
    });
    const receipts = listValue(source.receipts, "process receipts", 1000).map((value): ProcessReceipt => {
        const receipt = objectValue(value);
        if (!["handoff", "status", "intake"].includes(String(receipt.block))) return processError("Invalid process block.");
        return {
            id: textValue(receipt.id, "receipt ID"), adapter: adapterId(receipt.adapter),
            block: receipt.block as ProcessBlock, reference: textValue(receipt.reference, "receipt reference", 2000),
            recordedAt: textValue(receipt.recordedAt, "receipt time"), inputHash: textValue(receipt.inputHash, "receipt input hash"),
            summary: textValue(receipt.summary, "receipt summary", 12000),
            ...(receipt.followupId === undefined ? {} : { followupId: textValue(receipt.followupId, "linked effort", 80) }),
        };
    });
    const origin = source.source === null ? null : objectValue(source.source);
    const draft = source.deliveryDraft == null ? null : objectValue(source.deliveryDraft);
    const runs = listValue(source.runs ?? [], "factory metering", 1000).map((value): ProcessState["runs"][number] => {
        const run = objectValue(value);
        if ((run.kind !== "implementation" && run.kind !== "testing") || typeof run.activeMs !== "number" ||
            !Number.isFinite(run.activeMs) || run.activeMs < 0 || typeof run.nanoAiu !== "number" ||
            !Number.isFinite(run.nanoAiu) || run.nanoAiu < 0) return processError("Invalid factory metering.");
        return { runId: textValue(run.runId, "metering run ID", 200), kind: run.kind,
            activeMs: run.activeMs, nanoAiu: run.nanoAiu,
            models: listValue(run.models, "model list", 30).map((model) => textValue(model, "model", 200)) };
    });
    return {
        version: 1, settings: normalizeProcessSettings(source.settings),
        acceptances: validateAcceptanceRecords(source.acceptances), receipts, events,
        source: origin ? { adapter: adapterId(origin.adapter), reference: textValue(origin.reference, "origin reference"),
            parentEffortId: origin.parentEffortId === null ? null : textValue(origin.parentEffortId, "parent effort") } : null,
        deliveryDraft: draft ? {
            id: textValue(draft.id, "delivery draft ID", 64),
            body: textValue(draft.body, "delivery draft", 60000),
            sourceFingerprint: textValue(draft.sourceFingerprint, "delivery sources", 64),
            acceptanceIds: listValue(draft.acceptanceIds, "delivery acceptances", 100)
                .map((id) => textValue(id, "acceptance ID", 200)),
        } : null,
        runs, meteringError: textValue(source.meteringError ?? "", "metering error", 2000, true),
        message: textValue(source.message, "process message", 12000, true),
    };
}

export function currentAcceptances(state: Pick<TandemState, "process" | "lifecycle">): AcceptanceRecord[] {
    return (state.process?.acceptances || []).filter((record) =>
        state.lifecycle.outputs.some((output) => output.stageId === record.stageId && output.path === record.snapshotPath));
}

export function processEvent(process: ProcessState, stage: LifecycleStageId, kind: ProcessEvent["kind"],
    detail: string, identity: string, at = new Date().toISOString()): ProcessState {
    const id = executionDigest({ stage, kind, identity });
    if (process.events.some((event) => event.id === id)) return process;
    if (process.events.length >= 5000) return processError("Process event history is full. Start a new linked effort.");
    return { ...process, events: [...process.events, { id, stage, kind, detail, at }] };
}

export function processMetrics(process: ProcessState) {
    const intervals = process.events.filter((event) => event.kind === "accepted").flatMap((accepted) => {
        const ready = process.events.filter((event) => event.stage === accepted.stage && event.kind === "ready" &&
            event.at <= accepted.at).at(-1);
        const duration = ready ? Date.parse(accepted.at) - Date.parse(ready.at) : NaN;
        return Number.isFinite(duration) && duration >= 0 ? [{ stage: accepted.stage, waitingMs: duration }] : [];
    });
    return {
        acceptanceCount: process.acceptances.length,
        reopenedCount: process.events.filter((event) => event.kind === "reopened").length,
        acceptanceWaitingMs: intervals.reduce((sum, interval) => sum + interval.waitingMs, 0),
        intervals,
        measuredRunCount: process.runs.length,
        measuredActiveMs: process.runs.length ? process.runs.reduce((sum, run) => sum + run.activeMs, 0) : null,
        measuredNanoAiu: process.runs.length ? process.runs.reduce((sum, run) => sum + run.nanoAiu, 0) : null,
    };
}

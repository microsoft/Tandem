import type { HumanLoopRuntimeHandle } from "../development/tandem/src/human-loop-controller.mjs";
import type { HumanLoopState } from "../development/tandem/runtime-types/domain/human-loop/model.js";
import type { SnapshotRef } from "../development/tandem/runtime-types/domain/human-loop/contracts.js";
import { executionDigest } from "./execution.js";
import { ProjectStoreError } from "./project-store.js";
import { readRetainedFile } from "./accepted-artifacts.js";
import { join } from "node:path";
import type { TandemArtifact, TandemState } from "./types.js";

export function projectDevelopmentDelivery(state: HumanLoopState, currentSource: SnapshotRef, handoffs: unknown[], nativeCommands: unknown[] = []) {
    const cycle = state.cycles.at(-1) ?? null;
    const outcome = cycle?.reviewResult ?? cycle?.implementationResult ?? state.handoffs.at(-1)?.result ?? null;
    const review = cycle?.reviewResult?.outcome;
    return {
        schemaVersion: "tandem-development-delivery/v1",
        owner: { id: state.owner.id, mainSessionId: state.owner.mainSessionId,
            privateSessionId: state.owner.privateSessionId, workspacePath: state.owner.workspacePath },
        revision: state.revision, design: state.design,
        source: currentSource,
        handoffs,
        cycle: cycle ? {
            id: cycle.id, phase: cycle.phase, design: cycle.design,
            requestIds: cycle.requestIds, originRequestIds: cycle.originRequestIds,
            baseline: cycle.baseline, current: cycle.current, reviewSnapshot: cycle.reviewSnapshot,
            planDigest: cycle.plan?.digest ?? null,
            tasks: cycle.tasks.map(task => ({ id: task.id, definitionDigest: task.definitionDigest, status: task.status, result: task.result })),
            implementationResult: cycle.implementationResult, reviewResult: cycle.reviewResult,
        } : null,
        outcome,
        reviewCoverage: review?.kind === "review-result" ? review.coverageStatus ?? "unavailable" : "unavailable",
        verificationLimits: [
            "Role completion, readiness and Review coverage are not tool-backed test passes.",
            ...(review?.kind === "review-result" ? review.verificationLimits : ["No complete Review result is available."]),
            ...(cycle && executionDigest(cycle.current) !== executionDigest(currentSource)
                ? ["Current workspace sources differ from the cycle's last recorded source snapshot."] : []),
        ],
        executionReferences: state.executions.filter(execution => cycle ? execution.binding.cycleId === cycle.id
            : execution.result?.resultId === outcome?.resultId).map(execution => ({
            taskId: execution.binding.id, requestId: execution.binding.requestId,
            role: execution.binding.role, inputDigest: execution.binding.inputDigest, design: execution.binding.design,
            before: execution.binding.before, after: execution.after,
            resultId: execution.result?.resultId ?? null, terminal: execution.terminal,
            completion: execution.completion ?? null, condition: execution.condition,
        })),
        nativeCommandEvidence: nativeCommands.map(value => {
            if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") {
                throw new ProjectStoreError("development_evidence_invalid", "A retained native command has no exact evidence identity.");
            }
            const keys = ["id", "sessionId", "shellId", "taskId", "requestId", "cycleId", "toolCallId", "status",
                "recordedStatus", "exitCode", "startedAt", "endedAt", "completionNotification", "controlUnbound", "controlRetirement", "reason"];
            return { recordDigest: executionDigest(value),
                ...Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key))) };
        }),
        questions: state.questions.filter(question => question.state === "open"),
        uncertainty: state.uncertainty,
        qualification: "Explicit human acceptance/export records this exact projection, including incomplete and unverified outcomes. It does not authorize implementation, publication, merge or deployment.",
    };
}

export async function captureDevelopmentDelivery(runtime: HumanLoopRuntimeHandle, handoffs: unknown[]): Promise<TandemArtifact> {
    const before = await runtime.store.load();
    if (before.activeTask || before.activeRequestId || before.stop || before.uncertainty) {
        throw new ProjectStoreError("development_busy", "Capture delivery at an explicit quiet boundary; running or uncertain work was not certified.");
    }
    const source = await runtime.workspace.capture();
    const commands = await runtime.commands.evidenceForCycle(before.cycles.at(-1)?.id ?? null);
    const current = await runtime.store.load();
    if (current.revision !== before.revision) throw new ProjectStoreError("development_changed", "Development changed during capture. Review its current outcome before retrying.");
    const projection = projectDevelopmentDelivery(current, source, handoffs, commands);
    const content = JSON.stringify(projection, null, 2);
    if (content.length > 200_000) throw new ProjectStoreError("development_delivery_large", "The exact delivery projection exceeds the accepted-artifact size limit; no evidence was truncated.");
    return { id: "development-outcome", title: "Development outcome and verification limits", kind: "development-outcome",
        stage: "development", path: "", language: "json", content, mermaid: "", reviewStatus: "current" };
}

export async function assertDevelopmentDeliveryCurrent(state: TandemState, sharedRoot: string, runtime: HumanLoopRuntimeHandle): Promise<void> {
    const output = state.lifecycle.outputs.find(output => output.stageId === "development");
    const portable = output?.path.replaceAll("\\", "/");
    if (!portable || !portable.startsWith(`.tandem/efforts/${state.prototypeId}/stages/`) ||
        !/^development-r[1-9][0-9]*\.json$/.test(portable.split("/").at(-1)!)) {
        throw new ProjectStoreError("development_capture_missing", "Capture a current Development outcome before accepting or publishing it.");
    }
    const snapshot = JSON.parse((await readRetainedFile(join(sharedRoot, ...portable.split("/")), 64 * 1024 * 1024)).toString("utf8"));
    const artifact = snapshot.result?.artifacts?.find((artifact: { id?: unknown }) => artifact.id === "development-outcome");
    if (!artifact || typeof artifact.content !== "string") throw new ProjectStoreError("development_capture_invalid", "The captured Development projection is invalid.");
    const projection = JSON.parse(artifact.content);
    const current = await runtime.store.load();
    if (projection.schemaVersion !== "tandem-development-delivery/v1" || projection.owner?.privateSessionId !== runtime.sessionId ||
        projection.owner?.mainSessionId !== current.owner.mainSessionId || current.revision !== projection.revision ||
        executionDigest(current.design) !== executionDigest(projection.design)) {
        throw new ProjectStoreError("development_capture_stale", "Development changed after capture. Capture and review its exact current outcome before accepting or publishing.");
    }
    await runtime.workspace.verifySnapshot(projection.source);
}

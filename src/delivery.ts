import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { exportAcceptedSnapshot } from "./accepted-artifacts.js";
import { currentAcceptances, objectValue, textValue, type ProcessState } from "./process-state.js";
import { executionDigest, fingerprintWorkspace } from "./execution.js";
import { ProjectStoreError, readJsonFile } from "./project-store.js";
import type { TandemState } from "./types.js";
import { HANDOFF_BODY_LIMIT_BYTES } from "./process-adapters.js";

// Reserve room for the adapter's title, effort, reference, and idempotency marker.
const maxDraftBytes = HANDOFF_BODY_LIMIT_BYTES - 4096;
const excerptNotice = "\n\n[Excerpt: the complete artifact is in the accepted snapshot.]";
type DeliveryState = Pick<TandemState, "prototypeId" | "lifecycle" | "process">;

function excerpt(content: string, maxBytes: number): string {
    const bytes = Buffer.from(content);
    if (bytes.toString("utf8") !== content || content.includes("\0")) {
        throw new ProjectStoreError("delivery_text_invalid", "Accepted artifact text cannot be represented in a delivery comment.");
    }
    if (bytes.length <= maxBytes) return content;
    const available = maxBytes - Buffer.byteLength(excerptNotice);
    if (available < 0) throw new ProjectStoreError("delivery_too_large", "Delivery metadata exceeds the comment budget.");
    return new StringDecoder("utf8").write(bytes.subarray(0, available)) + excerptNotice;
}

export async function prepareDeliveryDraft(state: DeliveryState, workspaceRoot: string, sharedRoot: string): Promise<{
    draft: NonNullable<ProcessState["deliveryDraft"]>;
    acceptances: ProcessState["acceptances"];
}> {
    const accepted = currentAcceptances(state);
    const final = accepted.filter((record) => record.stageId === "test").at(-1);
    if (!state.lifecycle.completedStages.includes("test") || !final) {
        throw new ProjectStoreError("delivery_not_ready", "Finish Test and explicitly accept its current handoff before preparing delivery.");
    }
    const sourceFingerprint = await fingerprintWorkspace(workspaceRoot);
    if (sourceFingerprint !== final.source.fingerprint) {
        throw new ProjectStoreError("delivery_sources_changed", "Sources changed after acceptance. Rerun Test and accept the new evidence.");
    }
    const exported = await exportAcceptedSnapshot(workspaceRoot, sharedRoot, state.prototypeId, final);
    if (!exported.exportPath) throw new ProjectStoreError("delivery_export_missing", "The accepted export did not return a bundle directory.");
    const snapshot = objectValue(await readJsonFile(join(workspaceRoot, exported.exportPath, "snapshot.json")));
    const result = objectValue(snapshot.result);
    const artifacts = Array.isArray(result.artifacts) ? result.artifacts.map(objectValue) : [];
    const sections = artifacts.filter((artifact) =>
        ["requirements-result", "design-spec", "execution-plan", "final-code", "test-results"].includes(String(artifact.id)));
    const prefix = [
        `# Tandem delivery handoff: ${state.prototypeId}`,
        "",
        textValue(result.goal, "accepted goal", 4000, true),
        "",
        `Accepted by ${final.acceptedBy.label} at ${final.acceptedAt}.`,
        "This is recorded attribution, not authenticated code-owner or release approval.",
        `Source commit: ${final.source.commit || "uncommitted repository"}`,
        `Source fingerprint: ${sourceFingerprint}`,
        `Accepted snapshot SHA256: ${final.snapshotHash}`,
        `Local bundle: ${exported.exportPath}`,
        "The local bundle is not automatically committed or uploaded. Commit the reviewed bundle if remote readers need its full contents.",
        "Evidence describes the local source fingerprint, including uncommitted files. Verify that the PR head contains those sources before relying on it for merge.",
        "",
    ].join("\n");
    const footer = [
        "## Delivery gate",
        "Human code-owner review, required CI checks, and release authorization remain outside this handoff. No merge or deployment is authorized.",
    ].join("\n");
    const headings = sections.map((artifact) => `## ${textValue(artifact.title, "artifact title", 200)}\n\n`);
    let available = maxDraftBytes - Buffer.byteLength([prefix, ...headings.map((heading) => `${heading}\n`), footer].join("\n"));
    if (available < 0) throw new ProjectStoreError("delivery_too_large", "Delivery metadata exceeds the comment budget.");
    const body = [prefix, ...sections.map((artifact, index) => {
        const content = excerpt(textValue(artifact.content, "artifact content", 200000, true),
            Math.min(8000, Math.floor(available / (sections.length - index))));
        available -= Buffer.byteLength(content);
        return `${headings[index]}${content}\n`;
    }), footer].join("\n");
    if (Buffer.from(body).toString("utf8") !== body || body.includes("\0")) {
        throw new ProjectStoreError("delivery_text_invalid", "Accepted delivery metadata contains invalid text.");
    }
    const acceptanceIds = accepted.map((record) => record.id);
    return {
        draft: { id: executionDigest({ body, sourceFingerprint, acceptanceIds }), body, sourceFingerprint, acceptanceIds },
        acceptances: state.process.acceptances.map((record) => record.id === exported.id ? exported : record),
    };
}

export async function assertDeliveryCurrent(state: DeliveryState, workspaceRoot: string): Promise<NonNullable<ProcessState["deliveryDraft"]>> {
    const draft = state.process.deliveryDraft;
    const current = currentAcceptances(state).map((record) => record.id);
    if (!draft || !state.lifecycle.completedStages.includes("test") ||
        !currentAcceptances(state).some((record) => record.stageId === "test") ||
        draft.acceptanceIds.some((id) => !current.includes(id)) ||
        await fingerprintWorkspace(workspaceRoot) !== draft.sourceFingerprint ||
        draft.id !== executionDigest({ body: draft.body, sourceFingerprint: draft.sourceFingerprint, acceptanceIds: draft.acceptanceIds })) {
        throw new ProjectStoreError("delivery_stale", "The delivery draft is stale. Prepare and review a fresh draft before publication.");
    }
    return draft;
}

import { normalizeProcessSettings, defaultProcessSettings, objectValue, processError, textValue,
    type ProcessSettings } from "./process-state.js";
import { normalizeWorkerContracts } from "./worker-contracts.js";
import { normalizeCommandEvidence, type CommandEvidence } from "./verification.js";
import { ownershipPath } from "./scheduling.js";

export interface IndependentVerdict {
    status: "passed" | "failed";
    summary: string;
    sourceFingerprint: string;
    inputRevision: string;
    requestId: string;
    runId: string;
}

export function normalizeExecutionProof(value: Record<string, unknown>) {
    const defaults = defaultProcessSettings();
    const verificationProfile: ProcessSettings["verification"] = value.verificationProfile === undefined
        ? defaults.verification
        : normalizeProcessSettings({ ...defaults, verification: value.verificationProfile }).verification;
    const verifiedSourceFingerprint = value.verifiedSourceFingerprint ?? null;
    if (verifiedSourceFingerprint !== null &&
        (typeof verifiedSourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(verifiedSourceFingerprint))) {
        processError("Invalid verified implementation source fingerprint.");
    }
    let independentVerdict: IndependentVerdict | null = null;
    if (value.independentVerdict !== undefined && value.independentVerdict !== null) {
        const verdict = objectValue(value.independentVerdict);
        if (verdict.status !== "passed" && verdict.status !== "failed") processError("Invalid independent verification status.");
        independentVerdict = {
            status: verdict.status as IndependentVerdict["status"],
            summary: textValue(verdict.summary, "independent summary", 12000),
            sourceFingerprint: textValue(verdict.sourceFingerprint, "verifier sources", 64),
            inputRevision: textValue(verdict.inputRevision, "verifier inputs", 64),
            requestId: textValue(verdict.requestId, "verifier request", 200),
            runId: textValue(verdict.runId, "verifier run", 200),
        };
    }
    const protectedSources = objectValue(value.protectedSources ?? {});
    if (Object.keys(protectedSources).length > 20000) processError("Too many protected source files.");
    for (const [path, hash] of Object.entries(protectedSources)) {
        ownershipPath(path);
        if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) processError("Invalid protected source fingerprint.");
    }
    return { verificationProfile, verifiedSourceFingerprint, independentVerdict, protectedSources: protectedSources as Record<string, string>,
        workerContracts: normalizeWorkerContracts(value.workerContracts),
        commandEvidence: normalizeCommandEvidence(value.commandEvidence) };
}

export function hasCurrentEvidence(evidence: CommandEvidence[], checkId: string,
    identity: { requestId: string; runId: string | null; inputRevision: string; sourceFingerprint: string | null }): boolean {
    const latest = evidence.filter((record) => record.checkId === checkId && record.requestId === identity.requestId &&
        record.runId === identity.runId && record.inputRevision === identity.inputRevision &&
        record.sourceFingerprint === identity.sourceFingerprint).at(-1);
    return latest?.status === "passed" && latest.exitCode === 0;
}

export function verificationCompletionError(runtime: Record<string, unknown>, kind: "implementation" | "test"): string | null {
    const proof = normalizeExecutionProof(runtime);
    if (!proof.verificationProfile.enabled) return null;
    const sourceFingerprint = kind === "implementation" ? proof.verifiedSourceFingerprint
        : typeof runtime.sourceFingerprint === "string" ? runtime.sourceFingerprint : null;
    for (const check of proof.verificationProfile.checks.filter((check) => check.stage === kind)) {
        const found = proof.commandEvidence.filter((record) => record.checkId === check.id &&
            record.inputRevision === runtime.inputRevision && record.requestId === runtime.requestId &&
            record.runId === runtime.runId && record.sourceFingerprint === sourceFingerprint).at(-1);
        if (found?.status !== "passed" || found.exitCode !== 0) return `Approved command "${check.id}" has no passing tool-backed evidence.`;
    }
    if (kind === "implementation" && !sourceFingerprint) return "Implementation sources have not been verified at settlement.";
    if (kind === "test" && proof.verificationProfile.independentReview) {
        const verdict = proof.independentVerdict;
        if (verdict?.status !== "passed" || verdict.inputRevision !== runtime.inputRevision ||
            verdict.sourceFingerprint !== sourceFingerprint || verdict.runId !== runtime.runId ||
            verdict.requestId !== runtime.requestId) return "Independent acceptance verification has not passed for these inputs.";
    }
    return null;
}

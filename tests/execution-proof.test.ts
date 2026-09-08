import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultProcessSettings } from "../src/process-state.js";
import { normalizeExecutionProof, verificationCompletionError } from "../src/execution-proof.js";

test("legacy execution proof is explicit and disabled rather than fabricated", () => {
    const proof = normalizeExecutionProof({});
    assert.equal(proof.verificationProfile.enabled, false);
    assert.equal(proof.independentVerdict, null);
    assert.deepEqual(proof.commandEvidence, []);
    assert.deepEqual(proof.workerContracts, []);
});

test("worker success cannot substitute for approved command evidence", () => {
    const profile = defaultProcessSettings().verification;
    profile.enabled = true;
    profile.checks = [{
        id: "test", program: "node", args: ["--version"], stage: "test", afterWorkItems: [], timeoutSeconds: 10,
    }];
    const error = verificationCompletionError({
        status: "completed", verificationProfile: profile, requestId: "request", runId: "run",
        inputRevision: "input", sourceFingerprint: "source", scenarios: [{ status: "passed", evidence: ["looks good"] }],
    }, "test");
    assert.match(error!, /no passing tool-backed evidence/);
});

test("malformed protected source baselines cannot be loaded silently", () => {
    assert.throws(() => normalizeExecutionProof({ protectedSources: { "..\\escape": "0".repeat(64) } }), /escape/);
    assert.throws(() => normalizeExecutionProof({ protectedSources: { "tests\\regression.ts": "not-a-hash" } }), /fingerprint/);
});

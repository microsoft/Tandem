import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createPayload, stagePayload, verifyPayload } from "../src/payload.js";
import { assertComposedProvider, assertComposedVersion, canvasActionResult, developmentCloseResult } from "../src/desktop/runtime.js";
import { nodeMainConsent } from "../src/main-consent.js";

test("full payload relocation includes assets/skills and asset-only changes invalidate staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-payload-"));
    try {
        const source = join(root, "package"), target = join(root, "session", "extensions", "tandem");
        const files = ["extension.mjs", "stage2/src/human-loop-controller.mjs", "stage2/public/human-loop.html",
            "stage2/public/human-loop.css", "stage2/public/vendors/LICENSE.md", "stage2/runtime-src/example.ts",
            "stage2/skills/design/SKILL.md", "skills/tandem/SKILL.md"];
        for (const path of files) {
            const full = join(source, ...path.split("/"));
            await mkdir(dirname(full), { recursive: true }); await writeFile(full, path);
        }
        const first = await createPayload(source, "1.1.15", files);
        assert.equal((await stagePayload(source, target)).changed, true);
        assert.equal((await stagePayload(source, target)).changed, false);
        await writeFile(join(source, "stage2", "public", "human-loop.css"), "asset-only update");
        const next = await createPayload(source, "1.1.15", files);
        assert.notEqual(next.digest, first.digest);
        assert.equal((await stagePayload(source, target)).changed, true);
        assert.equal(await readFile(join(target, "stage2", "public", "human-loop.css"), "utf8"), "asset-only update");
        assert.deepEqual(await verifyPayload(target), next);
        await rm(join(target, "stage2", "skills", "design", "SKILL.md"));
        await assert.rejects(verifyPayload(target), /ENOENT/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("incompatible preferred providers fail visibly rather than falling back", () => {
    assert.throws(() => assertComposedProvider({ extensionId: "user:tandem", actions: [{ name: "complete_stage" }] }),
        /user:tandem.*not replaced or bypassed/);
    const compatible = { extensionId: "session:mine:tandem",
        actions: ["get_integration", "close_development", "continue_design"].map(name => ({ name })) };
    assert.doesNotThrow(() => assertComposedProvider(compatible));
    const payload = { schemaVersion: "tandem-composed-payload/v1" as const, version: "1.1.15", digest: "a".repeat(64), files: [] };
    assert.doesNotThrow(() => assertComposedVersion({ result: { protocol: "development/v1", version: payload.version, payloadDigest: payload.digest } }, payload));
    assert.throws(() => assertComposedVersion({ result: { protocol: "development/v1", version: "older", payloadDigest: payload.digest } }, payload), /does not match/);
    for (const result of [undefined, null, [], "ready", { protocol: "development/v1" }]) {
        assert.throws(() => canvasActionResult(result), /unsupported canvas action response/);
    }
    assert.deepEqual(developmentCloseResult({ result: { status: "closed", warnings: ["Native save unconfirmed"] } }),
        { status: "closed", warnings: ["Native save unconfirmed"] });
    assert.throws(() => developmentCloseResult({ result: { status: "ready", warnings: [] } }), /close was not confirmed/);
});

test("Node main consent abstains immediately for the actual host, never grants private-session access", async () => {
    const permission = { kind: "shell", commands: ["fixture command"] };
    const handler = nodeMainConsent("main", () => "main");
    assert.deepEqual(await handler(permission, { sessionId: "main" }), { kind: "no-result" });
    assert.throws(() => handler(permission, { sessionId: "private" }), /registered Node host/);
    assert.throws(() => nodeMainConsent("main", () => "another")(permission, { sessionId: "main" }), /registered Node host/);
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPayload, stagePayload, verifyPayload } from "../src/payload.js";
import { assertComposedProvider, assertComposedVersion, canvasActionResult, developmentCloseResult } from "../src/desktop/runtime.js";
import { nodeMainConsent } from "../src/main-consent.js";

test("composed payload keeps the installed controller path independent of the development source layout",
    { skip: !process.env.TANDEM_PACKAGED_EXTENSION }, async () => {
    const source = dirname(resolve(process.env.TANDEM_PACKAGED_EXTENSION!));
    const root = await mkdtemp(fileURLToPath(new URL(".payload-relocation-", import.meta.url)));
    try {
        const target = join(root, "relocated");
        const { manifest } = await stagePayload(source, target);
        const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
        assert.equal(manifest.version, metadata.version);
        assert.equal(manifest.files.some(file => file.path.startsWith("development/")), false);
        const entry = await readFile(join(target, "extension.mjs"), "utf8");
        assert.match(entry, /from ["']\.\/stage2\/src\/human-loop-controller\.mjs["']/);
        assert.doesNotMatch(entry, /from ["'][^"']*development\/tandem\//);
        const controllerPath = join(target, "stage2", "src", "human-loop-controller.mjs");
        assert.deepEqual(await readFile(controllerPath),
            await readFile(new URL("../development/tandem/src/human-loop-controller.mjs", import.meta.url)));
        // Import only the side-effect-free controller, never the native startup entrypoint.
        const controller = await import(pathToFileURL(controllerPath).href);
        assert.equal(typeof controller.createHumanLoopController, "function");
        assert.equal(typeof controller.createDurablePrivateSession, "function");
        assert.deepEqual(await verifyPayload(target), manifest);
    } finally { await rm(root, { recursive: true, force: true }); }
});

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

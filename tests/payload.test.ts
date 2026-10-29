import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createPayload, stagePayload, verifyPayload } from "../src/payload.js";
import { assertComposedProvider, assertComposedVersion, canvasActionResult, createSourcePreviewLaunchProvider, developmentCloseResult } from "../src/desktop/runtime.js";
import { nodeMainConsent } from "../src/main-consent.js";

test("extension ZIP extracts to a complete verified payload, including the preview launcher",
    { skip: !process.env.TANDEM_PACKAGED_ZIP }, async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-zip-"));
    try {
        const archive = resolve(process.env.TANDEM_PACKAGED_ZIP!);
        const run = promisify(execFile);
        if (process.platform === "win32") await run("tar", ["-xf", archive, "-C", root]);
        else await run("unzip", ["-q", archive, "-d", root]);
        const directory = join(root, "extensions", "tandem");
        const manifest = await verifyPayload(directory);
        const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
        assert.equal(manifest.version, metadata.version);
        assert.ok(manifest.files.some(file => file.path === "preview-launcher.mjs"));
        assert.deepEqual(await readFile(join(root, "skills", "tandem", "SKILL.md")),
            await readFile(join(directory, "skills", "tandem", "SKILL.md")));
        for (const name of ["LICENSE.txt", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "SUPPORT.md"]) {
            for (const prefix of ["", "source", join("extensions", "tandem")]) {
                assert.deepEqual(await readFile(join(root, prefix, name)), await readFile(new URL(`../${name}`, import.meta.url)));
            }
        }
        await rm(join(directory, "preview-launcher.mjs"));
        await assert.rejects(verifyPayload(directory), /ENOENT/);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("standalone archive contains every manifest file with matching hashes",
    { skip: !process.env.TANDEM_PACKAGED_ARCHIVE }, async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-archive-"));
    try {
        await promisify(execFile)("tar", ["-xzf", resolve(process.env.TANDEM_PACKAGED_ARCHIVE!), "-C", root]);
        const directory = join(root, "package");
        const manifest = await verifyPayload(directory);
        const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
        assert.equal(metadata.version, manifest.version);
        assert.ok(manifest.files.some(file => file.path === "preview-launcher.mjs"));
        for (const name of ["cli.mjs", "host.mjs", "source-preview-extension.mjs"]) assert.ok((await stat(join(directory, name))).isFile());
        for (const name of ["LICENSE.txt", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "SUPPORT.md"]) {
            assert.deepEqual(await readFile(join(directory, name)), await readFile(new URL(`../${name}`, import.meta.url)));
        }
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

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
        actions: ["get_integration", "close_development", "get_application", "execute_application"].map(name => ({ name })) };
    assert.doesNotThrow(() => assertComposedProvider(compatible));
    const payload = { schemaVersion: "tandem-composed-payload/v1" as const, version: "1.1.15", digest: "a".repeat(64), files: [] };
    assert.doesNotThrow(() => assertComposedVersion({ result: { protocol: "development/v1", applicationProtocol: "tandem-application/v1", version: payload.version, payloadDigest: payload.digest } }, payload));
    assert.throws(() => assertComposedVersion({ result: { protocol: "development/v1", version: "older", payloadDigest: payload.digest } }, payload), /does not match/);
    for (const result of [
        { protocol: "development/v1", version: payload.version, payloadDigest: "b".repeat(64) },
        { protocol: "development/v2", version: payload.version, payloadDigest: payload.digest },
        { protocol: "development/v1", version: "1.1.16", payloadDigest: "b".repeat(64) },
        null,
    ]) {
        assert.throws(() => assertComposedVersion({ result }, payload, "user:tandem"), error => {
            assert.match(String(error), /user:tandem.*does not match/);
            assert.match(String(error), /Expected protocol=.*version=.*payloadDigest=/);
            assert.match(String(error), /observed protocol=.*version=.*payloadDigest=/);
            assert.match(String(error), /No alternate provider was substituted/);
            return true;
        });
    }
    for (const result of [undefined, null, [], "ready", { protocol: "development/v1" }]) {
        assert.throws(() => canvasActionResult(result), /unsupported canvas action response/);
    }
    assert.deepEqual(developmentCloseResult({ result: { status: "closed", warnings: ["Native save unconfirmed"] } }),
        { status: "closed", warnings: ["Native save unconfirmed"] });
    assert.throws(() => developmentCloseResult({ result: { status: "ready", warnings: [] } }), /close was not confirmed/);
});

test("native source-preview launch resolver refuses installed code and verifies the exact session package", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-source-provider-"));
    try {
        const target = join(root, "session", "extensions", "tandem");
        const files = ["extension.mjs", "stage2/src/human-loop-controller.mjs", "stage2/public/human-loop.html", "skills/tandem/SKILL.md"];
        for (const path of files) {
            const file = join(target, ...path.split("/"));
            await mkdir(dirname(file), { recursive: true }); await writeFile(file, path);
        }
        const manifest = await createPayload(target, "1.1.15", files);
        const logs: string[] = [];
        const policy = createSourcePreviewLaunchProvider(root, "mine", message => logs.push(message));
        const entry = { id: "session:mine:tandem", name: "tandem", source: "session" as const, modulePath: join(target, "extension.mjs") };
        assert.deepEqual(await policy.provider.resolve(entry), {}, "nothing can execute until staging is verified");
        policy.activate(target, manifest);
        for (const foreign of [
            { ...entry, id: "user:tandem", source: "user" as const },
            { ...entry, id: "project:tandem", source: "project" as const },
            { ...entry, id: "session:another:tandem" },
            { ...entry, modulePath: join(root, "other", "extension.mjs") },
        ]) assert.deepEqual(await policy.provider.resolve(foreign), {}, "refuse execution, not merely canvas selection");
        const result = await policy.provider.resolve(entry);
        assert.deepEqual(result, { launch: { executable: process.execPath,
            args: [join(root, "source-preview-extension.mjs"), entry.modulePath, manifest.digest], env: {} } });
        assert.ok(logs.some(message => message.includes(`launching ${entry.id}`) && message.includes(manifest.digest)));
        await writeFile(join(target, "stage2", "public", "human-loop.html"), "changed asset");
        await assert.rejects(policy.provider.resolve(entry), /payload is missing or changed/);
        await createPayload(target, manifest.version, files);
        await assert.rejects(policy.provider.resolve(entry), /payload changed before launch/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("source-preview extension loader uses the native-injected SDK without starting another engine", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-source-loader-"));
    try {
        const sdk = join(root, "sdk"), target = join(root, "extension");
        await mkdir(join(sdk, "dist"), { recursive: true });
        await writeFile(join(sdk, "package.json"), JSON.stringify({ name: "@github/copilot-sdk", type: "module",
            exports: { ".": { import: "./dist/index.js", require: "./wrong-profile.cjs" },
                "./extension": { import: "./dist/extension.js", require: "./wrong-profile.cjs" } } }));
        await writeFile(join(sdk, "wrong-profile.cjs"), 'throw new Error("Do not resolve another SDK entrypoint.");');
        await writeFile(join(sdk, "dist", "index.js"), 'export const root = "host-sdk";');
        await writeFile(join(sdk, "dist", "extension.js"), 'export const extension = "host-extension-sdk";');
        const files = ["extension.mjs", "stage2/src/human-loop-controller.mjs", "stage2/public/human-loop.html", "skills/tandem/SKILL.md"];
        for (const path of files) {
            const file = join(target, ...path.split("/"));
            await mkdir(dirname(file), { recursive: true }); await writeFile(file, path);
        }
        await writeFile(join(target, "extension.mjs"), `
            import {root} from "@github/copilot-sdk";
            import {extension} from "@github/copilot-sdk/extension";
            import {createRequire} from "node:module";
            const cjsRoot = createRequire(import.meta.url)("@github/copilot-sdk").root;
            console.log(JSON.stringify({root, extension, cjsRoot, sessionId: process.env.SESSION_ID}));
            process.exit(0);
        `);
        const manifest = await createPayload(target, "fixture", files);
        const loader = fileURLToPath(new URL("../src/desktop/source-preview-extension.ts", import.meta.url));
        const args = ["--import", "tsx", loader, join(target, "extension.mjs"), manifest.digest];
        const env = { ...process.env, SESSION_ID: "existing-native-session",
            COPILOT_EXTENSION_PARENT_PID: String(process.pid), COPILOT_SDK_PATH: join(sdk, "dist") };
        const { stdout } = await promisify(execFile)(process.execPath, args, { env });
        assert.deepEqual(JSON.parse(stdout), { root: "host-sdk", extension: "host-extension-sdk",
            cjsRoot: "host-sdk", sessionId: "existing-native-session" });
        await assert.rejects(promisify(execFile)(process.execPath, [...args.slice(0, -1), "wrong-digest"], { env }),
            /payload changed/);
        await assert.rejects(promisify(execFile)(process.execPath, args, { env: { ...env, COPILOT_EXTENSION_PARENT_PID: "0" } }),
            /requires its native parent/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("Node main consent abstains immediately for the actual host, never grants private-session access", async () => {
    const permission = { kind: "shell", commands: ["fixture command"] };
    const handler = nodeMainConsent("main", () => "main");
    assert.deepEqual(await handler(permission, { sessionId: "main" }), { kind: "no-result" });
    assert.throws(() => handler(permission, { sessionId: "private" }), /registered Node host/);
    assert.throws(() => nodeMainConsent("main", () => "another")(permission, { sessionId: "main" }), /registered Node host/);
});

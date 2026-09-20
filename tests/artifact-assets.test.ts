import assert from "node:assert/strict";
import { test } from "node:test";
import { validateArtifactAssets, type ArtifactAsset } from "../src/artifact-assets.js";

const folder = ".tandem/efforts/example/sketches/12345678-1234-4234-8234-123456789abc";
const asset = (overrides = {}): ArtifactAsset => ({
    id: "scene", path: `${folder}/document.json`, hash: "a".repeat(64), mediaType: "application/json",
    ...overrides,
});

test("asset references are cloned, portable, and preserve supported media and hashes", () => {
    assert.deepEqual(validateArtifactAssets(undefined), []);
    assert.deepEqual(validateArtifactAssets([]), []);
    const input = [
        asset({ path: `${folder}/document.json`.replace(/\//g, "\\") }),
        asset({ id: "screen-svg", path: `${folder}/home.svg`, mediaType: "image/svg+xml" }),
        asset({ id: "screen-png", path: `${folder}/home.png`, mediaType: "image/png" }),
    ];
    const normalized = validateArtifactAssets(input);
    assert.equal(normalized[0].path, `${folder}/document.json`);
    assert.deepEqual(normalized.slice(1), input.slice(1));
    assert.notEqual(normalized[0], input[0]);
    normalized[0].id = "changed";
    assert.equal(input[0].id, "scene");
    const maximum = Array.from({ length: 25 }, (_, index) =>
        asset({ id: `screen-${index}`, path: `${folder}/screen-${index}.json` }));
    assert.equal(validateArtifactAssets(maximum).length, 25);
    assert.throws(() => validateArtifactAssets([...maximum, asset()]), { code: "artifact_assets_invalid" });
});

test("asset reference validation rejects malformed fields and unsupported schemas", () => {
    const malformed: unknown[] = [
        null, {}, "[]", [null], [[]], [new Date()], new Array(1),
        [{ ...asset(), extra: true }], [{ id: "scene", path: asset().path, hash: asset().hash }],
        [Object.assign(Object.create({ inherited: true }), asset())],
        [asset({ id: "" })], [asset({ id: " " })], [asset({ id: "a\0b" })], [asset({ id: "\n" })],
        [asset({ id: "a".repeat(121) })], [asset({ id: 12 })],
        [asset({ hash: "A".repeat(64) })], [asset({ hash: "g".repeat(64) })],
        [asset({ hash: "a".repeat(63) })], [asset({ hash: undefined })],
        [asset({ hash: `${"a".repeat(64)}\n` })], [asset({ hash: `${"a".repeat(64)}\u2028` })],
        [asset({ mediaType: "text/html" })], [asset({ mediaType: "toString" })],
        [asset({ mediaType: "image/png" })], [asset({ path: null })],
        [asset({ path: `${folder}/${"x".repeat(500)}.json` })],
    ];
    for (const value of malformed) {
        assert.throws(() => validateArtifactAssets(value), { code: "artifact_assets_invalid" });
    }
    assert.equal(validateArtifactAssets([asset({ id: "x".repeat(120) })])[0].id.length, 120);
});

test("asset paths reject absolute, escaped, redirected, reserved, or nonportable locations", () => {
    const invalidPaths = [
        "/document.json", "C:\\private\\document.json", "C:document.json", "\\\\server\\share\\document.json",
        `../${folder}/document.json`, `${folder}/../document.json`, `${folder}//document.json`,
        `${folder}/nested/document.json`, `${folder}/document.json/`, `${folder}/document.json:stream`,
        `${folder}/document.JSON`, `${folder}/document.json.`, `${folder}/document .json`,
        `${folder}/%2e%2e.json`, `${folder}/doc\u202e.json`, `${folder}/document.json\0`,
        `${folder}/document.json\n`, `${folder}/document.json\r`, `${folder}/document.json\u2028`, `${folder}/document.json\u2029`,
        `${folder}/con.json`, `${folder}/NUL.json`, `${folder}/LPT1.json`, `${folder}/COM9.foo.json`,
        folder.replace("/example/", "/EXAMPLE/") + "/document.json",
        folder.replace("/example/", "/example./") + "/document.json",
        folder.replace("/example/", "/con/") + "/document.json",
        folder.replace("/sketches/", "/stages/") + "/document.json",
        ".tandem/efforts/example/sketches/not-a-uuid/document.json",
        folder.replace("123456789abc", "123456789ABC") + "/document.json",
    ];
    for (const path of invalidPaths) {
        assert.throws(() => validateArtifactAssets([asset({ path })]), { code: "artifact_assets_invalid" }, path);
    }
});

test("duplicate asset IDs and portable path aliases are rejected", () => {
    assert.throws(() => validateArtifactAssets([
        asset(), asset({ path: `${folder}/second.json` }),
    ]), { code: "artifact_assets_invalid" });
    for (const path of [asset().path, asset().path.replace(/\//g, "\\"), `${folder}/DOCUMENT.json`]) {
        assert.throws(() => validateArtifactAssets([asset(), asset({ id: "second", path })]),
            { code: "artifact_assets_invalid" });
    }
});

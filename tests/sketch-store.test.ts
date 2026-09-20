import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { deflateSync } from "node:zlib";
import { SketchStore } from "../src/sketch-store.js";
import { renderSketchSvg, type SketchDocument, type SketchRevision } from "../src/sketch.js";

function document(): SketchDocument {
    return {
        version: 1,
        screens: [{
            id: "home", title: "Home", purpose: "Start here", decisionIds: ["entry-point"],
            width: 240, height: 240, notes: "",
            shapes: [{
                id: "title", kind: "text", x: 10, y: 10, width: 200, height: 30,
                text: "Hello", points: [], stroke: "none", fill: "#000000", fontSize: 20,
            }],
        }],
        transitions: [],
    };
}

function crc(bytes: Buffer): number {
    let value = 0xffffffff;
    for (const byte of bytes) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
    const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length);
    output.write(type, 4, "ascii");
    data.copy(output, 8);
    output.writeUInt32BE(crc(output.subarray(4, output.length - 4)), output.length - 4);
    return output;
}

function png(width = 240, height = 240, value = 255, options: {
    filter?: number; shortRaster?: boolean; extraRaster?: number; trailingCompressed?: boolean; color?: number; palette?: Buffer;
} = {}): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = options.color ?? 6;
    const channels = header[9] === 3 ? 1 : 4;
    const rowBytes = width * channels + 1;
    const raster = Buffer.alloc(rowBytes * height - (options.shortRaster ? 1 : 0) + (options.extraRaster ?? 0), value);
    for (let row = 0; row < height; row++) raster[row * rowBytes] = options.filter ?? 0;
    let compressed = deflateSync(raster);
    if (options.trailingCompressed) compressed = Buffer.concat([compressed, Buffer.from("trailing")]);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
        ...(options.palette ? [chunk("PLTE", options.palette)] : []), chunk("IDAT", compressed), chunk("IEND"),
    ]);
}

const options = { requirementsDigest: "a".repeat(64), source: "generated" as const, number: 1 };

async function fixture(t: TestContext) {
    const root = join(process.cwd(), ".tandem", `sketch-test-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new SketchStore(root);
    const path = (revision: SketchRevision, name: string) => join(root, ".tandem", "efforts", "example", "sketches", revision.id, name);
    return { root, store, path };
}

function preview(data = png(), screenId = "home") {
    return { screenId, data: data.toString("base64") };
}

test("sketch store saves independent immutable revisions and verifies scene bytes, metadata, and generated SVG", async (t) => {
    const { store, path } = await fixture(t);
    const input = document();
    const first = await store.save("example", input, options);
    const second = await store.save("example", input, { ...options, number: 2, source: "edited" });
    assert.match(first.id, /^[a-f0-9-]{36}$/);
    assert.notEqual(first.id, second.id);
    assert.equal(first.documentHash, second.documentHash);
    assert.equal(second.number, 2);
    assert.equal(second.source, "edited");
    assert.deepEqual(await store.read("example", first), input);
    const bytes = await readFile(path(first, "document.json"));
    assert.equal(first.documentHash, createHash("sha256").update(bytes).digest("hex"));
    assert.equal((await readFile(path(first, "home.svg"), "utf8")), renderSketchSvg(input.screens[0]));
    assert.deepEqual(JSON.parse(await readFile(path(first, "revision.json"), "utf8")), first);
    await assert.rejects(store.read("example", { ...first, requirementsDigest: "b".repeat(64) }), /metadata/);
    await assert.rejects(store.read("example", { ...first, number: 2 }), /metadata/);
    await assert.rejects(store.save("example", input, { ...options, number: 0 }), /revision number/);
});

test("sketch approval binds all screen JSON, SVG, and PNG assets and exact retries are idempotent", async (t) => {
    const { root, store, path } = await fixture(t);
    const input = document();
    input.screens.push({ ...structuredClone(input.screens[0]), id: "details", width: 320 });
    const revision = await store.save("example", input, options);
    const previews = [preview(), preview(png(320), "details")];
    const approval = await store.approve("example", revision, previews);
    assert.equal(approval.assets.length, 5);
    assert.equal(approval.documentHash, revision.documentHash);
    assert.equal(approval.requirementsDigest, revision.requirementsDigest);
    assert.deepEqual(await store.verifyApproval("example", revision, approval), input);
    assert.deepEqual(await store.approve("example", revision, [...previews].reverse()), approval);
    assert.deepEqual(await store.readImage("example", revision, approval, "home"), png());
    assert.deepEqual(JSON.parse(await readFile(path(revision, "approval.json"), "utf8")), approval);
    for (const asset of approval.assets) {
        const bytes = await readFile(join(root, ...asset.path.split("/")));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.hash);
    }
    const retries = await Promise.all([store.approve("example", revision, previews), store.approve("example", revision, previews)]);
    assert.deepEqual(retries, [approval, approval]);
    await assert.rejects(store.readImage("example", revision, approval, "../outside"), /requested screen/);
});

test("sketch approval rejects conflicting previews without overwriting previously approved bytes", async (t) => {
    const { store, path } = await fixture(t);
    const revision = await store.save("example", document(), options);
    const approval = await store.approve("example", revision, [preview()]);
    const before = await readFile(path(revision, "home.png"));
    await assert.rejects(store.approve("example", revision, [preview(png(240, 240, 0))]), /different approved PNG bytes/);
    assert.deepEqual(await readFile(path(revision, "home.png")), before);
    assert.deepEqual(await store.verifyApproval("example", revision, approval), document());
});

test("sketch approval rejects an externally altered SVG instead of approving its new hash", async (t) => {
    const { store, path } = await fixture(t);
    const revision = await store.save("example", document(), options);
    const altered = renderSketchSvg({ ...document().screens[0], title: "Not the frozen scene" });
    await writeFile(path(revision, "home.svg"), altered);
    await assert.rejects(store.approve("example", revision, [preview()]), /SVG no longer matches/);
    assert.equal(await readFile(path(revision, "home.svg"), "utf8"), altered);
    await assert.rejects(readFile(path(revision, "home.png")), { code: "ENOENT" });
    await assert.rejects(readFile(path(revision, "approval.json")), { code: "ENOENT" });
});

test("sketch approvals serialize concurrent first requests and preserve an incomplete conflicting PNG", async (t) => {
    const { store, path } = await fixture(t);
    const revision = await store.save("example", document(), options);
    const approvals = await Promise.all([
        store.approve("example", revision, [preview()]),
        store.approve("example", revision, [preview()]),
    ]);
    assert.deepEqual(approvals[0], approvals[1]);
    const next = await store.save("example", document(), { ...options, number: 2 });
    await writeFile(path(next, "home.png"), png(240, 240, 0));
    await assert.rejects(store.approve("example", next, [preview()]), /different bytes|byte limit/);
    assert.deepEqual(await readFile(path(next, "home.png")), png(240, 240, 0));
    await assert.rejects(readFile(path(next, "approval.json")), { code: "ENOENT" });
});

test("sketch approval requires exactly one canonical bounded base64 PNG per screen", async (t) => {
    const { store, path } = await fixture(t);
    const revision = await store.save("example", document(), options);
    for (const previews of [
        [], [preview(), preview()], [preview(png(), "missing")],
        [{ screenId: "home", data: `data:image/png;base64,${png().toString("base64")}` }],
        [{ screenId: "home", data: `${png().toString("base64")}\n` }],
        [{ screenId: "home", data: "a".repeat(4 * Math.ceil(1024 * 1024 / 3) + 4) }],
        [{ screenId: "home", data: png().toString("base64"), ignored: "no" }],
    ]) await assert.rejects(store.approve("example", revision, previews), /preview|Preview|PNG/);
    await assert.rejects(readFile(path(revision, "home.png")), { code: "ENOENT" });
    await assert.rejects(readFile(path(revision, "approval.json")), { code: "ENOENT" });
});

test("sketch PNG validation rejects mismatched dimensions, invalid CRCs, compressed streams, filters, and trailing bytes", async (t) => {
    const { store, path } = await fixture(t);
    const revision = await store.save("example", document(), options);
    const corruptCrc = Buffer.from(png());
    corruptCrc[corruptCrc.length - 1] ^= 1;
    const missingEnd = png().subarray(0, png().length - 12);
    const corruptSignature = Buffer.from(png()); corruptSignature[0] = 0;
    const animated = Buffer.concat([png().subarray(0, 33), chunk("acTL", Buffer.alloc(8)), png().subarray(33)]);
    const invalidChunkType = chunk("tEXt", Buffer.from("key\0value"));
    invalidChunkType[4] |= 128;
    invalidChunkType.writeUInt32BE(crc(invalidChunkType.subarray(4, invalidChunkType.length - 4)), invalidChunkType.length - 4);
    const invalidChunk = Buffer.concat([png().subarray(0, 33), invalidChunkType, png().subarray(33)]);
    for (const data of [
        png(241), png(240, 241), png(240, 240, 255, { shortRaster: true }),
        png(240, 240, 255, { filter: 5 }), png(240, 240, 255, { trailingCompressed: true }),
        png(240, 240, 255, { extraRaster: 2 * 1024 * 1024 }), invalidChunk,
        corruptCrc, missingEnd, corruptSignature, png().subarray(0, 40),
        Buffer.concat([png(), Buffer.from("extra")]), animated,
        png(240, 240, 0, { color: 3 }),
        png(240, 240, 1, { color: 3, palette: Buffer.from([0, 0, 0]) }),
    ]) await assert.rejects(store.approve("example", revision, [preview(data)]), /PNG/);
    await assert.rejects(readFile(path(revision, "home.png")), { code: "ENOENT" });
    assert.ok(await store.approve("example", revision, [preview(png(240, 240, 0, { color: 3, palette: Buffer.from([0, 0, 0]) }))]));
});

test("sketch PNG limit counts decoded bytes and accepts a valid preview at the exact byte boundary", async (t) => {
    const { store } = await fixture(t);
    const revision = await store.save("example", document(), options);
    const image = png();
    const padding = Buffer.alloc(1024 * 1024 - image.length - 12, 32);
    const padded = Buffer.concat([image.subarray(0, 33), chunk("teSt", padding), image.subarray(33)]);
    assert.equal(padded.length, 1024 * 1024);
    const tooLarge = Buffer.concat([image.subarray(0, 33), chunk("teSt", Buffer.concat([padding, Buffer.from(" ")])), image.subarray(33)]);
    await assert.rejects(store.approve("example", revision, [preview(tooLarge)]), /1 MiB/);
    const approval = await store.approve("example", revision, [preview(padded)]);
    assert.deepEqual(await store.readImage("example", revision, approval, "home"), padded);
});

test("sketch approval detects all asset tampering and forged bindings", async (t) => {
    const { store, path } = await fixture(t);
    const revision = await store.save("example", document(), options);
    const approval = await store.approve("example", revision, [preview()]);
    for (const name of ["document.json", "home.svg", "home.png", "revision.json", "approval.json"]) {
        const original = await readFile(path(revision, name));
        await writeFile(path(revision, name), Buffer.concat([original, Buffer.from(" ")]));
        await assert.rejects(store.verifyApproval("example", revision, approval), /hash|bytes|metadata|SVG|PNG/);
        await assert.rejects(store.readImage("example", revision, approval, "home"), /hash|bytes|metadata|SVG|PNG/);
        await writeFile(path(revision, name), original);
    }
    for (const forged of [
        { ...approval, documentHash: "f".repeat(64) },
        { ...approval, requirementsDigest: "f".repeat(64) },
        { ...approval, revisionId: randomUUID() },
        { ...approval, assets: approval.assets.map((asset) => ({ ...asset, hash: "f".repeat(64) })) },
        { ...approval, assets: approval.assets.map((asset) => ({ ...asset, path: asset.path.replace("example", "other") })) },
    ]) await assert.rejects(store.verifyApproval("example", revision, forged), /match|bind|unsafe/);
    assert.deepEqual(await store.verifyApproval("example", revision, approval), document());
});

test("sketch storage rejects traversal and noncanonical project or revision identities", async (t) => {
    const { store } = await fixture(t);
    for (const project of ["../outside", "..", "a/b", "a\\b", "CON", "con.txt", "trailing.", "Uppercase", " spaced "]) {
        await assert.rejects(store.save(project, document(), options));
    }
    assert.throws(() => new SketchStore("relative"), /absolute trusted directory/);
    const revision = await store.save("example", document(), options);
    for (const id of ["../outside", "a/b", "a\\b", "CON", "x".repeat(500)]) {
        await assert.rejects(store.read("example", { ...revision, id }), /UUID/);
    }
});

test("sketch storage refuses redirected roots, ancestors, and revision directories", async (t) => {
    const { root, store, path } = await fixture(t);
    const outside = join(root, "outside");
    await mkdir(outside);
    const rootLink = join(root, "linked-root");
    await symlink(outside, rootLink, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(new SketchStore(rootLink).save("example", document(), options), /materialized directories/);
    const otherRoot = join(root, "other");
    await mkdir(otherRoot);
    await symlink(outside, join(otherRoot, ".tandem"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(new SketchStore(otherRoot).save("example", document(), options), /materialized directories/);
    const revision = await store.save("example", document(), options);
    const directory = path(revision, "");
    await rm(directory, { recursive: true });
    await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(store.read("example", revision), /materialized directories/);
    await assert.rejects(store.approve("example", revision, [preview()]), /materialized directories/);
});

test("sketch storage refuses linked files and approval locks without following their targets", async (t) => {
    const { root, store, path } = await fixture(t);
    const revision = await store.save("example", document(), options);
    const outside = join(root, "outside.json");
    const content = await readFile(path(revision, "document.json"));
    await writeFile(outside, content);
    await rm(path(revision, "document.json"));
    await link(outside, path(revision, "document.json"));
    await assert.rejects(store.read("example", revision), /unlinked files/);
    assert.deepEqual(await readFile(outside), content);
    await rm(path(revision, "document.json"));
    await writeFile(path(revision, "document.json"), content);
    const target = join(root, "lock-target");
    await mkdir(target);
    await symlink(target, path(revision, ".approval.lock"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(store.approve("example", revision, [preview()]), /materialized directories/);
    await rm(path(revision, ".approval.lock"));
    try {
        await rm(path(revision, "document.json"));
        await symlink(outside, path(revision, "document.json"), "file");
    } catch (error) {
        if (process.platform === "win32" && error instanceof Error && "code" in error && error.code === "EPERM") {
            t.diagnostic("File symlink creation unavailable; directory junction and hard-link defenses verified.");
            return;
        }
        throw error;
    }
    await assert.rejects(store.read("example", revision), /unlinked files/);
});

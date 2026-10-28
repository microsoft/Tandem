import { join } from "node:path";
import { readRetainedFile } from "./accepted-artifacts.js";
import { prototypePreviewBridgeSource } from "./prototype-bridge.js";
import { readVisualManifest, visualManifestName, type VisualCheckpoint, type VisualManifest } from "./visual-directions.js";

async function previewAsset(url: URL, limit: number): Promise<string> {
    const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.body) throw new Error(`Visual preview asset returned HTTP ${response.status}: ${url.pathname}`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > limit) throw new Error(`Visual preview asset exceeds ${limit} bytes: ${url.pathname}`);
            chunks.push(chunk.value);
        }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks).toString("utf8");
}

export async function verifyVisualDirectionSource(options: {
    workspacePath: string; previewUrl: string; request: VisualCheckpoint; baseManifest: VisualManifest | null;
}): Promise<VisualManifest> {
    const { workspacePath, previewUrl, request, baseManifest } = options;
    if ([...new URL(previewUrl).searchParams.keys()].some(key => key.startsWith("tandem-"))) {
        throw new Error("Return the base visual preview URL without selection parameters; the source manifest must own its defaults.");
    }
    const manifest = readVisualManifest(JSON.parse((await readRetainedFile(join(workspacePath, visualManifestName), 32768)).toString("utf8")));
    const [servedManifest, servedBridge] = await Promise.all([
        previewAsset(new URL(visualManifestName, previewUrl), 32768),
        previewAsset(new URL("tandem-preview-bridge.js", previewUrl), 65536),
    ]);
    if (JSON.stringify(manifest) !== JSON.stringify(readVisualManifest(JSON.parse(servedManifest)))) {
        throw new Error("The live visual manifest does not match the checkpoint's retained source.");
    }
    if (servedBridge !== prototypePreviewBridgeSource) {
        throw new Error("The visual preview must serve the host-provided preview bridge unchanged.");
    }
    if (request.operation !== "explore") {
        if (!baseManifest || !request.selection) throw new Error("The visual update lost its bound source manifest or choice.");
        if (manifest.directions.map(item => item.id).join(",") !== baseManifest.directions.map(item => item.id).join(",")) {
            throw new Error("A visual update cannot replace or remove the other saved directions.");
        }
        for (const direction of manifest.directions) {
            if (request.operation === "refine" && direction.id === request.selection.directionId) continue;
            if (JSON.stringify(direction) !== JSON.stringify(baseManifest.directions.find(item => item.id === direction.id))) {
                throw new Error("A visual update changed an unrelated direction's design contract.");
            }
        }
        const expected = request.operation === "refine" ? baseManifest.defaultSelection : request.selection;
        if (JSON.stringify(manifest.defaultSelection) !== JSON.stringify(expected)) {
            throw new Error("The saved application defaults do not match the explicitly requested visual choice.");
        }
    }
    return manifest;
}

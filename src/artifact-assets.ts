import { ProjectStoreError } from "./project-store.js";

export interface ArtifactAsset {
    id: string;
    /** Canonical forward-slash path relative to the shared project root. */
    path: string;
    hash: string;
    mediaType: "application/json" | "image/svg+xml" | "image/png";
}

export const MAX_ARTIFACT_ASSETS = 25;
export const ARTIFACT_ASSET_LIMITS: Readonly<Record<ArtifactAsset["mediaType"], number>> = {
    "application/json": 256 * 1024,
    "image/svg+xml": 1024 * 1024,
    "image/png": 1024 * 1024,
};

const extensions: Readonly<Record<ArtifactAsset["mediaType"], string>> = {
    "application/json": "json",
    "image/svg+xml": "svg",
    "image/png": "png",
};
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function invalid(message: string): never {
    throw new ProjectStoreError("artifact_assets_invalid", message, 422);
}

/** Undefined is an empty list; unsafe or malformed references are never silently discarded. */
export function validateArtifactAssets(value: unknown): ArtifactAsset[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_ARTIFACT_ASSETS) {
        return invalid("Invalid or oversized artifact asset list.");
    }
    const ids = new Set<string>();
    const paths = new Set<string>();
    return Array.from(value, (entry): ArtifactAsset => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(entry)) ||
            Object.keys(entry).length !== 4 ||
            !["id", "path", "hash", "mediaType"].every((key) => Object.hasOwn(entry, key))) {
            return invalid("Expected an artifact asset with id, path, hash, and mediaType.");
        }
        const { id, path, hash, mediaType } = entry;
        if (typeof id !== "string" || !id.trim() || id.length > 120 || /[\x00-\x1f\x7f]/.test(id)) {
            return invalid("Invalid artifact asset ID.");
        }
        if (typeof hash !== "string" || hash.length !== 64 || !/^[a-f0-9]{64}$/.test(hash)) {
            return invalid("Artifact assets require a lowercase SHA256 hash.");
        }
        if (typeof mediaType !== "string" || !Object.hasOwn(extensions, mediaType)) {
            return invalid("Unsupported artifact asset media type.");
        }
        if (typeof path !== "string" || path.length > 500) return invalid("Invalid artifact asset path.");
        const portable = path.replace(/\\/g, "/");
        const match = /^\.tandem\/efforts\/([a-z0-9][a-z0-9._-]{0,79})\/sketches\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/([A-Za-z0-9][A-Za-z0-9._-]*\.(json|svg|png))$/.exec(portable);
        if (!match || match[0] !== portable || match[1].endsWith(".") || reserved.test(match[1]) || reserved.test(match[3]) ||
            match[4] !== extensions[mediaType as ArtifactAsset["mediaType"]]) {
            return invalid("Artifact assets must name safe sketch files beneath the shared effort directory.");
        }
        // Case-folded uniqueness also prevents filename aliases on Windows.
        const identity = portable.toLowerCase();
        if (ids.has(id) || paths.has(identity)) return invalid("Duplicate artifact asset IDs or paths.");
        ids.add(id);
        paths.add(identity);
        return { id, path: portable, hash, mediaType: mediaType as ArtifactAsset["mediaType"] };
    });
}

import type { ArtifactAsset } from "./artifact-assets.js";

export interface SketchShape {
    id: string;
    kind: "rectangle" | "ellipse" | "text" | "line" | "arrow" | "path";
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    points: Array<{ x: number; y: number }>;
    stroke: string;
    fill: string;
    fontSize: number;
}

export interface SketchScreen {
    id: string;
    title: string;
    purpose: string;
    decisionIds: string[];
    width: number;
    height: number;
    shapes: SketchShape[];
    notes: string;
}

export interface SketchTransition {
    id: string;
    fromScreenId: string;
    toScreenId: string;
    trigger: string;
    description: string;
}

export interface SketchDocument {
    version: 1;
    screens: SketchScreen[];
    transitions: SketchTransition[];
}

export interface SketchRevision {
    id: string;
    number: number;
    requirementsDigest: string;
    documentHash: string;
    createdAt: string;
    source: "generated" | "edited" | "revised";
}

export interface SketchApproval {
    revisionId: string;
    requirementsDigest: string;
    documentHash: string;
    approvedAt: string;
    assets: ArtifactAsset[];
}

export interface SketchState {
    version: 1;
    status: "empty" | "draft" | "approved" | "stale";
    current: SketchRevision | null;
    approved: SketchApproval | null;
    history: SketchRevision[];
}

const MAX_DOCUMENT_BYTES = 256 * 1024;
const SLUG = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const KINDS = ["rectangle", "ellipse", "text", "line", "arrow", "path"] as const;

function invalid(message: string): never {
    throw new Error(`Invalid sketch: ${message}`);
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("expected an object.");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return invalid("expected a plain object.");
    const result = value as Record<string, unknown>;
    if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) {
        return invalid("unexpected or missing fields.");
    }
    return result;
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
    if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
        return invalid(`${label} must be ${allowEmpty ? "at most" : "nonempty and at most"} ${max} characters.`);
    }
    for (const character of value) {
        const code = character.codePointAt(0)!;
        if (!(code === 9 || code === 10 || code === 13 ||
            (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) ||
            (code >= 0x10000 && code <= 0x10ffff))) return invalid(`${label} contains invalid text.`);
    }
    return value;
}

function slug(value: unknown, label: string): string {
    const result = text(value, label, 80);
    if (!new RegExp(SLUG).test(result) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(result)) {
        return invalid(`${label} must be a safe lowercase slug.`);
    }
    return result;
}

function decisionReference(value: unknown): string {
    const result = text(value, "decision ID", 120);
    // References preserve existing Requirements identities; unlike scene IDs, they are never filenames.
    if (!/^[A-Za-z0-9._-]+$/.test(result)) return invalid("unsupported requirements decision ID.");
    return result;
}

function list(value: unknown, label: string, min: number, max: number): unknown[] {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
        return invalid(`${label} must contain ${min}–${max} items.`);
    }
    return Array.from(value);
}

function unique(values: string[], label: string): void {
    if (new Set(values).size !== values.length) invalid(`duplicate ${label}.`);
}

function number(value: unknown, label: string, min: number, max: number, integer = false): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
        (integer && !Number.isSafeInteger(value))) return invalid(`${label} is outside its supported range.`);
    return value;
}

function color(value: unknown): string {
    if (typeof value !== "string" || !/^(?:#[0-9a-fA-F]{6}|none)$/.test(value)) return invalid("unsupported color.");
    return value;
}

function screen(value: unknown): SketchScreen {
    const item = object(value, ["id", "title", "purpose", "decisionIds", "width", "height", "shapes", "notes"]);
    const width = number(item.width, "screen width", 240, 1600, true);
    const height = number(item.height, "screen height", 240, 1200, true);
    const decisionIds = list(item.decisionIds, "decision references", 1, 200).map(decisionReference);
    unique(decisionIds, "decision references");
    const shapes = list(item.shapes, "screen shapes", 0, 100).map((value): SketchShape => {
        const shape = object(value, ["id", "kind", "x", "y", "width", "height", "text", "points", "stroke", "fill", "fontSize"]);
        if (!KINDS.includes(shape.kind as SketchShape["kind"])) return invalid("unsupported shape kind.");
        const kind = shape.kind as SketchShape["kind"];
        const x = number(shape.x, "shape x", 0, width);
        const y = number(shape.y, "shape y", 0, height);
        const w = number(shape.width, "shape width", 0, width - x);
        const h = number(shape.height, "shape height", 0, height - y);
        const isBox = kind === "rectangle" || kind === "ellipse" || kind === "text";
        if (isBox && (w === 0 || h === 0)) return invalid("box and text dimensions must be positive.");
        const points = list(shape.points, "shape points", isBox ? 0 : 2, kind === "path" ? 512 : isBox ? 0 : 2)
            .map((value) => {
                const point = object(value, ["x", "y"]);
                return { x: number(point.x, "point x", 0, width), y: number(point.y, "point y", 0, height) };
            });
        return {
            id: slug(shape.id, "shape ID"), kind, x, y, width: w, height: h,
            text: text(shape.text, "shape text", 500, true), points,
            stroke: color(shape.stroke), fill: color(shape.fill),
            fontSize: number(shape.fontSize, "font size", 1, 500),
        };
    });
    unique(shapes.map((shape) => shape.id), "shape IDs");
    return {
        id: slug(item.id, "screen ID"), title: text(item.title, "screen title", 500),
        purpose: text(item.purpose, "screen purpose", 500), decisionIds, width, height, shapes,
        notes: text(item.notes, "screen notes", 4000, true),
    };
}

export function validateSketchDocument(value: unknown, decisionIds?: string[]): SketchDocument {
    const item = object(value, ["version", "screens", "transitions"]);
    if (item.version !== 1) return invalid("unsupported document version.");
    const screens = list(item.screens, "screens", 1, 8).map(screen);
    unique(screens.map((screen) => screen.id), "screen IDs");
    const screenIds = new Set(screens.map((screen) => screen.id));
    if (decisionIds !== undefined) {
        if (!Array.isArray(decisionIds) || decisionIds.some((id) => typeof id !== "string")) {
            return invalid("accepted decision IDs must be an array of strings.");
        }
        const accepted = new Set(decisionIds);
        if (screens.some((screen) => screen.decisionIds.some((id) => !accepted.has(id)))) {
            return invalid("a screen references a decision outside the accepted requirements DAG.");
        }
    }
    const transitions = list(item.transitions, "transitions", 0, 40).map((value): SketchTransition => {
        const transition = object(value, ["id", "fromScreenId", "toScreenId", "trigger", "description"]);
        const fromScreenId = slug(transition.fromScreenId, "transition source");
        const toScreenId = slug(transition.toScreenId, "transition destination");
        if (!screenIds.has(fromScreenId) || !screenIds.has(toScreenId)) return invalid("a transition references an unknown screen.");
        return {
            id: slug(transition.id, "transition ID"), fromScreenId, toScreenId,
            trigger: text(transition.trigger, "transition trigger", 500),
            description: text(transition.description, "transition description", 500, true),
        };
    });
    unique(transitions.map((transition) => transition.id), "transition IDs");
    const result: SketchDocument = { version: 1, screens, transitions };
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_DOCUMENT_BYTES) return invalid("document exceeds 256 KiB.");
    return result;
}

const idSchema = { type: "string", minLength: 1, maxLength: 80, pattern: SLUG };
const labelSchema = { type: "string", maxLength: 500 };
const pointSchema = {
    type: "object", additionalProperties: false, required: ["x", "y"],
    properties: { x: { type: "number", minimum: 0, maximum: 1600 }, y: { type: "number", minimum: 0, maximum: 1200 } },
};
const shapeSchema = {
    type: "object", additionalProperties: false,
    required: ["id", "kind", "x", "y", "width", "height", "text", "points", "stroke", "fill", "fontSize"],
    properties: {
        id: idSchema, kind: { type: "string", enum: [...KINDS] },
        x: { type: "number", minimum: 0, maximum: 1600 }, y: { type: "number", minimum: 0, maximum: 1200 },
        width: { type: "number", minimum: 0, maximum: 1600 }, height: { type: "number", minimum: 0, maximum: 1200 },
        text: labelSchema, points: { type: "array", maxItems: 512, items: pointSchema },
        stroke: { type: "string", pattern: "^(#[0-9a-fA-F]{6}|none)$" },
        fill: { type: "string", pattern: "^(#[0-9a-fA-F]{6}|none)$" },
        fontSize: { type: "number", minimum: 1, maximum: 500 },
    },
};

// Cross-field geometry and references are checked by validateSketchDocument.
export const sketchDocumentSchema = {
    type: "object", additionalProperties: false, required: ["version", "screens", "transitions"],
    properties: {
        version: { type: "integer", enum: [1] },
        screens: {
            type: "array", minItems: 1, maxItems: 8,
            items: {
                type: "object", additionalProperties: false,
                required: ["id", "title", "purpose", "decisionIds", "width", "height", "shapes", "notes"],
                properties: {
                    id: idSchema, title: { ...labelSchema, minLength: 1 }, purpose: { ...labelSchema, minLength: 1 },
                    decisionIds: {
                        type: "array", minItems: 1, maxItems: 200,
                        items: { type: "string", minLength: 1, maxLength: 120, pattern: "^[A-Za-z0-9._-]+$" },
                    },
                    width: { type: "integer", minimum: 240, maximum: 1600 },
                    height: { type: "integer", minimum: 240, maximum: 1200 },
                    shapes: { type: "array", maxItems: 100, items: shapeSchema },
                    notes: { type: "string", maxLength: 4000 },
                },
            },
        },
        transitions: {
            type: "array", maxItems: 40,
            items: {
                type: "object", additionalProperties: false,
                required: ["id", "fromScreenId", "toScreenId", "trigger", "description"],
                properties: {
                    id: idSchema, fromScreenId: idSchema, toScreenId: idSchema,
                    trigger: { ...labelSchema, minLength: 1 }, description: labelSchema,
                },
            },
        },
    },
};

function escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
    })[character]!);
}

export function renderSketchSvg(value: SketchScreen): string {
    const item = screen(value);
    const shapes = item.shapes.map((shape) => {
        const style = `stroke="${shape.stroke}" fill="${shape.fill}" stroke-width="2"`;
        let primitive: string;
        if (shape.kind === "rectangle") {
            primitive = `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" ${style}/>`;
        } else if (shape.kind === "ellipse") {
            primitive = `<ellipse cx="${shape.x + shape.width / 2}" cy="${shape.y + shape.height / 2}" rx="${shape.width / 2}" ry="${shape.height / 2}" ${style}/>`;
        } else if (shape.kind === "text") {
            const ink = shape.fill === "none" ? shape.stroke : shape.fill;
            primitive = `<text x="${shape.x}" y="${shape.y + Math.min(shape.fontSize, shape.height)}" font-family="sans-serif" font-size="${shape.fontSize}" fill="${ink}" stroke="none" xml:space="preserve">${escape(shape.text)}</text>`;
        } else if (shape.kind === "path") {
            primitive = `<path d="${shape.points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")}" ${style}/>`;
        } else {
            const [start, end] = shape.points;
            primitive = `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" ${style}/>`;
            if (shape.kind === "arrow") {
                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                const size = Math.min(10, Math.hypot(end.x - start.x, end.y - start.y) / 2);
                const left = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
                const right = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
                primitive += `<path d="M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}" fill="none" stroke="${shape.stroke}" stroke-width="2"/>`;
            }
        }
        return `<g data-shape-id="${shape.id}">${primitive}</g>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${item.width}" height="${item.height}" viewBox="0 0 ${item.width} ${item.height}"><title>${escape(item.title)}</title><rect width="${item.width}" height="${item.height}" fill="#ffffff"/>${shapes}</svg>`;
}

function hash(value: unknown, label: string): string {
    if (typeof value !== "string" || !HASH.test(value)) return invalid(`${label} must be a SHA256 hash.`);
    return value;
}

function uuid(value: unknown): string {
    if (typeof value !== "string" || !UUID.test(value)) return invalid("revision ID must be a random UUID.");
    return value;
}

function timestamp(value: unknown): string {
    if (typeof value !== "string" || value.length !== 24 || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value) return invalid("timestamp must be canonical ISO8601.");
    return value;
}

function revision(value: unknown): SketchRevision {
    const item = object(value, ["id", "number", "requirementsDigest", "documentHash", "createdAt", "source"]);
    if (!["generated", "edited", "revised"].includes(item.source as string)) return invalid("unsupported revision source.");
    return {
        id: uuid(item.id), number: number(item.number, "revision number", 1, Number.MAX_SAFE_INTEGER, true),
        requirementsDigest: hash(item.requirementsDigest, "requirements digest"),
        documentHash: hash(item.documentHash, "document hash"),
        createdAt: timestamp(item.createdAt), source: item.source as SketchRevision["source"],
    };
}

function approval(value: unknown): SketchApproval {
    const item = object(value, ["revisionId", "requirementsDigest", "documentHash", "approvedAt", "assets"]);
    const revisionId = uuid(item.revisionId);
    const documentHash = hash(item.documentHash, "document hash");
    const assets = list(item.assets, "approval assets", 3, 25).map((value): ArtifactAsset => {
        const asset = object(value, ["id", "path", "hash", "mediaType"]);
        const id = text(asset.id, "asset ID", 120);
        const path = text(asset.path, "asset path", 500);
        const parts = path.split(/[\\/]/);
        if (/[\x00-\x1f\x7f]/.test(id) || parts.length !== 6 ||
            parts[0] !== ".tandem" || parts[1] !== "efforts" || parts[3] !== "sketches" ||
            parts[2].length > 80 || parts[4] !== revisionId ||
            parts.slice(1).some((part) => !/^[a-z0-9][a-z0-9._-]*$/.test(part) ||
                part.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(part))) {
            return invalid("unsafe asset identity or path.");
        }
        if (!["application/json", "image/svg+xml", "image/png"].includes(asset.mediaType as string)) {
            return invalid("unsupported asset media type.");
        }
        const extension = { "application/json": "json", "image/svg+xml": "svg", "image/png": "png" }[asset.mediaType as ArtifactAsset["mediaType"]];
        if (!parts[5].endsWith(`.${extension}`)) return invalid("asset media type disagrees with its filename.");
        return { id, path, hash: hash(asset.hash, "asset hash"), mediaType: asset.mediaType as ArtifactAsset["mediaType"] };
    });
    unique(assets.map((asset) => asset.id), "asset IDs");
    unique(assets.map((asset) => asset.path.replace(/\\/g, "/")), "asset paths");
    const documents = assets.filter((asset) => asset.mediaType === "application/json");
    if (documents.length !== 1 || !documents[0].path.replace(/\\/g, "/").endsWith("/document.json") ||
        documents[0].hash !== documentHash) return invalid("approval must bind its document JSON and hash.");
    return {
        revisionId, requirementsDigest: hash(item.requirementsDigest, "requirements digest"),
        documentHash, approvedAt: timestamp(item.approvedAt), assets,
    };
}

export function emptySketchState(): SketchState {
    return { version: 1, status: "empty", current: null, approved: null, history: [] };
}

export function readSketchState(value: unknown): SketchState {
    if (value === undefined) return emptySketchState();
    const item = object(value, ["version", "status", "current", "approved", "history"]);
    if (item.version !== 1 || !["empty", "draft", "approved", "stale"].includes(item.status as string)) {
        return invalid("unsupported persisted state.");
    }
    const current = item.current === null ? null : revision(item.current);
    const approved = item.approved === null ? null : approval(item.approved);
    const history = list(item.history, "revision history", 0, 200).map(revision);
    unique(history.map((item) => item.id), "revision IDs");
    unique(history.map((item) => String(item.number)), "revision numbers");
    if (current) {
        const prior = history.find((item) => item.id === current.id || item.number === current.number);
        if (prior && JSON.stringify(prior) !== JSON.stringify(current)) return invalid("current revision conflicts with history.");
    }
    if (item.status === "empty" ? current !== null || approved !== null || history.length > 0 : current === null) {
        return invalid("state status disagrees with its current revision.");
    }
    if ((item.status === "draft" && approved !== null) || (item.status === "approved" && approved === null)) {
        return invalid("state status disagrees with its approval.");
    }
    if (approved && item.status !== "stale" && (!current || approved.revisionId !== current.id ||
        approved.requirementsDigest !== current.requirementsDigest || approved.documentHash !== current.documentHash)) {
        return invalid("approval does not match the current revision.");
    }
    return { version: 1, status: item.status as SketchState["status"], current, approved, history };
}

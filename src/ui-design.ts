import { hasScreenContent, validateSketchDocument, type DslSketchDocument } from "./sketch.js";
import { SketchOperationStream, type SketchStreamPhase } from "./sketch-stream.js";

export interface UiDesign {
    id: string;
    version: number;
    referenceIds: string[];
    document: DslSketchDocument;
}

export interface UiDesignPreview {
    current: UiDesign;
    previous: UiDesign | null;
}

export const UI_DESIGN_SLOT = "__TANDEM_UI_DESIGN_DATA__";

export function uiDesignVersion(design: UiDesign): string {
    return `${design.id}:${design.version}`;
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a UI design object.");
    return value as Record<string, unknown>;
}

export function readUiDesign(value: unknown): UiDesign {
    const data = record(value);
    if (Object.keys(data).sort().join() !== "document,id,referenceIds,version"
        || typeof data.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(data.id)
        || !Number.isSafeInteger(data.version) || Number(data.version) < 1) {
        throw new Error("Invalid current design identity or fields.");
    }
    const referenceIds = readUiDesignReferences(data.referenceIds);
    const document = validateSketchDocument(data.document, referenceIds);
    if (document.version !== 2) throw new Error("This preview requires a version-2 screen document containing UI DSL v1; preserve legacy originals separately.");
    return { id: data.id, version: Number(data.version), referenceIds, document };
}

export function readUiDesignReferences(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length
        || value.some(id => typeof id !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(id))
        || new Set(value).size !== value.length) {
        throw new Error("Provide distinct, nonempty source reference IDs from the brief or supplied requirements.");
    }
    return [...value];
}

export function uiDesignReadiness(design: UiDesign): string[] {
    const issues: string[] = [];
    for (const screen of design.document.screens) {
        const meaningful = Object.values(screen.ui.nodes).some(node =>
            !["Screen", "Stack", "Row", "Grid", "Card", "Section", "Spacer", "Divider"].includes(node.type)
            && (node.type === "Icon" ? Boolean(node.props.label)
                : ["text", "label", "title", "alt", "name", "items"].some(key => {
                    const value = node.props[key];
                    return typeof value === "string" ? Boolean(value.trim()) : Array.isArray(value) && value.length > 0;
                })));
        if (!hasScreenContent(screen) || !meaningful) issues.push(`${screen.id}: screen content is still needed.`);
        for (const node of Object.values(screen.ui.nodes)) {
            const target = node.type === "Button" ? node.props.action : node.type === "Link" ? node.props.destination : null;
            if (target && !design.document.transitions.some(edge => edge.id === target && edge.fromScreenId === screen.id)) {
                issues.push(`${screen.id}/${node.id}: "${target}" is not an outgoing preview transition.`);
            }
        }
    }
    return issues;
}

export function createUiDesign(id: string, references: unknown, outline: string): UiDesign {
    const referenceIds = readUiDesignReferences(references);
    const stream = new SketchOperationStream(null, referenceIds, undefined, "outline", undefined, false, "wireframe");
    stream.append(outline);
    return readUiDesign({ id, version: 1, referenceIds, document: stream.complete() });
}

export function patchUiDesign(base: UiDesign, expectedVersion: string, operations: string,
    phase: Exclude<SketchStreamPhase, "outline">, references: unknown = base.referenceIds): UiDesign {
    base = readUiDesign(base);
    if (uiDesignVersion(base) !== expectedVersion) throw new Error(`Stale design. Read current ${uiDesignVersion(base)} before editing.`);
    const referenceIds = readUiDesignReferences(references);
    // Old references must remain valid while the patch rebinds them to current intent.
    const allowed = [...new Set([...base.referenceIds, ...referenceIds])];
    const stream = new SketchOperationStream(base.document, allowed, undefined, phase, undefined, true);
    stream.append(operations);
    const next = readUiDesign({ ...base, version: base.version + 1, referenceIds, document: stream.complete() });
    const issues = uiDesignReadiness(next);
    if (issues.length) throw new Error(issues.join("\n"));
    return next;
}

export function readUiDesignPreview(value: unknown): UiDesignPreview {
    const data = record(value);
    if (Object.keys(data).sort().join() !== "current,previous") throw new Error("Invalid preview fields.");
    const current = readUiDesign(data.current);
    const previous = data.previous === null ? null : readUiDesign(data.previous);
    if (previous && (previous.id !== current.id || previous.version >= current.version)) {
        throw new Error("The retained view must be an earlier version of this design.");
    }
    return { current, previous };
}

export function parseUiDesignHtml(html: string): UiDesignPreview {
    const match = html.match(/<script id="ui-design-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) throw new Error("Current structured state is missing. Supply an actual document; do not reconstruct reviewed state from chat.");
    return readUiDesignPreview(JSON.parse(match[1]));
}

export function renderUiDesignHtml(template: string, preview: UiDesignPreview): string {
    const valid = readUiDesignPreview(preview);
    if (template.split(UI_DESIGN_SLOT).length !== 2) throw new Error("Invalid packaged preview template.");
    return template.replace(UI_DESIGN_SLOT, JSON.stringify(valid).replaceAll("<", "\\u003c"));
}

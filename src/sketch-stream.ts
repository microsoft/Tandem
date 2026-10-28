import {
    hasScreenContent,
    createSketchUi,
    validateSketchDocument,
    type SketchDocument,
    type DslSketchDocument,
    type DslSketchScreen,
    type SketchTransition,
    type SketchFidelity,
} from "./sketch.js";
import { applyOperations, DSLError, validateOperation, type UiDocument } from "./vendor/ui-dsl/index.js";

export type SketchScreenStatus = "waiting" | "processing" | "ready";
export type SketchStreamPhase = "outline" | "content" | "revision";

export interface SketchEditRepair {
    message: string;
    operation: unknown;
}

export class SketchEditValidationError extends Error {
    constructor(readonly repair: SketchEditRepair, cause: DSLError) {
        super(`Invalid design component: ${cause.message} (${cause.path})`, { cause });
    }
}

export interface SketchPreview {
    prototypeId: string;
    generation: string;
    requestId: string;
    runId: string;
    baseRevisionId: string | null;
    requirementsDigest: string;
    sequence: number;
    document: SketchDocument;
    screenStatuses?: Record<string, SketchScreenStatus>;
}

export interface SketchRecovery {
    phase: SketchStreamPhase;
    preview: SketchPreview;
    repair?: SketchEditRepair;
}

export function readSketchRecovery(value: unknown): SketchRecovery {
    const recovery = object(value, "recovery checkpoint");
    exactKeys(recovery, ["phase", "preview", ...(Object.hasOwn(recovery, "repair") ? ["repair"] : [])], "recovery checkpoint");
    const phase = recovery.phase;
    if (phase !== "outline" && phase !== "content" && phase !== "revision") return invalid("invalid recovery phase.");
    const preview = object(recovery.preview, "recovery preview");
    exactKeys(preview, ["prototypeId", "generation", "requestId", "runId", "requirementsDigest",
        "baseRevisionId", "sequence", "document", "screenStatuses"], "recovery preview");
    for (const field of ["prototypeId", "generation", "requestId", "runId", "requirementsDigest"]) {
        if (typeof preview[field] !== "string" || !preview[field] || preview[field].length > 512) {
            invalid(`invalid recovery ${field}.`);
        }
    }
    if (!(preview.baseRevisionId === null || typeof preview.baseRevisionId === "string" && preview.baseRevisionId !== "")
        || !Number.isSafeInteger(preview.sequence) || Number(preview.sequence) < 0) invalid("invalid recovery identity.");
    const document = validateSketchDocument(preview.document);
    if (document.version !== 2) invalid("recovery requires UI DSL.");
    const statuses = object(preview.screenStatuses, "recovery page statuses");
    exactKeys(statuses, document.screens.map(screen => screen.id), "recovery page statuses");
    const screenStatuses: Record<string, SketchScreenStatus> = {};
    for (const screen of document.screens) {
        const status = statuses[screen.id];
        if (status !== "waiting" && status !== "processing" && status !== "ready") return invalid("invalid recovery page status.");
        if (status === "ready" && !hasScreenContent(screen)) invalid("invalid recovery page status.");
        screenStatuses[screen.id] = status;
    }
    let repair: SketchEditRepair | undefined;
    if (recovery.repair !== undefined) {
        const correction = object(recovery.repair, "recovery correction");
        exactKeys(correction, ["message", "operation"], "recovery correction");
        if (typeof correction.message !== "string" || correction.message.length > 2000) return invalid("invalid recovery correction message.");
        repair = { message: correction.message, operation: structuredClone(object(correction.operation, "rejected operation")) };
    }
    return { phase, preview: {
        prototypeId: identifier(preview.prototypeId, "prototypeId"), generation: identifier(preview.generation, "generation"),
        requestId: identifier(preview.requestId, "requestId"), runId: identifier(preview.runId, "runId"),
        requirementsDigest: identifier(preview.requirementsDigest, "requirementsDigest"),
        baseRevisionId: preview.baseRevisionId === null ? null : identifier(preview.baseRevisionId, "baseRevisionId"),
        sequence: Number(preview.sequence), document, screenStatuses,
    }, ...(repair ? { repair } : {}) };
}

export const MAX_SKETCH_STREAM_RESPONSE_BYTES = 512 * 1024;
export const MAX_SKETCH_STREAM_RECORD_BYTES = 256 * 1024;
// The terminal done record does not count toward the operation limit.
export const MAX_SKETCH_STREAM_OPERATIONS = 1024;

const encoder = new TextEncoder();
const screenKeys = ["id", "title", "purpose", "decisionIds", "width", "height", "notes"];
// Official renamed Lucide exports, not substitutes for unknown icons.
const iconAliases: Readonly<Record<string, string>> = Object.freeze({
    "trash-2": "trash", filter: "funnel", "more-horizontal": "ellipsis", "more-vertical": "ellipsis-vertical",
    home: "house", edit: "square-pen", "edit-2": "pen", "edit-3": "pen-line",
    "help-circle": "circle-question-mark", "alert-circle": "circle-alert", "alert-triangle": "triangle-alert",
    "check-circle": "circle-check-big", "check-circle-2": "circle-check", "x-circle": "circle-x",
    "user-circle": "circle-user", "user-circle-2": "circle-user-round",
});

function invalid(message: string): never {
    throw new Error(`Invalid sketch operation stream: ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return invalid(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
        invalid(`${label} has unexpected or missing fields; expected ${keys.join(", ")}.`);
    }
}

function identifier(value: unknown, label: string): string {
    if (typeof value !== "string") return invalid(`${label} must be a string.`);
    return value;
}

function canonicalIconEdit(value: unknown, document: UiDocument): unknown {
    const edit = object(value, "UI edit");
    const component = edit.op === "add" ? object(edit.component, "UI component") : null;
    const type = component?.type ?? (edit.op === "update" && typeof edit.id === "string" && Object.hasOwn(document.nodes, edit.id)
        ? document.nodes[edit.id].type : null);
    const field = type === "Icon" ? "name" : type === "Button" || type === "Link" ? "icon" : null;
    if (!field) return edit;
    const props = object(component ? component.props : edit.props, "UI props");
    const name = props[field];
    if (typeof name !== "string" || !Object.hasOwn(iconAliases, name)) return edit;
    const normalized = { ...props, [field]: iconAliases[name] };
    return component ? { ...edit, component: { ...component, props: normalized } } : { ...edit, props: normalized };
}

function highSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function additionalBytes(fragment: string, previousHighSurrogate: boolean): number {
    const first = fragment.charCodeAt(0);
    // A split surrogate pair encodes as four bytes, not two three-byte replacements.
    const correction = previousHighSurrogate && first >= 0xdc00 && first <= 0xdfff ? 2 : 0;
    return encoder.encode(fragment).length - correction;
}

export class SketchOperationStream {
    #document: DslSketchDocument | null;
    #decisionIds: string[];
    #onChange?: (document: SketchDocument, sequence: number, screenStatuses: Record<string, SketchScreenStatus>) => void;
    #screenStatuses: Record<string, SketchScreenStatus>;
    #sequence = 0;
    #changes = 0;
    #done = false;
    #failure: Error | null = null;
    #responseBytes = 0;
    #responseHighSurrogate = false;
    #record = "";
    #recordBytes = 0;
    #recordHighSurrogate = false;
    #recordDepth = 0;
    #recordQuoted = false;
    #recordEscaped = false;
    #line = 0;
    #phase: SketchStreamPhase;
    #allowUnchanged: boolean;
    #fidelity?: SketchFidelity;

    constructor(
        base: SketchDocument | null,
        decisionIds: string[],
        onChange?: (document: SketchDocument, sequence: number, screenStatuses: Record<string, SketchScreenStatus>) => void,
        phase: SketchStreamPhase = "revision",
        screenStatuses?: Record<string, SketchScreenStatus>,
        allowUnchanged = false,
        fidelity?: SketchFidelity,
    ) {
        if (!Array.isArray(decisionIds) || decisionIds.some((id) => typeof id !== "string")) {
            invalid("accepted decision IDs must be an array of strings.");
        }
        this.#decisionIds = [...decisionIds];
        const document = base === null ? null : validateSketchDocument(base, this.#decisionIds);
        if (document?.version === 1) invalid("legacy geometry cannot be edited. Explicitly regenerate designs as UI DSL.");
        this.#document = document;
        this.#fidelity = document?.fidelity ?? fidelity;
        this.#phase = phase;
        this.#allowUnchanged = allowUnchanged;
        if (phase === "content" && !document) invalid("content generation requires a completed page outline.");
        this.#screenStatuses = Object.fromEntries((document?.screens ?? [])
            .map(screen => [screen.id, screenStatuses?.[screen.id] ?? (hasScreenContent(screen) ? "ready" : "waiting")]));
        this.#onChange = onChange;
    }

    get document(): SketchDocument | null {
        return this.#document === null ? null : structuredClone(this.#document);
    }

    get sequence(): number {
        return this.#sequence;
    }

    append(fragment: string): void {
        if (this.#failure) throw this.#failure;
        try {
            if (typeof fragment !== "string") invalid("append requires a string fragment.");
            if (fragment.length > MAX_SKETCH_STREAM_RESPONSE_BYTES) invalid("response exceeds 512 KiB.");
            this.#responseBytes += additionalBytes(fragment, this.#responseHighSurrogate);
            if (this.#responseBytes > MAX_SKETCH_STREAM_RESPONSE_BYTES) invalid("response exceeds 512 KiB.");
            if (fragment.length) {
                this.#responseHighSurrogate = highSurrogate(fragment.charCodeAt(fragment.length - 1));
            }

            let start = 0;
            while (start < fragment.length) {
                const newline = fragment.indexOf("\n", start);
                const end = newline === -1 ? fragment.length : newline;
                const piece = fragment.slice(start, end);
                if (this.#done && /\S/.test(piece)) invalid("no content is allowed after done.");
                this.#recordBytes += additionalBytes(piece, this.#recordHighSurrogate);
                if (this.#recordBytes > MAX_SKETCH_STREAM_RECORD_BYTES) invalid("record exceeds 256 KiB.");
                if (piece.length) {
                    this.#recordHighSurrogate = highSurrogate(piece.charCodeAt(piece.length - 1));
                    this.#record += piece;
                    for (const character of piece) {
                        if (this.#recordQuoted) {
                            if (this.#recordEscaped) this.#recordEscaped = false;
                            else if (character === "\\") this.#recordEscaped = true;
                            else if (character === '"') this.#recordQuoted = false;
                        } else if (character === '"') this.#recordQuoted = true;
                        else if (character === "{" || character === "[") this.#recordDepth++;
                        else if (character === "}" || character === "]") this.#recordDepth--;
                    }
                }
                if (newline === -1) break;
                if (this.#recordDepth > 0 && !this.#recordQuoted) {
                    // Formatting whitespace is legal JSON; never repair syntax or discard prose.
                    this.#record += "\n";
                    this.#recordBytes++;
                    if (this.#recordBytes > MAX_SKETCH_STREAM_RECORD_BYTES) invalid("record exceeds 256 KiB.");
                    this.#recordHighSurrogate = false;
                } else this.#consumeRecord();
                start = newline + 1;
            }
        } catch (error) {
            this.#fail(error);
        }
    }

    complete(): SketchDocument {
        if (this.#failure) throw this.#failure;
        try {
            if (this.#record.length) this.#consumeRecord();
            if (!this.#done) invalid("missing done record; the operation stream is incomplete.");
            if (!this.#document || this.#changes === 0 && !this.#allowUnchanged) invalid("at least one document-changing operation is required before done.");
            if (this.#phase === "content" && this.#document.screens.some(screen => !hasScreenContent(screen))) {
                invalid("content generation must fill every outlined page before done.");
            }
            return validateSketchDocument(this.#document, this.#decisionIds);
        } catch (error) {
            return this.#fail(error);
        }
    }

    #fail(error: unknown): never {
        this.#failure = error instanceof Error ? error : new Error(`Sketch operation stream failed: ${String(error)}`);
        throw this.#failure;
    }

    #consumeRecord(): void {
        const line = this.#record;
        this.#record = "";
        this.#recordBytes = 0;
        this.#recordHighSurrogate = false;
        this.#recordDepth = 0;
        this.#recordQuoted = false;
        this.#recordEscaped = false;
        this.#line++;
        if (!line.trim()) return;
        if (this.#done) invalid("no content is allowed after done.");
        let value: unknown;
        try {
            value = JSON.parse(line);
        } catch {
            invalid(`record ${this.#line} is not valid JSON; emit one operation per line without Markdown or prose.`);
        }
        const operation = object(value, `record ${this.#line}`);
        if (operation.op === "done") {
            exactKeys(operation, ["op"], "done");
            this.#done = true;
            return;
        }
        if (this.#sequence >= MAX_SKETCH_STREAM_OPERATIONS) invalid("stream exceeds 1024 operations.");
        if (this.#phase === "outline" && !["upsert-screen", "upsert-transition"].includes(String(operation.op))) {
            invalid("outline generation accepts only page metadata and navigation transitions, never page content.");
        }
        if (this.#phase === "content" && !["ui", "screen-status"].includes(String(operation.op))) {
            invalid("content generation cannot change the published page outline or navigation transitions.");
        }
        const next: DslSketchDocument = this.#document === null
            ? { version: 2, ...(this.#fidelity ? { fidelity: this.#fidelity } : {}), screens: [], transitions: [] }
            : { ...this.#document, screens: this.#document.screens.map(screen => ({ ...screen })),
                transitions: [...this.#document.transitions] };
        const statuses = { ...this.#screenStatuses };
        switch (operation.op) {
            case "upsert-screen": {
                exactKeys(operation, ["op", "screen"], "upsert-screen");
                const metadata = object(operation.screen, "screen metadata");
                exactKeys(metadata, screenKeys, "screen metadata");
                const index = next.screens.findIndex((screen) => screen.id === metadata.id);
                const screen: DslSketchScreen = {
                    id: metadata.id as string,
                    title: metadata.title as string,
                    purpose: metadata.purpose as string,
                    decisionIds: metadata.decisionIds as string[],
                    width: metadata.width as number,
                    height: metadata.height as number,
                    notes: metadata.notes as string,
                    ui: index === -1 ? createSketchUi(next.fidelity) : next.screens[index].ui,
                };
                if (index === -1) next.screens.push(screen);
                else next.screens[index] = screen;
                statuses[screen.id] = index === -1 || this.#phase === "outline" ? "waiting" : "processing";
                break;
            }
            case "remove-screen": {
                exactKeys(operation, ["op", "screenId"], "remove-screen");
                const screen = this.#screen(next, operation.screenId);
                if (next.screens.length === 1) invalid("cannot remove the last screen; add its replacement first.");
                next.screens = next.screens.filter((item) => item.id !== screen.id);
                next.transitions = next.transitions.filter((item) => item.fromScreenId !== screen.id && item.toScreenId !== screen.id);
                delete statuses[screen.id];
                break;
            }
            case "ui": {
                exactKeys(operation, ["op", "screenId", "edit"], "ui");
                const screen = this.#screen(next, operation.screenId);
                try {
                    screen.ui = applyOperations(screen.ui, [validateOperation(canonicalIconEdit(operation.edit, screen.ui))]);
                } catch (error) {
                    if (error instanceof DSLError && [
                        "unknown_prop", "invalid_prop", "missing_prop", "unknown_component", "unknown_icon",
                        "unknown_token", "invalid_token",
                    ].includes(error.code)) {
                        throw new SketchEditValidationError({
                            message: `${error.message} (${error.path})`, operation,
                        }, error);
                    }
                    throw error;
                }
                statuses[screen.id] = "processing";
                break;
            }
            case "screen-status": {
                exactKeys(operation, ["op", "screenId", "status"], "screen-status");
                const screen = this.#screen(next, operation.screenId);
                if (operation.status !== "processing" && operation.status !== "ready") {
                    invalid("screen-status must be processing or ready.");
                }
                if (operation.status === "ready" && !hasScreenContent(screen)) {
                    invalid(`screen "${screen.id}" cannot be ready without UI content.`);
                }
                statuses[screen.id] = operation.status;
                break;
            }
            case "upsert-transition": {
                exactKeys(operation, ["op", "transition"], "upsert-transition");
                const transition = object(operation.transition, "transition") as unknown as SketchTransition;
                const index = next.transitions.findIndex((item) => item.id === transition.id);
                if (index === -1) next.transitions.push(transition);
                else next.transitions[index] = transition;
                break;
            }
            case "remove-transition": {
                exactKeys(operation, ["op", "transitionId"], "remove-transition");
                const transitionId = identifier(operation.transitionId, "transitionId");
                const index = next.transitions.findIndex((transition) => transition.id === transitionId);
                if (index === -1) invalid(`cannot remove unknown transition "${transitionId}".`);
                next.transitions.splice(index, 1);
                break;
            }
            default:
                invalid("unknown operation; expected upsert-screen, remove-screen, ui, screen-status, upsert-transition, remove-transition, or done.");
        }
        const validated = validateSketchDocument(next, this.#decisionIds);
        if (validated.version !== 2) return invalid("expected a UI DSL document.");
        this.#document = validated;
        this.#screenStatuses = statuses;
        this.#sequence++;
        if (operation.op !== "screen-status") this.#changes++;
        this.#onChange?.(structuredClone(validated), this.#sequence, { ...statuses });
    }

    #screen(document: DslSketchDocument, value: unknown): DslSketchScreen {
        const id = identifier(value, "screenId");
        const screen = document.screens.find((item) => item.id === id);
        if (!screen) return invalid(`unknown screen "${id}"; upsert the screen before referencing it.`);
        return screen;
    }
}

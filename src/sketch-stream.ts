import {
    validateSketchDocument,
    type SketchDocument,
    type SketchScreen,
    type SketchShape,
    type SketchTransition,
} from "./sketch.js";

export interface SketchPreview {
    prototypeId: string;
    generation: string;
    requestId: string;
    runId: string;
    baseRevisionId: string | null;
    requirementsDigest: string;
    sequence: number;
    document: SketchDocument;
}

export const MAX_SKETCH_STREAM_RESPONSE_BYTES = 512 * 1024;
export const MAX_SKETCH_STREAM_RECORD_BYTES = 256 * 1024;
// The terminal done record does not count as a document-changing operation.
export const MAX_SKETCH_STREAM_OPERATIONS = 1024;

const encoder = new TextEncoder();
const screenKeys = ["id", "title", "purpose", "decisionIds", "width", "height", "notes"];

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
    #document: SketchDocument | null;
    #decisionIds: string[];
    #onChange?: (document: SketchDocument, sequence: number) => void;
    #sequence = 0;
    #done = false;
    #failure: Error | null = null;
    #responseBytes = 0;
    #responseHighSurrogate = false;
    #record = "";
    #recordBytes = 0;
    #recordHighSurrogate = false;
    #line = 0;

    constructor(
        base: SketchDocument | null,
        decisionIds: string[],
        onChange?: (document: SketchDocument, sequence: number) => void,
    ) {
        if (!Array.isArray(decisionIds) || decisionIds.some((id) => typeof id !== "string")) {
            invalid("accepted decision IDs must be an array of strings.");
        }
        this.#decisionIds = [...decisionIds];
        this.#document = base === null ? null : validateSketchDocument(base, this.#decisionIds);
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
                }
                if (newline === -1) break;
                this.#consumeRecord();
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
            if (!this.#document || this.#sequence === 0) invalid("at least one document-changing operation is required before done.");
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
        if (this.#sequence >= MAX_SKETCH_STREAM_OPERATIONS) invalid("stream exceeds 1024 document-changing operations.");
        const next: SketchDocument = this.#document === null
            ? { version: 1, screens: [], transitions: [] }
            : structuredClone(this.#document);
        switch (operation.op) {
            case "upsert-screen": {
                exactKeys(operation, ["op", "screen"], "upsert-screen");
                const metadata = object(operation.screen, "screen metadata");
                exactKeys(metadata, screenKeys, "screen metadata");
                const index = next.screens.findIndex((screen) => screen.id === metadata.id);
                const screen: SketchScreen = {
                    id: metadata.id as string,
                    title: metadata.title as string,
                    purpose: metadata.purpose as string,
                    decisionIds: metadata.decisionIds as string[],
                    width: metadata.width as number,
                    height: metadata.height as number,
                    notes: metadata.notes as string,
                    shapes: index === -1 ? [] : next.screens[index].shapes,
                };
                if (index === -1) next.screens.push(screen);
                else next.screens[index] = screen;
                break;
            }
            case "remove-screen": {
                exactKeys(operation, ["op", "screenId"], "remove-screen");
                const screen = this.#screen(next, operation.screenId);
                if (next.screens.length === 1) invalid("cannot remove the last screen; add its replacement first.");
                next.screens = next.screens.filter((item) => item.id !== screen.id);
                next.transitions = next.transitions.filter((item) => item.fromScreenId !== screen.id && item.toScreenId !== screen.id);
                break;
            }
            case "upsert-shape": {
                exactKeys(operation, ["op", "screenId", "shape"], "upsert-shape");
                const screen = this.#screen(next, operation.screenId);
                const shape = object(operation.shape, "shape") as unknown as SketchShape;
                const index = screen.shapes.findIndex((item) => item.id === shape.id);
                if (index === -1) screen.shapes.push(shape);
                else screen.shapes[index] = shape;
                break;
            }
            case "remove-shape": {
                exactKeys(operation, ["op", "screenId", "shapeId"], "remove-shape");
                const screen = this.#screen(next, operation.screenId);
                const shapeId = identifier(operation.shapeId, "shapeId");
                const index = screen.shapes.findIndex((shape) => shape.id === shapeId);
                if (index === -1) invalid(`cannot remove unknown shape "${shapeId}" from screen "${screen.id}".`);
                screen.shapes.splice(index, 1);
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
                invalid("unknown operation; expected upsert-screen, remove-screen, upsert-shape, remove-shape, upsert-transition, remove-transition, or done.");
        }
        const validated = validateSketchDocument(next, this.#decisionIds);
        this.#document = validated;
        this.#sequence++;
        this.#onChange?.(structuredClone(validated), this.#sequence);
    }

    #screen(document: SketchDocument, value: unknown): SketchScreen {
        const id = identifier(value, "screenId");
        const screen = document.screens.find((item) => item.id === id);
        if (!screen) return invalid(`unknown screen "${id}"; upsert the screen before referencing it.`);
        return screen;
    }
}

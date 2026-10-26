export type ComponentType = "Screen" | "Stack" | "Row" | "Grid" | "Card" | "Section"
    | "Heading" | "Text" | "Button" | "Input" | "Textarea" | "Select" | "Checkbox"
    | "Switch" | "Badge" | "Divider" | "Spacer" | "Image" | "Avatar" | "Icon"
    | "Link" | "Progress" | "Stat" | "Alert" | "List";
export type Props = Readonly<Record<string, string | number | boolean | readonly string[]>>;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface UiNode {
    readonly id: string;
    readonly type: ComponentType;
    readonly parent: string | null;
    readonly children: readonly string[];
    readonly props: Props;
}
export interface UiDocument {
    readonly version: 1;
    readonly revision: number;
    readonly root: string;
    readonly tokens: Readonly<Record<string, string | number>>;
    readonly nodes: Readonly<Record<string, UiNode>>;
}
export type Operation =
    | { op: "add"; parent: string; after?: string | null; component: { id: string; type: ComponentType; props: Props } }
    | { op: "update"; id: string; props: Props }
    | { op: "remove"; id: string }
    | { op: "move"; id: string; parent: string; after?: string | null }
    | { op: "setToken"; key: string; value: string | number };
export const CATALOG: Readonly<Record<ComponentType, {
    container: boolean; props: { [key: string]: JsonValue }; defaults: Props;
}>>;
export const DEFAULT_TOKENS: UiDocument["tokens"];
export const TOKEN_DEFINITIONS: Readonly<Record<string,
    { kind: "color"; default: string } | { kind: "length" | "weight"; default: number; min: number; max: number }>>;
export const OPERATION_SCHEMA: { [key: string]: JsonValue };
export const PROMPT_PREFIX: string;
export class DSLError extends Error {
    constructor(code: string, message: string, path?: string, details?: Record<string, unknown>);
    code: string;
    path: string;
    details: Record<string, unknown>;
}
export function searchIcons(options?: { query?: string; limit?: number; offset?: number }): {
    library: Readonly<{ name: string; version: string; count: number }>;
    query: string; total: number; names: string[]; offset: number; nextOffset: number | null;
};
export const LIMITS: Readonly<Record<"nodes" | "depth" | "batch" | "history" | "historyBytes"
    | "documentCharacters" | "receiptCharacters" | "line" | "stream" | "receipts", number>>;
export function createDocument(options?: { rootId?: string; tokens?: UiDocument["tokens"] }): UiDocument;
export function validateDocument(document: unknown): UiDocument;
export function validateOperation(operation: unknown): Operation;
export function applyOperations(document: UiDocument, operations: readonly Operation[]): UiDocument;
export interface UiRenderer {
    render(document: UiDocument): void;
    select(id: string | null): void;
    setMode(mode: "select" | "interact"): void;
    getElement(id: string): HTMLElement | null;
    dispose(): void;
}
export function createRenderer(host: HTMLElement, options?: {
    mode?: "select" | "interact";
    onSelect?: (id: string) => void;
    onEvent?: (event: { id: string; type: string; action?: string | null; destination?: string | null; value?: string | boolean }) => void;
}): UiRenderer;
